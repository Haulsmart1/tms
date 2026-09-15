-- prodfix_86_security_definer_hardening.sql
--
-- Findings SQL-14 (SECURITY DEFINER functions revoke EXECUTE only from PUBLIC, so anon keeps it)
-- and SQL-15 (search_path without pg_temp lets a temp table shadow public tables inside a definer
-- function).
--
-- BACKGROUND: on Supabase, the default privileges of `postgres` grant EXECUTE on every new public
-- function to anon and authenticated DIRECTLY, as separate ACL entries. `revoke all ... from public`
-- does not remove them. When pg_temp is not listed in search_path, Postgres searches it FIRST for
-- relations, so it must be named, and named last.
--
-- WHAT IT DOES: for each function name below, for every overload of that name in public that is
-- SECURITY DEFINER and owned by a role this session belongs to:
--   1. alter function ... set search_path = public, pg_temp
--      (pg_catalog is always searched first when it is not listed, so this matches the
--      `pg_catalog, public` the planning and tachograph functions used, plus pg_temp last.)
--      ALTER only: no function body is touched.
--   2. applies the EXECUTE audience:
--      authenticated   revoke all from public, anon; grant execute to authenticated, service_role
--      service         revoke all from public, anon, authenticated; grant execute to service_role
--      service_checked "service", UNLESS something in the database depends on the function (a
--                      column default, policy, view, trigger or constraint in pg_depend) or another
--                      function's source mentions its name; then "authenticated" instead, because a
--                      column default or trigger evaluates as the calling user. Reported either way.
--      trigger         revoke all from public, anon, authenticated (a trigger fires without an
--                      EXECUTE check, so nobody needs a grant)
--      path_only       search_path only. Grants for these belong to review finding SQL-6
--                      (quotation acceptance RPCs), owned by the invoices fix agent.
--   Invoker functions, and names that do not exist, are skipped silently.
--
-- WHO CALLS WHAT (grep of .rpc( in app/ and lib/, 2026-09-14):
--   browser (authenticated):     get_tenant_context (TenantProvider), assign_driver_to_vehicle,
--                                unassign_vehicle (drivers page), replace_planning_route_itinerary,
--                                invalidate_planning_route_itinerary (planning page)
--   cookie server client:        upsert_manual_driver_activity, delete_manual_driver_activity
--                                (app/api/tachograph/activity), get_my_company_id (lib/tomtom/server)
--   RLS policy expressions:      can_access_tenant, can_manage_tenant, get_my_role,
--                                get_my_company_id, current_tenant_id, is_super_admin, auth_tenant_id
--                                (evaluated as the querying role, so authenticated must keep EXECUTE)
--   service role only:           create_load_manifest, record_load_manifest_event,
--                                next_invoice_number, next_quotation_number, recalculate_invoice_totals,
--                                recalculate_quotation_totals, convert_quotation_to_job
--   left alone here:             rate_limit_hit (prodfix_01, already correct), record_cycle_charge
--                                (invoker, billing), accept_* / decline_* / mark_quotation_share_viewed
--                                grants (SQL-6)
--
-- ANON CONSEQUENCE, read before applying: a policy that applies to anon (roles {public} or {anon})
-- and calls one of the helpers will, after this, make an anon query on that table ERROR with
-- "permission denied for function" instead of returning no rows. That is still a deny, and no app
-- path queries tables or storage with the anon key alone, but check diag 02_policy for policies
-- with roles {public}/{anon} whose expression calls can_access_tenant, can_manage_tenant,
-- get_my_role, get_my_company_id, current_tenant_id, is_super_admin or auth_tenant_id, especially on
-- storage.objects (a public bucket read by anon would start failing).
--
-- PRECONDITIONS: none beyond ownership; functions this session does not own are skipped and shown
-- by the verify query.
--
-- Diag to check first: 04_function (security_definer, config, anon_exec, auth_exec, public_exec),
-- 02_policy (see ANON CONSEQUENCE), 10_column (column defaults naming next_*_number).
-- Apply after prodfix_85 (prodfix_83's policies call can_access_tenant only for authenticated).
-- If another agent's prodfix file later does `create or replace function` on one of these without
-- a search_path, re-run this file: it is idempotent.

begin;

do $$
declare
  spec record;
  r    record;
  v_aud text;
  v_deps int;
  v_callers int;
begin
  for spec in
    select * from (values
      ('can_access_tenant',                        'authenticated'),
      ('can_manage_tenant',                        'authenticated'),
      ('get_tenant_context',                       'authenticated'),
      ('get_my_role',                              'authenticated'),
      ('get_my_company_id',                        'authenticated'),
      ('current_tenant_id',                        'authenticated'),
      ('is_super_admin',                           'authenticated'),
      ('auth_tenant_id',                           'authenticated'),
      ('replace_planning_route_itinerary',         'authenticated'),
      ('invalidate_planning_route_itinerary',      'authenticated'),
      ('upsert_manual_driver_activity',            'authenticated'),
      ('delete_manual_driver_activity',            'authenticated'),
      ('assign_driver_to_vehicle',                 'authenticated'),
      ('unassign_vehicle',                         'authenticated'),
      ('create_load_manifest',                     'service'),
      ('record_load_manifest_event',               'service'),
      ('next_invoice_number',                      'service_checked'),
      ('next_credit_note_number',                  'service_checked'),
      ('next_quotation_number',                    'service_checked'),
      ('recalculate_invoice_totals',               'service_checked'),
      ('recalculate_quotation_totals',             'service_checked'),
      ('convert_quotation_to_job',                 'service_checked'),
      ('snapshot_quotation_terms_on_share_insert', 'trigger'),
      ('handle_new_user',                          'trigger'),
      ('guard_profiles_tenant_company_match',      'trigger'),
      ('enforce_job_items_tenant',                 'trigger'),
      ('enforce_job_item_scans_tenant',            'trigger'),
      ('accept_quotation_share_with_terms',        'path_only'),
      ('accept_quotation_share_with_business_identity', 'path_only'),
      ('accept_quotation_share',                   'path_only'),
      ('decline_quotation_share',                  'path_only'),
      ('mark_quotation_share_viewed',              'path_only')
    ) v(fname, audience)
  loop
    for r in
      select p.oid, p.oid::regprocedure as sig,
             pg_has_role(current_user, p.proowner, 'USAGE') as owned
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = spec.fname and p.prokind = 'f' and p.prosecdef
    loop
      if not r.owned then
        raise notice 'prodfix_86: SKIPPED % (not owned by %)', r.sig, current_user;
        continue;
      end if;

      v_aud := spec.audience;
      if v_aud = 'service_checked' then
        select count(*) into v_deps
        from pg_depend d
        where d.refclassid = 'pg_proc'::regclass and d.refobjid = r.oid
          and d.classid in ('pg_attrdef'::regclass, 'pg_policy'::regclass, 'pg_rewrite'::regclass,
                            'pg_trigger'::regclass, 'pg_constraint'::regclass);
        select count(*) into v_callers
        from pg_proc q join pg_namespace qn on qn.oid = q.pronamespace
        where q.oid <> r.oid
          and qn.nspname not in ('pg_catalog', 'information_schema')
          and q.prosrc ~* ('\m' || spec.fname || '\M');
        if v_deps + v_callers > 0 then
          raise notice 'prodfix_86: % has % dependents and % calling functions; keeping authenticated EXECUTE', r.sig, v_deps, v_callers;
          v_aud := 'authenticated';
        else
          v_aud := 'service';
        end if;
      end if;

      execute format('alter function %s set search_path = public, pg_temp', r.sig);

      if v_aud = 'authenticated' then
        execute format('revoke all on function %s from public, anon', r.sig);
        execute format('grant execute on function %s to authenticated, service_role', r.sig);
      elsif v_aud = 'service' then
        execute format('revoke all on function %s from public, anon, authenticated', r.sig);
        execute format('grant execute on function %s to service_role', r.sig);
      elsif v_aud = 'trigger' then
        execute format('revoke all on function %s from public, anon, authenticated', r.sig);
      end if;

      raise notice 'prodfix_86: % -> %', r.sig, v_aud;
    end loop;
  end loop;
end $$;

commit;

-- VERIFY (read-only): every SECURITY DEFINER function in public. Expect config to end in
-- "search_path=public, pg_temp" and anon_exec=false for every function named in this file except
-- the path_only group. Rows for functions NOT named here need a decision: they were never in the
-- repo, so find their caller before revoking anything.
select p.oid::regprocedure as function,
       pg_get_userbyid(p.proowner) as owner,
       coalesce(array_to_string(p.proconfig, ';'), '<none>') as config,
       has_function_privilege('anon', p.oid, 'execute') as anon_exec,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
       has_function_privilege('service_role', p.oid, 'execute') as service_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
order by anon_exec desc, p.proname;
