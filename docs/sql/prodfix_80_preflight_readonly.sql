-- prodfix_80_preflight_readonly.sql
--
-- READ-ONLY pre-flight for the prodfix_8x/9x database security batch (fix agent H).
-- Creates, alters and writes nothing. Run it before the batch and again after it,
-- then compare. Findings: SQL-1, SQL-2, SQL-3, SQL-4, SQL-8, SQL-13, SQL-14,
-- SQL-15, SQL-19, SQL-20, POD-15.
--
-- It complements docs/sql/diag_2026_09_14_live_state.sql (which settles WHAT the
-- live state is); this file answers WHAT EACH prodfix FILE WILL DO to that state.
-- Catalog queries only, so it cannot fail on a missing application table.
--
-- The Supabase SQL editor shows only the last statement's result, so this is one
-- UNION ALL query returning (section, object, detail).
--
-- Sections:
--   A_rls_off        tables with RLS OFF and what docs/sql/rls_11 will do to each
--                    (SQL-2 part a). "BROWSER READS" means app code reads it with
--                    the user's key: deny-all there breaks that page.
--   B_rls_on_nopol   tables with RLS ON and zero policies (already deny-all today)
--   C_view           views / materialized views (prodfix_84)
--   D_auth_tenant_id policies that call auth_tenant_id() (prodfix_85)
--   E_storage_policy storage.objects policies on pod-files / job-files (prodfix_83)
--   E_storage_owner  whether this role may create policies on storage.objects
--   F_definer_fn     SECURITY DEFINER functions: anon EXECUTE, search_path (prodfix_86)
--   G_auth_trigger   triggers on auth.users and whether they read user metadata (prodfix_89)
--   H_server_version security_invoker needs PG15 (prodfix_84)
--   I_unindexed      tenant tables with no index led by tenant_id, and size (prodfix_93)
--   J_user_perms     user_permissions columns and policies (prodfix_91)

