-- assets_01: archive columns, history-preserving maintenance link, office-only writes.
--
-- Spec: docs/superpowers/specs/2026-10-13-assets-phase-a-design.md
-- Apply by hand in the Supabase SQL editor. Independent of the prodfix series and of
-- shifts_06: it carries an identical pod_caller_is_office(), and
-- lib/assets/officeFunctionSql.test.ts fails if the two copies ever differ.
--
-- Before this file (live 2026-10-13): one FOR ALL policy, can_access_tenant(tenant_id), so any
-- tenant member including drivers could insert, update and DELETE assets from the browser, and
-- maintenance_records.asset_id was ON DELETE SET NULL, so a delete silently orphaned history.
--
-- After: drivers read only; office staff insert and update; nobody deletes from the browser
-- (DELETE /api/assets/[id], service role, admins only); asset numbers are unique per tenant; tenant_id and company_id are pinned;
-- archived_at / archived_by are written only
-- by the service role (POST /api/assets/[id]/archive and /restore); an archived row cannot be
-- edited until restored; the database refuses to delete an asset that has history in maintenance_records,
-- asset_movements or asset_maintenance (all three foreign keys are RESTRICT).
--
-- Error codes, mirrored in lib/assets/errors.ts:
--   AST01  a browser write touched archived_at / archived_by
--   AST02  a browser update hit an archived row
--   AST03  a browser write moved an asset to another tenant or company, or inserted it under the wrong company

begin;

-- ===========================================================================
-- 1. Archive columns
-- ===========================================================================
alter table public.assets add column if not exists archived_at timestamptz null;
alter table public.assets add column if not exists archived_by uuid null
  references public.profiles(id) on delete set null;

-- archived_at without archived_by is legitimate (the archiving profile was deleted); the reverse is not.
alter table public.assets drop constraint if exists assets_archived_by_needs_at;
alter table public.assets add constraint assets_archived_by_needs_at
  check (archived_by is null or archived_at is not null);

-- ===========================================================================
-- 2. History survives in all three tables: SET NULL / CASCADE become RESTRICT
-- ===========================================================================
-- maintenance_records was SET NULL (orphaned history); asset_movements and asset_maintenance are
-- empty and unused today but were CASCADE, which would silently destroy history once Phase B/C
-- writes rows.
-- Drop by lookup, not by name: a differently named foreign key left beside the new RESTRICT one would still orphan or destroy history.
do $$
declare
  t text;
  c record;
begin
  foreach t in array array['maintenance_records', 'asset_movements', 'asset_maintenance']
  loop
    for c in
      select con.conname from pg_constraint con
      where con.conrelid = format('public.%I', t)::regclass and con.contype = 'f'
        and con.confrelid = 'public.assets'::regclass
        and con.conkey = array[(select attnum from pg_attribute
                                 where attrelid = format('public.%I', t)::regclass
                                   and attname = 'asset_id')]::smallint[]
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
  end loop;
end $$;

alter table public.maintenance_records add constraint maintenance_records_asset_id_fkey
  foreign key (asset_id) references public.assets(id) on delete restrict;
alter table public.asset_movements add constraint asset_movements_asset_id_fkey
  foreign key (asset_id) references public.assets(id) on delete restrict;
alter table public.asset_maintenance add constraint asset_maintenance_asset_id_fkey
  foreign key (asset_id) references public.assets(id) on delete restrict;

-- ===========================================================================
-- 3. One asset number per tenant, enforced by the database
-- ===========================================================================
-- The page checks for a duplicate before saving, but two saves at once can both pass that
-- check. Archived assets keep their number. lib/assets/errors.ts maps the 23505 to a sentence.
create unique index if not exists assets_tenant_asset_number_key
  on public.assets (tenant_id, asset_number)
  where asset_number is not null;

-- ===========================================================================
-- 4. Office check (identical to shifts_06; either file may be applied first)
-- ===========================================================================
-- Mirrors lib/jobs/officeRoles.ts isOfficeCaller, except a NULL or empty role is refused.
-- SECURITY DEFINER so the driver-link lookup is not hidden by the caller's RLS; it answers only
-- about auth.uid() itself.
create or replace function public.pod_caller_is_office()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then
    return false;
  end if;

  select lower(btrim(r.name)) into v_role
  from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = v_uid;

  if v_role in ('admin', 'super_admin') then
    return true;
  end if;
  if coalesce(v_role, '') = '' or v_role in ('driver', 'subcontractor_driver') then
    return false;
  end if;

  -- Same inputs as lib/jobs/officeAccess.ts hasActiveDriverLink.
  if exists (select 1 from public.driver_users du where du.user_id = v_uid and du.active is true) then
    return false;
  end if;
  if exists (select 1 from public.subcontractor_users su
                 where su.user_id = v_uid and su.active is true and su.role = 'driver') then
    return false;
  end if;

  return true;
