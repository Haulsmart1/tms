-- RLS Tenancy Hardening -- 11: make RLS ENABLEMENT explicit and reproducible.
--
-- WHY: migrations rls_03/04/04b create policies on the tenant data tables but never run
-- `alter table ... enable row level security`. Enablement was done out-of-band (Supabase
-- dashboard), so it lives only in the live DB and would NOT survive a rebuild from these
-- numbered scripts. A policy on a table with RLS disabled is inert. See the 2026-08-25
-- security audit, finding C1.
--
-- NOT YET APPLIED. Corrected 2026-09-14 for review finding SQL-2 (production-readiness
-- review). The first draft enabled RLS only on tables that already had a policy. That skipped
-- the worst case: a table with RLS OFF and ZERO policies, which is fully readable and writable
-- by any role holding Supabase's default grants. This version enables RLS on EVERY public table
-- and decides deliberately what a policy-less table gets.
--
-- WHAT IT DOES, per public table (relkind r or p) that has RLS OFF:
--   1. has at least one policy       -> enable RLS, keep the policies as they are.
--                                       Enabling makes them take effect. It cannot widen access,
--                                       because with RLS off the table was already fully open.
--                                       Review any `to public` / `using (true)` ones in diag
--                                       section 02_policy all the same.
--   2. zero policies, has a uuid     -> enable RLS and add `tenant_access` FOR ALL to authenticated
--      tenant_id column                 using/with check public.can_access_tenant(tenant_id): the
--                                       exact default-branch policy rls_03 gives tenant tables.
--   3. zero policies, tenant_id,     -> enable RLS, NO policy (deny-all for anon/authenticated).
--      sensitive-looking name           Name matches secret|token|credential|oauth|password|billing|
--                                       charge|period|subscription|audit|rate_limit|integration.
--                                       These are service-role tables in this codebase; a staff
--                                       read+write policy would be the wrong default.
--   4. zero policies, no tenant_id   -> enable RLS, NO policy (deny-all for anon/authenticated).
--                                       Child tables (*_lines, *_allocations) land here. If the
--                                       browser reads one directly, that page breaks: see
--                                       docs/sql/prodfix_80_README.md for the list, and give the
--                                       table a parent-scoped policy instead, e.g.
--                                       using (exists (select 1 from public.invoices i
--                                              where i.id = invoice_id and public.can_access_tenant(i.tenant_id)))
--   5. extension-owned (e.g. PostGIS spatial_ref_sys) or owned by a role this session is not a
--      member of -> SKIPPED and left unchanged (ALTER TABLE needs ownership). The report shows them
--      as rls_enabled = false.
--
-- A policy is never added to a table that already has RLS on, and no grant is ever added, so this
-- file cannot widen anyone's access. The service_role key has BYPASSRLS, so every server route
-- using createAdminClient is unaffected.
--
-- BEFORE APPLYING: run docs/sql/prodfix_80_preflight_readonly.sql and read section A_rls_off. It
-- prints, per table, the action above and flags "WILL BREAK A BROWSER PAGE".
--
-- NOTE ON `force`: this enables RLS but does not FORCE it (FORCE also subjects the table owner).
-- service_role has BYPASSRLS and is unaffected either way.
--
-- Idempotent: a second run finds no table with RLS off and changes nothing. If anything raises,
-- the whole transaction rolls back.
--
-- AFTER: re-run prodfix_80 and confirm section A_rls_off lists only SKIP rows, then run
-- rls_09_verify.sql (and prodfix_81 straight after it) and confirm P1 and P14 still pass.

begin;

do $$
begin
  if to_regprocedure('public.can_access_tenant(uuid)') is null then
    raise exception 'rls_11: public.can_access_tenant(uuid) is missing; apply rls_02/rls_08 first. Nothing changed.';
  end if;
end $$;

do $$
declare
  r record;
  v_sensitive constant text :=
    '(secret|token|credential|oauth|password|billing|charge|period|subscription|audit|rate_limit|integration)';
begin
  for r in
    select c.oid, c.relname,
           (select count(*) from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) as policies,
           exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id'
                      and a.atttypid = 'uuid'::regtype and not a.attisdropped) as tenant_uuid,
           pg_has_role(current_user, c.relowner, 'USAGE') as owned,
           exists (select 1 from pg_depend d
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e') as ext
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity = false
    order by c.relname
  loop
    if r.ext or not r.owned then
      raise notice 'rls_11: SKIPPED public.% (extension-owned or not owned by %)', r.relname, current_user;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', r.relname);

    if r.policies > 0 then
      raise notice 'rls_11: enabled RLS on public.% (kept % existing policies)', r.relname, r.policies;
    elsif r.tenant_uuid and r.relname !~* v_sensitive then
      execute format(
        'create policy tenant_access on public.%I for all to authenticated '
        'using (public.can_access_tenant(tenant_id)) '
        'with check (public.can_access_tenant(tenant_id))', r.relname);
      raise notice 'rls_11: enabled RLS on public.% and added tenant_access', r.relname;
    else
      raise notice 'rls_11: enabled RLS on public.% with NO policy (deny-all for client roles)', r.relname;
    end if;
  end loop;
end $$;

commit;

-- Report (read-only): every public table after the change. rls_enabled = false rows are the
-- SKIPPED ones. policies = 0 with rls_enabled = true is deny-all for anon/authenticated.
select
  c.relname                                   as table_name,
  c.relrowsecurity                            as rls_enabled,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as policies,
  exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id'
            and not a.attisdropped)           as has_tenant_id
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relrowsecurity, policies, c.relname;
