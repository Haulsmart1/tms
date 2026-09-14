-- prodfix_10_super_admin_tenant_move.sql
--
-- Review findings AUTH-3 and AUTH-15.
--
-- WHY
--   AUTH-3: app/api/super-admin/tenants/[id] re-parented a tenant by writing
--   tenants.company_id only. get_tenant_context() (rls_07) returns no-tenant
--   unless tenants.company_id = get_my_company_id(), which reads
--   profiles.company_id, so every user whose home tenant was moved was locked
--   out, and the new company's admins could not see them.
--   AUTH-15: the only record of that move was a Vercel log line, which rolls
--   over, so there was nothing to undo from.
--
-- WHAT
--   1. public.super_admin_audit: append-only audit rows. RLS on and forced,
--      no client grants at all, and the service role may only select and
--      insert (no update, delete or truncate), so a row cannot be edited away
--      through the API.
--   2. public.super_admin_move_tenant(actor, tenant, new_company, new_name):
--      moves the tenant, moves every profile whose home tenant it is to the
--      new company, and writes the audit row, in ONE transaction. Callable by
--      the service role only; the app route checks the caller is a super
--      admin first, and the function re-checks the actor against profiles.
--
-- DELIBERATE DECISION: company-wide admins block the move.
--   An `admin` is company-wide in RLS (can_access_tenant grants every tenant
--   in the company). If a profile with role admin has the moving tenant as
--   its home, moving its company_id would make it an admin of EVERY tenant in
--   the new company, which is a privilege grant nobody asked for. Leaving its
--   company_id behind would lock it out. Neither is safe to pick silently, so
--   the function refuses with tenant_has_company_admins:<count> and the
--   operator reassigns or demotes those users first. Staff and super_admin
--   profiles move with the tenant.
--
-- LIVE-STATE ASSUMPTIONS (check with docs/sql/diag_2026_09_14_live_state.sql)
--   - public.roles has a row named exactly 'admin' and 'super_admin'.
--   - The function owner (postgres, when run from the SQL editor) bypasses
--     RLS on tenants and profiles, and guard_profiles_privileged_columns
--     exempts current_user = postgres, which is what current_user is inside a
--     SECURITY DEFINER function it owns. If either differs, the move FAILS
--     with an error; it cannot succeed partially or widen access.
--   - If a table named super_admin_audit already exists with a different
--     shape, "create table if not exists" skips it; the column check below
--     raises instead of carrying on against the wrong table.
--
-- Safe to re-run. Apply in the Supabase SQL editor. The app refuses tenant
-- moves with a clear 503 until this is applied; renames keep working.

begin;

create table if not exists public.super_admin_audit (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  actor_id        uuid        not null,
  action          text        not null,
  target_type     text        not null,
  target_id       uuid        not null,
  changed_fields  text[]      not null default '{}',
  old_company_id  uuid,
  new_company_id  uuid,
  details         jsonb       not null default '{}'::jsonb,
  result          text        not null default 'ok'
);

do $$
declare
  v_missing text;
begin
  select string_agg(required.col, ', ')
    into v_missing
    from unnest(array[
      'id', 'created_at', 'actor_id', 'action', 'target_type', 'target_id',
      'changed_fields', 'old_company_id', 'new_company_id', 'details', 'result'
    ]) as required(col)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'super_admin_audit'
        and c.column_name = required.col
   );

  if v_missing is not null then
    raise exception 'public.super_admin_audit exists with a different shape (missing: %). Resolve by hand.', v_missing;
  end if;
end $$;

create index if not exists super_admin_audit_target_idx
  on public.super_admin_audit (target_type, target_id, created_at desc);

alter table public.super_admin_audit enable row level security;
alter table public.super_admin_audit force row level security;

revoke all on table public.super_admin_audit from public, anon, authenticated;
revoke update, delete, truncate on table public.super_admin_audit from service_role;
grant select, insert on table public.super_admin_audit to service_role;

