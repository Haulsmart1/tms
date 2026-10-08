-- signup_01_create_company_with_admin.sql
--
-- SUPERSEDED IN PART (2026-10-08): prodfix_96 STEP 3 replaces create_company_with_admin. The
-- body below inserts a bare profile (id only), which fails on the live NOT NULL
-- profiles.tenant_id. Do not re-run this file after prodfix_96; re-run prodfix_96 instead.
--
--
-- Self-serve signup: create a company, its first tenant, its company profile and
-- its founding admin in ONE transaction. Called only by POST /api/signup on the
-- service role, after the route has created the auth user and before it sends
-- the invite email. Spec: docs/superpowers/specs/2026-09-16-self-serve-signup-design.md.
--
-- WHAT THIS FUNCTION MUST NEVER DO
--   * Read raw_user_meta_data or user_metadata (review finding SQL-13). The
--     client controls that JSON. Tenant, company and role come from this
--     function's own arguments, which only the service-role route supplies.
--   * Be callable by `authenticated` or `anon`. Supabase's default privileges
--     grant EXECUTE on every new public function to both; the revoke below
--     removes that, and the grant names service_role alone.
--   * Insert into company_billing. That row is created only by
--     POST /api/billing/card, which writes billing_model = 'v2_period'. The
--     column default is still 'v1_immediate', so any other writer would make a
--     v1 company by accident (docs/superpowers/specs/2026-09-11-v2-billing-ui-
--     and-pricing-design.md, section 7).
--
-- WHAT IT DEPENDS ON
--   * prodfix_20: public.prodfix_role_id(text), and a roles row named exactly
--     'admin'. It raises role_missing / role_ambiguous if not.
--   * prodfix_88: guard_profiles_tenant_company_match requires that
--     profiles.company_id is the company of profiles.tenant_id for every
--     writer including this one. The function writes exactly that.
--   * The profiles privileged-column guard exempts current_user = postgres,
--     which is what current_user is inside a SECURITY DEFINER function the
--     postgres role owns. Apply this file as postgres (the SQL editor does).
--
-- OUTCOMES (returned, never raised)
--   'created'         company, tenant, company profile, public.users row,
--                     profile (tenant_id, company_id, role_id = admin,
--                     full_name) and a legacy memberships row all written.
--   'already_member'  the profile already belongs to a company (company_id
--                     set, or tenant_id set on a tenant that has a company):
--                     no company, tenant, company profile, binding or
--                     membership written. A bare public.users row and a bare
--                     profiles row may be inserted first so there is a row to
--                     lock. Calling twice for one user creates one company.
--
-- ERRORS (raised as stable tokens; the route never forwards database text)
--   invalid_arguments   null user id, or an empty company name
--   user_not_found      no auth.users row for p_user_id
--   role_missing / role_ambiguous   from prodfix_role_id
--   not_eligible        the profile is a super_admin (platform staff are never
--                       a company's founding admin; prodfix_20's
--                       provision_tenant_user refuses the same case)
--
-- Also adds a unique index on roles.name. prodfix_role_id exists to raise
-- role_ambiguous only because nothing prevented duplicates; this makes the
-- catalogue mean what every caller already assumes. Guarded, so it is a no-op
-- where the index already exists, and it fails loudly (and rolls back with the
-- rest of the file) if the live table already holds duplicate names.
--
-- Safe to re-run.

begin;

create unique index if not exists roles_name_key on public.roles (name);

