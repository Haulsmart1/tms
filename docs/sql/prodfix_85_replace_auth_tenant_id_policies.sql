-- prodfix_85_replace_auth_tenant_id_policies.sql
--
-- Findings SQL-4 and POD-15. Six tables authorize with `tenant_id = auth_tenant_id()` instead of
-- the reviewed public.can_access_tenant(tenant_id) every other tenant table uses:
--   driver_users         supabase/migrations/20260813_portal_invites.sql
--   job_items            supabase/migrations/20260902130000_job_items_baseline.sql (full CRUD)
--   job_item_scans       supabase/migrations/20260902133000_job_item_scans.sql
--   load_manifests, load_manifest_items, load_scan_events
--                        supabase/migrations/20260902140000_load_manifests.sql
--
-- WHY THIS IS URGENT RATHER THAN COSMETIC
--   auth_tenant_id() is defined nowhere in the repo. The invite routes put `tenant_id` into the
--   auth user's user_metadata (app/api/settings/users/invite, portal-invites,
--   subcontractor/users/invite), which strongly suggests the function reads
--   auth.jwt() -> 'user_metadata' ->> 'tenant_id'. user_metadata is USER-EDITABLE: any signed-in
--   user can call supabase.auth.updateUser({ data: { tenant_id: '<victim tenant>' } }), refresh the
--   session, and the claim follows. If that is the body, every signed-in user (and today anyone who
--   can receive a magic link, see SQL-13) has full CRUD on any tenant's job_items and can read every
--   tenant's manifests, scans and driver logins. If instead it reads profiles.tenant_id, company
--   admins cannot see sibling tenants' rows (the POD-15 symptom: empty items on /jobs and /planning).
--   Either way the fix is the same. Diag 05_function_source shows the body; nothing here depends on it.
--
-- WHAT IT DOES, per table that exists (a table that does not exist is skipped and reported):
--   - drops every policy on the table whose USING or WITH CHECK calls auth_tenant_id, plus any
--     policy already carrying one of the names created below (so a re-run is idempotent);
--   - creates can_access_tenant(tenant_id) policies to authenticated, under the ORIGINAL names:
--       job_items       select / insert / update / delete   (same command set as before, now the
--                                                           rls_03 read+write shape)
--       job_item_scans, load_manifests, load_manifest_items, load_scan_events, driver_users
--                       select only (writes stay service-role, as their migrations intend)
--   - revokes all privileges from anon on the six tables.
--   Nothing is granted. Any OTHER policy on these tables is left in place and listed by the verify
--   query, so a legacy permissive policy is visible rather than silently kept.
--
-- DRIVER ACCESS: drivers do not use these policies. Every driver path (app/api/driver/**,
-- app/api/auth/callback, lib/driver/server.ts, app/api/load-manifests) uses the service-role
-- client, which bypasses RLS. Portal-only users have no profile, so can_access_tenant is false for
-- them, which is correct: they must not query these tables with their own key.
--
-- Effect on access: staff keep their own tenant; company admins gain their company's other tenants
-- (the documented model, and the POD-15 fix); a user whose JWT metadata named some other tenant
-- loses it. auth_tenant_id() itself is left in place (other objects may call it; see verify).
--
-- PRECONDITIONS (asserted): public.can_access_tenant(uuid) exists; every one of the six tables that
-- exists has a uuid tenant_id column; this session owns them.
--
-- Diag to check first: 05_function_source (auth_tenant_id body), 02_policy (the six tables),
-- 01_table_rls (rls=true on each). Apply after rls_11.
--
-- Safe to re-run.

begin;

do $$
declare
  t text;
  v_oid oid;
begin
  if to_regprocedure('public.can_access_tenant(uuid)') is null then
    raise exception 'prodfix_85: public.can_access_tenant(uuid) is missing. Nothing changed.';
  end if;
  foreach t in array array['job_items', 'job_item_scans', 'load_manifests', 'load_manifest_items',
                           'load_scan_events', 'driver_users'] loop
    v_oid := to_regclass('public.' || t);
    continue when v_oid is null;
    if not exists (select 1 from pg_attribute a where a.attrelid = v_oid and a.attname = 'tenant_id'
                     and a.atttypid = 'uuid'::regtype and not a.attisdropped) then
      raise exception 'prodfix_85: public.% has no uuid tenant_id column. Nothing changed.', t;
    end if;
    if not pg_has_role(current_user, (select relowner from pg_class where oid = v_oid), 'USAGE') then
      raise exception 'prodfix_85: % does not own public.%. Nothing changed.', current_user, t;
    end if;
  end loop;
end $$;

do $$
declare
  t    text;
  pol  record;
  v_names text[];
begin
  foreach t in array array['job_items', 'job_item_scans', 'load_manifests', 'load_manifest_items',
                           'load_scan_events', 'driver_users'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'prodfix_85: public.% does not exist, skipped', t;
      continue;
    end if;

    v_names := case when t = 'job_items'
      then array['job_items_select_tenant', 'job_items_insert_tenant', 'job_items_update_tenant', 'job_items_delete_tenant']
      else array[t || '_select_tenant'] end;

    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
        and (coalesce(qual, '') ilike '%auth_tenant_id%'
             or coalesce(with_check, '') ilike '%auth_tenant_id%'
             or policyname = any(v_names))
    loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    -- RLS is already on for all six per their migrations; assert it rather than assume.
    execute format('alter table public.%I enable row level security', t);

    if t = 'job_items' then
      create policy job_items_select_tenant on public.job_items
        for select to authenticated using (public.can_access_tenant(tenant_id));
      create policy job_items_insert_tenant on public.job_items
        for insert to authenticated with check (public.can_access_tenant(tenant_id));
      create policy job_items_update_tenant on public.job_items
        for update to authenticated
        using (public.can_access_tenant(tenant_id)) with check (public.can_access_tenant(tenant_id));
      create policy job_items_delete_tenant on public.job_items
        for delete to authenticated using (public.can_access_tenant(tenant_id));
    else
      execute format(
        'create policy %I on public.%I for select to authenticated '
        'using (public.can_access_tenant(tenant_id))', t || '_select_tenant', t);
    end if;

    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

commit;

-- VERIFY 1 (read-only): policies on the six tables. Expect job_items: 4 rows, the others: 1 row
-- each, every one calling can_access_tenant(tenant_id) with roles {authenticated}. Any extra row
-- is a pre-existing policy this file did not touch: check it.
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('job_items', 'job_item_scans', 'load_manifests', 'load_manifest_items',
                    'load_scan_events', 'driver_users')
order by tablename, cmd, policyname;

-- VERIFY 2 (run separately): anything anywhere still calling auth_tenant_id (expect 0 rows before
-- dropping or revoking the function):
--   select schemaname, tablename, policyname from pg_policies
--   where coalesce(qual, '') ilike '%auth_tenant_id%' or coalesce(with_check, '') ilike '%auth_tenant_id%';
--   select p.oid::regprocedure from pg_proc p where p.prosrc ilike '%auth_tenant_id%';
