-- RLS Tenancy Hardening (Phase 1) -- 06: lock secret/legacy tables. Safe to re-run.
-- Run after rls_05. Closes two outliers found in the final review.

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

-- VERIFY (expect 0 rows each): no policy left on either table.
-- select tablename, policyname from pg_policies
-- where schemaname='public' and tablename in ('integration_connections','memberships');
