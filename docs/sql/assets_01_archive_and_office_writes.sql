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
-- (DELETE /api/assets/[id], service role, admins only); asset numbers are unique per tenant;
-- archived_at / archived_by are written only
-- by the service role (POST /api/assets/[id]/archive and /restore); an archived row cannot be
-- edited until restored; the database refuses to delete an asset with maintenance history.
--
-- Error codes, mirrored in lib/assets/errors.ts:
--   AST01  a browser write touched archived_at / archived_by
--   AST02  a browser update hit an archived row

begin;

-- ===========================================================================
-- 1. Archive columns
-- ===========================================================================
alter table public.assets add column if not exists archived_at timestamptz null;
alter table public.assets add column if not exists archived_by uuid null
  references public.profiles(id) on delete set null;

-- ===========================================================================
-- 2. Maintenance history survives: SET NULL becomes RESTRICT
-- ===========================================================================
alter table public.maintenance_records drop constraint if exists maintenance_records_asset_id_fkey;
alter table public.maintenance_records add constraint maintenance_records_asset_id_fkey
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

revoke delete on public.assets from authenticated, anon;
revoke insert, update on public.assets from anon;

-- ===========================================================================
-- 6. Archive columns are server-only; archived rows are frozen
-- ===========================================================================
-- NOT security definer, deliberately: current_user must be the real caller.
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
    return new;
  end if;

  if old.archived_at is not null then
    raise exception 'This asset is archived. Restore it before editing.'
      using errcode = 'AST02';
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

-- Expect 'r' (restrict)
select confdeltype from pg_constraint where conname = 'maintenance_records_asset_id_fkey';

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
