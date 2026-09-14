-- diag_2026_09_14_live_state.sql
--
-- READ-ONLY diagnostic for the 2026-09-14 production-readiness review.
-- This is a check script, not a migration. It creates, alters and writes nothing.
--
-- How to run: paste the whole file into the Supabase SQL editor and run it.
-- The editor only shows the last statement's result, so everything is one
-- UNION ALL query returning (section, object, detail). Export it as CSV and
-- hand the CSV back. It contains schema metadata and aggregate counts only,
-- no customer rows, no emails, no names.
--
-- Settles review findings SQL-2, SQL-3, SQL-4, SQL-6, SQL-7, SQL-8, SQL-9,
-- SQL-10, SQL-12, SQL-13, SQL-14, SQL-20, POD-15, SET-1, SET-3, SET-7,
-- SET-12, ACC-1, ACC-8, ACC-9, BILL2-12.

with
-- 1. Every public table: RLS on?, forced?, policy count, grants to anon/authenticated.
tables as (
  select '01_table_rls'::text as section,
         c.relname::text as object,
         format('rls=%s force=%s policies=%s anon_select=%s anon_write=%s auth_select=%s auth_insert=%s auth_update=%s auth_delete=%s has_tenant_id=%s has_company_id=%s',
           c.relrowsecurity, c.relforcerowsecurity,
           (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
           has_table_privilege('anon', c.oid, 'select'),
           has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'),
           has_table_privilege('authenticated', c.oid, 'select'),
           has_table_privilege('authenticated', c.oid, 'insert'),
           has_table_privilege('authenticated', c.oid, 'update'),
           has_table_privilege('authenticated', c.oid, 'delete'),
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped),
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
         ) as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
-- 2. Every policy in public and storage, with its full expressions.
policies as (
  select '02_policy'::text,
         (schemaname || '.' || tablename || ' :: ' || policyname)::text,
         format('permissive=%s roles=%s cmd=%s using=%s with_check=%s',
           permissive, roles, cmd, coalesce(qual, '<none>'), coalesce(with_check, '<none>'))
  from pg_policies
  where schemaname in ('public', 'storage')
),
-- 3. Views and materialized views: do they run as owner (bypassing RLS)?
views as (
  select '03_view'::text,
         c.relname::text,
         format('kind=%s owner=%s security_invoker=%s anon_select=%s auth_select=%s',
           c.relkind, pg_get_userbyid(c.relowner),
           coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), 'false'),
           has_table_privilege('anon', c.oid, 'select'),
           has_table_privilege('authenticated', c.oid, 'select'))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
),
-- 4. Functions in public: definer?, search_path, who can execute.
functions as (
  select '04_function'::text,
         (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
         format('security_definer=%s config=%s anon_exec=%s auth_exec=%s public_exec=%s',
           p.prosecdef, coalesce(array_to_string(p.proconfig, ';'), '<none>'),
           has_function_privilege('anon', p.oid, 'execute'),
           has_function_privilege('authenticated', p.oid, 'execute'),
           exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
),
-- 5. Full source of the functions the review could not find in the repo.
function_src as (
  select '05_function_source'::text,
         (n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')::text,
         pg_get_functiondef(p.oid)::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prokind = 'f'
    and n.nspname in ('public', 'auth')
    and p.proname in (
      'auth_tenant_id', 'get_my_company_id', 'get_my_role', 'current_tenant_id', 'is_super_admin',
      'get_tenant_context', 'can_access_tenant', 'can_manage_tenant',
      'rls_verify', 'handle_new_user', 'accept_quotation_share', 'decline_quotation_share',
      'mark_quotation_share_viewed', 'accept_quotation_share_with_terms',
      'accept_quotation_share_with_business_identity', 'recalculate_invoice_totals',
      'next_invoice_number', 'next_credit_note_number', 'next_quotation_number'
    )
),
-- 6. Triggers on auth.users (how a brand-new signup is provisioned) and on key public tables.
triggers as (
  select '06_trigger'::text,
         (n.nspname || '.' || c.relname || ' :: ' || t.tgname)::text,
         format('enabled=%s fn=%s def=%s', t.tgenabled, t.tgfoid::regproc, pg_get_triggerdef(t.oid))
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and (n.nspname = 'auth' or (n.nspname = 'public' and c.relname in (
      'profiles', 'memberships', 'vehicles', 'vehicle_licences', 'jobs', 'job_stops', 'invoices',
      'invoice_payments', 'payments', 'payment_allocations', 'credit_notes', 'company_billing', 'tenants', 'companies')))
),
-- 7. Storage buckets: public flag and limits.
buckets as (
  select '07_bucket'::text, id::text,
         format('public=%s file_size_limit=%s allowed_mime_types=%s', public, file_size_limit, allowed_mime_types)
  from storage.buckets
),
-- 8. Foreign keys pointing at vehicles, companies, tenants, invoices: what a delete does.
fks as (
  select '08_fk'::text,
         (con.conrelid::regclass::text || ' -> ' || con.confrelid::regclass::text || ' :: ' || con.conname)::text,
         format('on_delete=%s def=%s',
           case con.confdeltype when 'a' then 'no action' when 'r' then 'restrict' when 'c' then 'CASCADE' when 'n' then 'set null' when 'd' then 'set default' end,
           pg_get_constraintdef(con.oid))
  from pg_constraint con
  where con.contype = 'f'
    and con.confrelid::regclass::text in ('vehicles', 'companies', 'tenants', 'invoices', 'jobs', 'job_stops', 'profiles')
),
-- 9. Unique constraints and unique indexes (upserts and numbering depend on these).
uniques as (
  select '09_unique_index'::text,
         (i.indrelid::regclass::text || ' :: ' || ic.relname)::text,
         pg_get_indexdef(i.indexrelid)::text
  from pg_index i join pg_class ic on ic.oid = i.indexrelid
  join pg_class tc on tc.oid = i.indrelid join pg_namespace n on n.oid = tc.relnamespace
  where n.nspname = 'public' and i.indisunique and not i.indisprimary
),
-- 10. Columns of the tables the review needs shapes for.
columns as (
  select '10_column'::text,
         (table_name || '.' || column_name)::text,
         format('type=%s nullable=%s default=%s', data_type, is_nullable, coalesce(column_default, '<none>'))
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('profiles', 'memberships', 'roles', 'company_profiles', 'vehicles', 'user_permissions',
                       'invoices', 'invoice_lines', 'credit_notes', 'payments', 'invoice_payments', 'payment_allocations',
                       'driver_users', 'job_items', 'job_item_scans', 'load_manifests', 'quotation_shares', 'tenants')
),
-- 11. Role catalogue (names only) and aggregate agreement between the two role models.
roles_catalogue as (
  select '11_roles_row'::text, r.id::text, r.name::text from public.roles r
),
role_agreement as (
  select '12_role_counts'::text, 'profiles'::text,
         format('total=%s null_company_id=%s null_tenant_id=%s null_role_id=%s',
           count(*), count(*) filter (where company_id is null),
           count(*) filter (where tenant_id is null), count(*) filter (where role_id is null))
  from public.profiles
  union all
  select '12_role_counts', 'memberships',
         format('total=%s distinct_users=%s users_with_multiple_rows=%s',
           count(*), count(distinct user_id),
           (select count(*) from (select user_id from public.memberships group by user_id having count(*) > 1) x))
  from public.memberships
  union all
  select '12_role_counts', 'memberships_vs_profiles_role_mismatch',
         format('mismatched_users=%s membership_without_profile=%s profile_without_membership=%s',
           (select count(distinct m.user_id) from public.memberships m
              join public.profiles p on p.id = m.user_id
              left join public.roles r on r.id = p.role_id
              where lower(coalesce(m.role, '')) is distinct from lower(coalesce(r.name, ''))),
           (select count(*) from public.memberships m where not exists (select 1 from public.profiles p where p.id = m.user_id)),
           (select count(*) from public.profiles p where not exists (select 1 from public.memberships m where m.user_id = p.id)))
)
select * from tables
union all select * from policies
union all select * from views
union all select * from functions
union all select * from function_src
union all select * from triggers
union all select * from buckets
union all select * from fks
union all select * from uniques
union all select * from columns
union all select * from roles_catalogue
union all select * from role_agreement
order by 1, 2;