create or replace function public.super_admin_move_tenant(
  p_actor       uuid,
  p_tenant      uuid,
  p_new_company uuid,
  p_new_name    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role    text;
  v_old_company   uuid;
  v_old_name      text;
  v_admins        integer;
  v_profiles      integer;
  v_changed       text[];
begin
  if p_actor is null or p_tenant is null or p_new_company is null then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  if p_new_name is not null and length(btrim(p_new_name)) = 0 then
    raise exception 'invalid_arguments' using errcode = '22023';
  end if;

  -- Defence in depth: the route already checked, but this function holds the
  -- keys to every tenant, so it re-checks the actor from profiles itself.
  select r.name
    into v_actor_role
    from public.profiles p
    join public.roles r on r.id = p.role_id
   where p.id = p_actor;

  if v_actor_role is distinct from 'super_admin' then
    raise exception 'actor_not_super_admin' using errcode = '42501';
  end if;

  -- Row lock, so two concurrent moves of one tenant serialise and each audit
  -- row records the company the tenant really left.
  select t.company_id, t.name
    into v_old_company, v_old_name
    from public.tenants t
   where t.id = p_tenant
     for update;

  if not found then
    raise exception 'no_such_tenant' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_new_company) then
    raise exception 'no_such_company' using errcode = 'P0002';
  end if;

  if p_new_company is distinct from v_old_company then
    select count(*)
      into v_admins
      from public.profiles p
      join public.roles r on r.id = p.role_id
     where p.tenant_id = p_tenant
       and r.name = 'admin';

    if v_admins > 0 then
      raise exception 'tenant_has_company_admins:%', v_admins using errcode = 'P0001';
    end if;
  end if;

  update public.tenants
     set company_id = p_new_company,
         name = coalesce(btrim(p_new_name), name)
   where id = p_tenant;

  -- Profiles keyed straight to a COMPANY id in tenant_id (legacy rows) do not
  -- match here and are deliberately left alone: they belong to a company, not
  -- to this tenant.
  update public.profiles
     set company_id = p_new_company
   where tenant_id = p_tenant
     and company_id is distinct from p_new_company;

  get diagnostics v_profiles = row_count;

  v_changed := array['company_id'];
  if p_new_name is not null then
    v_changed := v_changed || array['name'];
  end if;

  insert into public.super_admin_audit (
    actor_id, action, target_type, target_id, changed_fields,
    old_company_id, new_company_id, details, result
  ) values (
    p_actor, 'tenant.reparent', 'tenant', p_tenant, v_changed,
    v_old_company, p_new_company,
    jsonb_build_object('profiles_moved', v_profiles, 'renamed', p_new_name is not null),
    'ok'
  );

  return jsonb_build_object(
    'old_company_id', v_old_company,
    'new_company_id', p_new_company,
    'profiles_moved', v_profiles
  );
end $$;

revoke all on function public.super_admin_move_tenant(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.super_admin_move_tenant(uuid, uuid, uuid, text) to service_role;

commit;

-- VERIFY (expect: rls true/true; anon and authenticated false on every check;
-- service_role true for select/insert/execute and false for update/delete):
-- select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.super_admin_audit'::regclass;
-- select has_table_privilege('anon', 'public.super_admin_audit', 'select')          as anon_select,
--        has_table_privilege('authenticated', 'public.super_admin_audit', 'select') as auth_select,
--        has_table_privilege('service_role', 'public.super_admin_audit', 'insert')  as svc_insert,
--        has_table_privilege('service_role', 'public.super_admin_audit', 'update')  as svc_update,
--        has_table_privilege('service_role', 'public.super_admin_audit', 'delete')  as svc_delete;
-- select has_function_privilege('anon', 'public.super_admin_move_tenant(uuid,uuid,uuid,text)', 'execute')          as anon_exec,
--        has_function_privilege('authenticated', 'public.super_admin_move_tenant(uuid,uuid,uuid,text)', 'execute') as auth_exec,
--        has_function_privilege('service_role', 'public.super_admin_move_tenant(uuid,uuid,uuid,text)', 'execute')  as svc_exec;
--
-- After a move, every profile of the moved tenant should agree with it (expect 0 rows):
-- select p.id from public.profiles p join public.tenants t on t.id = p.tenant_id
--  where p.company_id is distinct from t.company_id;