create or replace function public.create_company_with_admin(
  p_user_id      uuid,
  p_email        text,
  p_company_name text,
  p_contact_name text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_name text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_contact_name text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_email        text := lower(btrim(coalesce(p_email, '')));
  v_role_id      uuid;
  v_company_id   uuid;
  v_tenant_id    uuid;
  v_profile      record;
begin
  if p_user_id is null or v_company_name is null then
    raise exception 'invalid_arguments';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found';
  end if;

  -- Resolved before any write, so a missing role leaves nothing behind.
  v_role_id := public.prodfix_role_id('admin');

  -- memberships.user_id references public.users, so the row must exist first.
  insert into public.users (id, email)
  values (p_user_id, v_email)
  on conflict (id) do nothing;

  -- A bare profile may already exist (an earlier failed attempt, or a
  -- provisioning trigger). Either way, lock one row and decide from it.
  insert into public.profiles (id) values (p_user_id) on conflict (id) do nothing;

  select p.id, p.company_id, p.tenant_id, p.role_id, p.full_name
    into v_profile
    from public.profiles p
   where p.id = p_user_id
     for update of p;

  if v_profile.company_id is not null
     or exists (select 1 from public.tenants t
                 where t.id = v_profile.tenant_id and t.company_id is not null) then
    return 'already_member';
  end if;

  -- Never re-role platform staff. Unreachable through /api/signup, which only
  -- calls this for a user it created moments earlier, but this is a
  -- service_role primitive any future caller can reach.
  if exists (select 1 from public.roles r
              where r.id = v_profile.role_id and r.name = 'super_admin') then
    raise exception 'not_eligible';
  end if;

  insert into public.companies (name)
  values (v_company_name)
  returning id into v_company_id;

  -- The first tenant is named after the company; the admin can rename it.
  insert into public.tenants (name, company_id)
  values (v_company_name, v_company_id)
  returning id into v_tenant_id;

  -- company_profiles.tenant_id holds the COMPANY id (rls_04_identity_tables.sql,
  -- lib/superAdmin/companyEdit.ts). Locale and identity fields are left for
  -- /settings/company.
  insert into public.company_profiles (tenant_id, company_name)
  values (v_company_id, v_company_name)
  on conflict (tenant_id) do update set company_name = excluded.company_name;

  -- All three columns, or get_tenant_context() answers no-tenant
  -- (rls_07_tenant_context.sql). full_name only when the profile has none, so
  -- a name a person already chose is never overwritten.
  update public.profiles
     set tenant_id  = v_tenant_id,
         company_id = v_company_id,
         role_id    = v_role_id,
         full_name  = coalesce(full_name, v_contact_name)
   where id = p_user_id;

  -- Legacy, written for compatibility only; nothing reads it for authorization.
  insert into public.memberships (tenant_id, user_id, role)
  select v_tenant_id, p_user_id, 'admin'
  where not exists (
    select 1 from public.memberships m
     where m.tenant_id = v_tenant_id and m.user_id = p_user_id
  );

  return 'created';
end $$;

revoke all on function public.create_company_with_admin(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_company_with_admin(uuid, text, text, text) to service_role;

commit;

-- VERIFY 1 (read-only): grants. Expect exec_anon=false, exec_auth=false, exec_service=true.
--   select has_function_privilege('anon', 'public.create_company_with_admin(uuid,text,text,text)', 'execute') as exec_anon,
--          has_function_privilege('authenticated', 'public.create_company_with_admin(uuid,text,text,text)', 'execute') as exec_auth,
--          has_function_privilege('service_role', 'public.create_company_with_admin(uuid,text,text,text)', 'execute') as exec_service;
--
-- VERIFY 2 (read-only): the index. Expect one row.
--   select indexdef from pg_indexes where schemaname = 'public' and indexname = 'roles_name_key';
--
-- VERIFY 3 (rolled back): a dry run against an existing auth user id.
--   begin;
--     select public.create_company_with_admin('<auth user id>', 'x@example.com', 'Dry Run Haulage', 'Dry Run');
--     select c.name, t.name as tenant, p.company_id = c.id as bound, r.name as role
--       from public.profiles p
--       join public.companies c on c.id = p.company_id
--       join public.tenants t on t.id = p.tenant_id
--       join public.roles r on r.id = p.role_id
--      where p.id = '<auth user id>';
--   rollback;