end $$;

revoke all on function public.pod_caller_is_office() from public, anon;
grant execute on function public.pod_caller_is_office() to authenticated, service_role;

-- ===========================================================================
-- 5. Policies: read for members, write for office, delete for nobody
-- ===========================================================================
alter table public.assets enable row level security;

drop policy if exists tenant_access on public.assets;
drop policy if exists assets_select on public.assets;
drop policy if exists assets_insert on public.assets;
drop policy if exists assets_update on public.assets;

create policy assets_select on public.assets
  for select to authenticated
  using (public.can_access_tenant(tenant_id));

create policy assets_insert on public.assets
  for insert to authenticated
  with check (public.can_access_tenant(tenant_id) and public.pod_caller_is_office());

create policy assets_update on public.assets
  for update to authenticated
  using (public.can_access_tenant(tenant_id) and public.pod_caller_is_office())
  with check (public.can_access_tenant(tenant_id) and public.pod_caller_is_office());

-- TRUNCATE bypasses RLS.
revoke delete, truncate on public.assets from public, anon, authenticated;
revoke insert, update on public.assets from anon;

-- ===========================================================================
-- 6. Archive columns are server-only; archived rows are frozen
-- ===========================================================================
-- NOT security definer, deliberately: current_user must be the real caller.
-- Also pins tenant_id and company_id (the prodfix_90 pattern).
-- Warning: a future SECURITY DEFINER function owned by postgres that writes assets bypasses this
-- guard; a future INVOKER trigger elsewhere that updates an archived asset will raise AST02 for
-- browser callers.
create or replace function public.guard_asset_archive()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.archived_at is not null or new.archived_by is not null then
      raise exception 'Assets are archived with the Archive button, not when they are created.'
        using errcode = 'AST01';
    end if;

    -- Reads tenants under the caller's RLS, as the page's own lookup does; a hidden tenant gives
    -- NULL and fails closed.
    if new.company_id is distinct from
       (select t.company_id from public.tenants t where t.id = new.tenant_id) then
      raise exception 'An asset''s company must be the company of its tenant.'
        using errcode = 'AST03';
    end if;
    return new;
  end if;

  if old.archived_at is not null then
    raise exception 'This asset is archived. Restore it before editing.'
      using errcode = 'AST02';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.company_id is distinct from old.company_id then
    raise exception 'An asset cannot be moved to another tenant or company.'
      using errcode = 'AST03';
  end if;

  if new.archived_at is distinct from old.archived_at
     or new.archived_by is distinct from old.archived_by then
    raise exception 'Assets are archived and restored with the Archive and Restore buttons.'
      using errcode = 'AST01';
  end if;

  return new;
end $$;

revoke all on function public.guard_asset_archive() from public, anon, authenticated;

drop trigger if exists guard_asset_archive on public.assets;
create trigger guard_asset_archive
  before insert or update on public.assets
  for each row execute function public.guard_asset_archive();

commit;

-- ===========================================================================
-- VERIFY (read-only; run after the commit)
-- ===========================================================================
-- Expect 2 rows: archived_at, archived_by
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'assets'
  and column_name in ('archived_at', 'archived_by');

-- Expect exactly 3 rows, all r
select conrelid::regclass, conname, confdeltype from pg_constraint where contype = 'f' and confrelid = 'public.assets'::regclass and conrelid in ('public.maintenance_records'::regclass, 'public.asset_movements'::regclass, 'public.asset_maintenance'::regclass);

-- Expect exactly assets_insert (INSERT), assets_select (SELECT), assets_update (UPDATE)
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'assets' order by policyname;

-- Expect false
select has_table_privilege('authenticated', 'public.assets', 'DELETE') as authenticated_can_delete;

-- Expect 1 row
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'assets' and indexname = 'assets_tenant_asset_number_key';

-- Expect 1 row
select tgname from pg_trigger
where tgrelid = 'public.assets'::regclass and tgname = 'guard_asset_archive';

-- Expect postgres: foreign key actions run as this owner and must be exempt in guard_asset_archive
select tableowner from pg_tables where schemaname = 'public' and tablename = 'assets';

-- Expect false, false
select has_table_privilege('anon', 'public.assets', 'DELETE') as anon_can_delete,
       has_table_privilege('authenticated', 'public.assets', 'TRUNCATE') as authenticated_can_truncate;

-- Expect guard_asset_archive false, pod_caller_is_office true
select proname, prosecdef from pg_proc
where pronamespace = 'public'::regnamespace and proname in ('guard_asset_archive', 'pod_caller_is_office');

-- Expect O (enabled)
select tgenabled from pg_trigger
where tgrelid = 'public.assets'::regclass and tgname = 'guard_asset_archive';

-- Expect false (auth.uid() is null in the SQL editor); proves the function's tables and columns resolve
select public.pod_caller_is_office();
