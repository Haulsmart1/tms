-- RLS Tenancy Hardening -- 11: make RLS ENABLEMENT explicit and reproducible.
--
-- WHY: migrations rls_03/04/04b create policies on the tenant data tables but never run
-- `alter table ... enable row level security`. Enablement was done out-of-band (Supabase
-- dashboard), so it lives only in the live DB and would NOT survive a rebuild from these
-- numbered scripts. A policy on a table with RLS disabled is inert. See the 2026-08-25
-- security audit, finding C1.
--
-- ⚠️ NOT YET APPLIED. Review, then run in the Supabase SQL editor. This script is written to be
-- SAFE and idempotent: it enables RLS ONLY on tables that already have at least one policy, so
-- it can never turn a policy-less table into an accidental deny-all. After running it, run
-- rls_09_verify.sql and confirm P1 (anon sees nothing) and P14 (staff foreign-tenant write
-- blocked) still pass.
--
-- NOTE ON `force`: this enables RLS but does not FORCE it. FORCE additionally subjects the table
-- OWNER to RLS; the Supabase service_role has BYPASSRLS and is unaffected either way. Decide
-- per-table whether owner-side enforcement is wanted before adding `force` -- left out here to
-- avoid surprising the migration/seed tooling that may run as the owner.

do $$
declare
  r record;
begin
  for r in
    select distinct c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = false   -- only tables where RLS is currently OFF
  loop
    execute format('alter table public.%I enable row level security', r.table_name);
    raise notice 'enabled RLS on public.% (it had policies but RLS was off)', r.table_name;
  end loop;
end $$;

-- Report: every public table, whether RLS is on, and how many policies it has. Eyeball this
-- after running -- any tenant-scoped table with rls_enabled = false or policies = 0 is a hole.
select
  c.relname                                   as table_name,
  c.relrowsecurity                            as rls_enabled,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;
