-- prodfix_81_drop_rls_verify.sql
--
-- Finding SQL-10. docs/sql/rls_09_verify.sql creates public.rls_verify(uuid, uuid, uuid): an
-- invoker function that calls set_config('role', ...) and set_config('request.jwt.claims', ...)
-- with a caller-supplied user id. Left installed, Supabase's default privileges make it callable
-- at /rest/v1/rpc/rls_verify by anon and authenticated, so any signed-up user can run the probe
-- suite as any user id (the harness also committed real super_admin and admin ids, now replaced
-- by placeholders; they remain in git history and in
-- docs/superpowers/plans/2026-07-28-rls-tenancy-hardening.md).
--
-- This drops every overload named rls_verify in public. Safe to re-run: no-op when absent.
-- Run it again every time rls_09_verify.sql is used.
--
-- Diag to check first: 04_function (is rls_verify present?), 05_function_source.

begin;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_verify'
  loop
    execute format('drop function %s', r.sig);
    raise notice 'prodfix_81: dropped %', r.sig;
  end loop;
end $$;

commit;

-- VERIFY (expect 0 rows):
select p.oid::regprocedure, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'rls_verify';