with browser_tables(name) as (
  -- Tables app code reads or writes with the browser (anon key + user JWT) or the
  -- cookie-scoped server client, found by grep on 2026-09-14. RLS applies to these.
  values ('assets'), ('asset_types'), ('tenants'), ('companies'), ('company_profiles'),
         ('profiles'), ('user_permissions'), ('registration_requests'),
         ('invoices'), ('jobs'), ('job_stops'), ('job_items'), ('customers'),
         ('subcontractors'), ('subcontractor_employees'), ('subcontractor_vehicles'),
         ('drivers'), ('driver_licence_checks'), ('driver_licence_endorsements'),
         ('driver_training'), ('driver_activity_logs'), ('vehicle_assignments'),
         ('vehicles'), ('vehicle_licences'), ('vehicle_locations'),
         ('fleet_insurance_policies'), ('maintenance_records'), ('pod_evidence'),
         ('planning_route_itineraries'), ('planning_route_visits'),
         ('planning_route_visit_stops'), ('telematics_positions'),
         ('company_billing'), ('platform_charges'), ('vehicle_addon_charges'),
         ('period_charges')
),
tbl as (
  select c.oid, c.relname::text as name, c.relrowsecurity as rls,
         (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
         exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id'
                   and a.atttypid = 'uuid'::regtype and not a.attisdropped) as tenant_uuid,
         pg_has_role(current_user, c.relowner, 'USAGE') as owned,
         exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e') as extension_member,
         c.relname ~* '(secret|token|credential|oauth|password|billing|charge|period|subscription|audit|rate_limit|integration)' as sensitive,
         exists (select 1 from browser_tables b where b.name = c.relname) as browser
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
a_rls_off as (
  select 'A_rls_off'::text as section, name as object,
         format('policies=%s tenant_id_uuid=%s anon_select=%s auth_insert=%s%s -> rls_11 will: %s',
           policies, tenant_uuid,
           has_table_privilege('anon', oid, 'select'), has_table_privilege('authenticated', oid, 'insert'),
           case when browser then ' BROWSER READS' else '' end,
           case
             when extension_member then 'SKIP (extension-owned)'
             when not owned then 'SKIP (not owned by ' || current_user || ')'
             when policies > 0 then 'enable RLS, keep existing policies (check them in diag 02_policy)'
             when tenant_uuid and not sensitive then 'enable RLS + tenant_access policy (can_access_tenant)'
             when tenant_uuid and sensitive then 'enable RLS, DENY-ALL (sensitive name, no auto policy)'
             else 'enable RLS, DENY-ALL (no tenant_id)' ||
                  case when browser then ' <<< WILL BREAK A BROWSER PAGE' else '' end
           end) as detail
  from tbl where not rls
),
b_rls_on_nopol as (
  select 'B_rls_on_nopol'::text, name,
         format('already deny-all for client roles%s', case when browser then ' BROWSER READS: that page is already broken or reads nothing' else '' end)
  from tbl where rls and policies = 0
),
c_view as (
  select 'C_view'::text, c.relname::text,
         format('kind=%s owner=%s owned_by_me=%s security_invoker=%s anon_select=%s auth_select=%s',
           c.relkind, pg_get_userbyid(c.relowner), pg_has_role(current_user, c.relowner, 'USAGE'),
           coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false'),
           has_table_privilege('anon', c.oid, 'select'), has_table_privilege('authenticated', c.oid, 'select'))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
),
d_auth_tenant_id as (
  select 'D_auth_tenant_id'::text, (schemaname || '.' || tablename || ' :: ' || policyname)::text,
         format('cmd=%s roles=%s using=%s with_check=%s', cmd, roles, coalesce(qual, '<none>'), coalesce(with_check, '<none>'))
  from pg_policies
  where coalesce(qual, '') ilike '%auth_tenant_id%' or coalesce(with_check, '') ilike '%auth_tenant_id%'
),
e_storage_policy as (
  select 'E_storage_policy'::text, policyname::text,
         format('permissive=%s roles=%s cmd=%s using=%s with_check=%s', permissive, roles, cmd,
           coalesce(qual, '<none>'), coalesce(with_check, '<none>'))
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (coalesce(qual, '') ~ '(pod|job)-files' or coalesce(with_check, '') ~ '(pod|job)-files'
         or policyname ~ '^(pod|job)_files_')
),
e_storage_owner as (
  select 'E_storage_owner'::text, 'storage.objects'::text,
         format('owner=%s current_user=%s can_create_policies=%s rls=%s',
           pg_get_userbyid(c.relowner), current_user, pg_has_role(current_user, c.relowner, 'USAGE'), c.relrowsecurity)
  from pg_class c where c.oid = to_regclass('storage.objects')
),
f_definer_fn as (
  select 'F_definer_fn'::text, (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
         format('owner=%s anon_exec=%s auth_exec=%s public_exec=%s config=%s pg_temp_last=%s',
           pg_get_userbyid(p.proowner),
           has_function_privilege('anon', p.oid, 'execute'), has_function_privilege('authenticated', p.oid, 'execute'),
           exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'),
           coalesce(array_to_string(p.proconfig, ';'), '<none>'),
           coalesce(array_to_string(p.proconfig, ';'), '') ~ 'search_path=.*pg_temp\s*$')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
),
g_auth_trigger as (
  select 'G_auth_trigger'::text, (c.relname || ' :: ' || t.tgname)::text,
         format('fn=%s definer=%s reads_user_metadata=%s mentions_privileged_cols=%s writes_identity_tables=%s verdict=%s',
           t.tgfoid::regproc, p.prosecdef,
           p.prosrc ~* '(raw_user_meta_data|user_metadata)',
           p.prosrc ~* '(tenant_id|company_id|role_id|\mrole\M)',
           p.prosrc ~* '(profiles|memberships|driver_users|subcontractor_users)',
           case when p.prosrc ~* '(raw_user_meta_data|user_metadata)' and p.prosrc ~* '(tenant_id|company_id|role_id|\mrole\M)'
                then 'UNSAFE PATTERN: see prodfix_89' else 'no known unsafe pattern' end)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
),
h_server_version as (
  select 'H_server_version'::text, 'server_version_num'::text,
         format('%s (security_invoker needs >= 150000)', current_setting('server_version_num'))
),
i_unindexed as (
  select 'I_unindexed'::text, t.name,
         format('size=%s rows_estimate=%s', pg_size_pretty(pg_total_relation_size(t.oid)), c.reltuples::bigint)
  from tbl t join pg_class c on c.oid = t.oid
  join pg_attribute a on a.attrelid = t.oid and a.attname = 'tenant_id' and not a.attisdropped
  where not exists (select 1 from pg_index i where i.indrelid = t.oid and i.indkey[0] = a.attnum)
),
j_user_perms as (
  select 'J_user_perms'::text, ('column ' || a.attname)::text, format_type(a.atttypid, a.atttypmod)::text
  from pg_attribute a
  where a.attrelid = to_regclass('public.user_permissions') and a.attnum > 0 and not a.attisdropped
  union all
  select 'J_user_perms', ('policy ' || policyname)::text, format('cmd=%s roles=%s using=%s with_check=%s', cmd, roles, qual, with_check)
  from pg_policies where schemaname = 'public' and tablename = 'user_permissions'
)
select * from a_rls_off
union all select * from b_rls_on_nopol
union all select * from c_view
union all select * from d_auth_tenant_id
union all select * from e_storage_policy
union all select * from e_storage_owner
union all select * from f_definer_fn
union all select * from g_auth_trigger
union all select * from h_server_version
union all select * from i_unindexed
union all select * from j_user_perms
order by 1, 2;
