-- prodfix_84_views_security_invoker.sql
--
-- Finding SQL-3. A Postgres view without `security_invoker = true` reads its base tables as the
-- view OWNER (postgres here), which bypasses RLS. PostgREST exposes views like tables, and
-- Supabase's default privileges grant SELECT on new relations to anon and authenticated. So a view
-- such as customer_aged_debt may hand every operator's debtors to anyone holding the anon key.
-- The app reads jobs_ready_to_invoice and customer_aged_debt only through the service role
-- (app/api/accounts/ready-to-invoice, app/api/accounts/statements), which is why this never shows.
--
-- WHAT IT DOES, for every view and materialized view in public that this session owns and that is
-- not part of an extension:
--   view (relkind v):
--     - alter view ... set (security_invoker = true)       base-table RLS now applies to the caller
--     - revoke all ... from public, anon                   the anon key never reads views
--     - jobs_ready_to_invoice, customer_aged_debt only:
--       revoke all ... from authenticated                  service-role only, as the app uses them
--     - grant select ... to service_role                   keep the server routes working
--   materialized view (relkind m): cannot be security_invoker and never applies RLS, so it is
--     cross-tenant by construction:
--     - revoke all ... from public, anon, authenticated; grant select to service_role
--   Not owned / extension-owned: SKIPPED, reported in the result.
--
-- Only narrows. A view the browser genuinely reads with the user's key keeps authenticated SELECT
-- and now returns only rows the caller's RLS allows (or errors if the caller lacks a base-table
-- grant, which is fail-closed). No page in app/ reads a view directly as of 2026-09-14.
--
-- PRECONDITIONS (asserted): Postgres 15 or later (security_invoker was added in 15).
-- Apply AFTER rls_11: security_invoker only helps if the base tables have RLS enabled.
--
-- Diag to check first: 03_view (kind, owner, security_invoker, anon_select, auth_select) and
-- prodfix_80 section C_view / H_server_version.
--
-- Safe to re-run.

begin;

do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'prodfix_84: Postgres % has no security_invoker views (needs 15+). Nothing changed. Revoke anon/authenticated SELECT on the views by hand instead.',
      current_setting('server_version');
  end if;
end $$;

do $$
declare
  r record;
  v_service_only constant text[] := array['jobs_ready_to_invoice', 'customer_aged_debt'];
begin
  for r in
    select c.relname, c.relkind,
           pg_has_role(current_user, c.relowner, 'USAGE') as owned,
           exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e') as ext
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
    order by c.relname
  loop
    if r.ext or not r.owned then
      raise notice 'prodfix_84: SKIPPED public.% (extension-owned or not owned by %)', r.relname, current_user;
      continue;
    end if;

    if r.relkind = 'v' then
      execute format('alter view public.%I set (security_invoker = true)', r.relname);
      execute format('revoke all on public.%I from public, anon', r.relname);
      if r.relname = any(v_service_only) then
        execute format('revoke all on public.%I from authenticated', r.relname);
      end if;
      execute format('grant select on public.%I to service_role', r.relname);
    else
      execute format('revoke all on public.%I from public, anon, authenticated', r.relname);
      execute format('grant select on public.%I to service_role', r.relname);
    end if;
  end loop;
end $$;

commit;

-- VERIFY (read-only). Expect for every row: owned_by_me=true, anon_select=false; kind v rows
-- security_invoker=true; kind m rows and the two accounts views auth_select=false.
select c.relname, c.relkind,
       pg_has_role(current_user, c.relowner, 'USAGE') as owned_by_me,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'false') as security_invoker,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select,
       has_table_privilege('service_role', c.oid, 'select') as service_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('v', 'm')
order by c.relkind, c.relname;
