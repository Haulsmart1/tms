-- prodfix_92_jobs_policy_drift.sql
--
-- Finding SQL-9. OPTIONAL: apply only if diag section 02_policy shows drift on jobs or job_stops.
--
-- supabase/migrations/20260819_planning.sql (three weeks after rls_03) says both tables "already
-- carry tenant policies (cmd ALL, tenant_id = get_my_company_id())". rls_03 should have left exactly
-- one policy on each: tenant_access FOR ALL to authenticated using / with check
-- public.can_access_tenant(tenant_id). A company-id predicate compares a tenant key with a company
-- id: staff lose their own tenant's rows, and rows that carry the company id in tenant_id become
-- visible to everyone in the company whichever depot they belong to.
--
-- WHAT IT DOES, per table (jobs, job_stops):
--   - exactly one policy, and it is the rls_03 tenant_access shape  -> no-op.
--   - otherwise, every existing policy must be RECOGNISABLY legacy: its expression calls
--     get_my_company_id(), auth_tenant_id() or current_tenant_id(), or is `true`, or it is the rls_03
--     shape. Then all of them are dropped and rls_03's tenant_access is recreated.
--   - any other policy (something purpose-built this file does not recognise) -> raise, nothing
--     changes, so a deliberate policy is never silently replaced.
-- rls_03's policy is the documented model (staff: own tenant; admin: the company's tenants).
--
-- Rows whose tenant_id is not a real tenants.id (for example a company id) stop being visible to
-- non-super users after this. The verify query counts them so they can be re-pointed.
--
-- PRECONDITIONS (asserted): both tables exist with a uuid tenant_id; public.can_access_tenant(uuid)
-- exists; this session owns them. Diag to check first: 02_policy (jobs, job_stops), 01_table_rls.
-- Safe to re-run.

begin;

do $$
declare
  t text;
  pol record;
  v_total int;
  v_ok int;
  v_rls03 constant text := 'can_access_tenant\(tenant_id\)';
begin
  if to_regprocedure('public.can_access_tenant(uuid)') is null then
    raise exception 'prodfix_92: public.can_access_tenant(uuid) is missing. Nothing changed.';
  end if;

  foreach t in array array['jobs', 'job_stops'] loop
    if to_regclass('public.' || t) is null
       or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.' || t)
                        and attname = 'tenant_id' and atttypid = 'uuid'::regtype and not attisdropped) then
      raise exception 'prodfix_92: public.% missing or has no uuid tenant_id. Nothing changed.', t;
    end if;
    if not pg_has_role(current_user, (select relowner from pg_class where oid = to_regclass('public.' || t)), 'USAGE') then
      raise exception 'prodfix_92: % does not own public.%. Nothing changed.', current_user, t;
    end if;

    select count(*),
           count(*) filter (where policyname = 'tenant_access' and cmd = 'ALL'
                              and roles = '{authenticated}'
                              and coalesce(qual, '') ~ v_rls03 and coalesce(with_check, '') ~ v_rls03)
      into v_total, v_ok
    from pg_policies where schemaname = 'public' and tablename = t;

    if v_total = 1 and v_ok = 1 then
      raise notice 'prodfix_92: public.% already matches rls_03, unchanged', t;
      continue;
    end if;

    for pol in
      select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = t
    loop
      if not (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ~* '(get_my_company_id|auth_tenant_id|current_tenant_id|can_access_tenant)'
         and not (coalesce(pol.qual, '') in ('true', '') and coalesce(pol.with_check, '') in ('true', '')) then
        raise exception 'prodfix_92: public.% has policy % that this file does not recognise (%). Decide by hand. Nothing changed.',
          t, pol.policyname, coalesce(pol.qual, pol.with_check);
      end if;
    end loop;

    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy tenant_access on public.%I for all to authenticated '
      'using (public.can_access_tenant(tenant_id)) '
      'with check (public.can_access_tenant(tenant_id))', t);
    raise notice 'prodfix_92: public.% re-keyed to rls_03 tenant_access', t;
  end loop;
end $$;

commit;

-- VERIFY (read-only): one tenant_access row per table, plus rows that point at no tenant.
select 'policy' as kind, tablename as object, policyname || ' ' || cmd || ' ' || roles::text || ' ' || coalesce(qual, '') as detail
from pg_policies where schemaname = 'public' and tablename in ('jobs', 'job_stops')
union all
select 'orphan_tenant_rows', 'jobs', count(*)::text
from public.jobs j where not exists (select 1 from public.tenants t where t.id = j.tenant_id)
union all
select 'orphan_tenant_rows', 'job_stops', count(*)::text
from public.job_stops s where not exists (select 1 from public.tenants t where t.id = s.tenant_id);
