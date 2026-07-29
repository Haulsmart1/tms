-- RLS Tenancy Hardening (Phase 1) -- 06: final-review fixes. Safe to re-run.
-- Run after rls_05. Closes the outliers from the final adversarial review (A1-A4).

-- A1 (HIGH): integration_connections holds plaintext OAuth access_token/refresh_token.
-- It must NOT be readable by ordinary tenant staff. Make it service-role only: drop every
-- policy (RLS-on + no policy = deny-all for anon/authenticated) and revoke the grants.
-- The service role is BYPASSRLS, so server-side integration code keeps working.
do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='integration_connections'
  loop
    execute format('drop policy %I on public.integration_connections', pol.policyname);
  end loop;
end $$;
revoke select, insert, update, delete on public.integration_connections from anon, authenticated;
-- If connection STATUS must show client-side later, expose only non-secret columns via a
-- security_barrier view, never a policy on this table.

-- A4 (hygiene): memberships is a legacy user<->tenant table (FK user_id -> public.users),
-- unused by the app, and it kept a stale "TO public" ALL policy comparing tenant_id to a
-- company id. Drop it and lock the table (deny-all), matching users/user_permissions. It is
-- slated for removal with public.users.
do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='memberships'
  loop
    execute format('drop policy %I on public.memberships', pol.policyname);
  end loop;
end $$;
revoke select, insert, update, delete on public.memberships from anon, authenticated;

-- A2 (owner decision): driver_work_rules holds statutory WTD limits and is admin-managed
-- like the roster. Re-key it staff-read / admin-write. (defect_reports stays staff-writable:
-- drivers file their own walkaround defects.)
do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='driver_work_rules'
  loop
    execute format('drop policy %I on public.driver_work_rules', pol.policyname);
  end loop;
end $$;
create policy tenant_read on public.driver_work_rules for select to authenticated
  using (public.can_access_tenant(tenant_id));
create policy admin_all on public.driver_work_rules for all to authenticated
  using (public.can_manage_tenant(tenant_id))
  with check (public.can_manage_tenant(tenant_id));

-- A3 (owner decision): subscriptions (Stripe ids) and telematics_devices (IMEI/SIM) are
-- system-owned identifiers. Admins/super read only; no write policy (service role writes).
do $$ declare pol record; t text; begin
  foreach t in array array['subscriptions','telematics_devices'] loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format(
      'create policy admin_read on public.%I for select to authenticated '
      'using (public.can_manage_tenant(tenant_id))', t);
  end loop;
end $$;

-- F-A (defense in depth): the admin_read tables are already fail-closed for staff/anon via the
-- can_manage_tenant policy, but also drop anon's SELECT grant. Do NOT revoke SELECT from
-- authenticated: grants are ANDed with RLS, so that would break the intended admin reads.
revoke select on public.subscriptions, public.telematics_devices from anon;

-- F-D (forward-looking governance): stop FUTURE public tables inheriting the broad grants.
-- (New tables still need `alter table ... enable row level security` explicitly; add a CI check
-- that fails any new public table lacking RLS + at least one policy.)
alter default privileges in schema public revoke insert, update, delete on tables from anon, authenticated;
alter default privileges in schema public revoke select on tables from anon;

-- VERIFY:
-- select tablename, policyname from pg_policies
-- where schemaname='public' and tablename in ('integration_connections','memberships');   -- 0 rows
-- select tablename, policyname, cmd from pg_policies
-- where schemaname='public' and tablename in ('driver_work_rules','subscriptions','telematics_devices')
-- order by tablename, cmd;   -- driver_work_rules: tenant_read + admin_all; others: admin_read only
