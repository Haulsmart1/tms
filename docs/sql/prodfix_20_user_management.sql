-- prodfix_20_user_management.sql
--
-- Server-side user provisioning for /settings/users, keyed on profiles (the
-- single source of truth RLS and get_tenant_context() use), with memberships
-- still written for compatibility only.
--
-- Review findings: AUTH-2 / SET-2 (invite never set company_id or role_id, so
-- invitees were locked out), AUTH-9 / SET-24 (invite paged through every auth
-- user and wrote profile, membership and role in separate non-atomic steps),
-- SET-6 (re-invite silently changed a role and skipped the last-admin guard),
-- SET-7 (role edits did not reach profiles.role_id), SET-9 (a tenant admin
-- could rewrite a super_admin), SET-10 (no way to remove a user), AUTH-11
-- (invite responses revealed whether an email had an account).
--
-- What this adds, all SECURITY DEFINER, search_path pinned, EXECUTE for
-- service_role only (the API routes authorize the caller first with
-- lib/auth/serverTenantAccess.ts, then call these):
--   find_auth_user_id_by_email(text)                        -> uuid or null
--   provision_tenant_user(uuid, text, uuid, text)           -> outcome text
--   set_company_user_role(uuid, uuid, text, boolean)        -> void
--   remove_company_user(uuid, uuid, boolean)                -> void
--
-- Failures are raised with a stable message token (for example 'last_admin')
-- which app/api/settings/users maps to a friendly response. Raw database
-- errors are never sent to the browser.
--
-- LIVE-STATE DEPENDENCIES (check docs/sql/diag_2026_09_14_live_state.sql):
--   * public.roles must contain rows named exactly 'admin', 'staff' and
--     'driver'. Section 11 of the diag lists them. The seed block below adds
--     'staff' and 'driver' only when missing, and only if roles.name can be
--     inserted on its own; if it cannot, it prints a NOTICE and the routes
--     answer a clear "role is not configured" error until a row is added by
--     hand. A 'driver' or 'staff' role is staff tier everywhere in RLS
--     (only 'admin' and 'super_admin' are elevated), so seeding them grants
--     nothing new.
--   * public.users(id) must be unique (the old invite route relied on it).
--   * profiles.id, profiles.company_id, profiles.tenant_id, profiles.role_id,
--     memberships(user_id, tenant_id, role), driver_users(user_id, tenant_id,
--     active) and subcontractor_users(user_id, tenant_id, active) must exist,
--     as the current app code already assumes.
--
-- Nothing here widens access: every function is callable by service_role
-- only, and none of them grants a role above 'admin'.
--
-- Safe to re-run.

begin;

-- 1. Look up an auth user by email without paging through auth.admin.listUsers.
create or replace function public.find_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.id
  from auth.users u
  where p_email is not null
    and lower(u.email) = lower(btrim(p_email))
  order by u.created_at
  limit 1;
$$;

revoke all on function public.find_auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_auth_user_id_by_email(text) to service_role;

-- Internal: the roles.id for an exact name, or an error token.
create or replace function public.prodfix_role_id(p_role text)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  select array_agg(r.id) into v_ids from public.roles r where r.name = p_role;
  if v_ids is null or array_length(v_ids, 1) = 0 then
    raise exception 'role_missing';
  end if;
  if array_length(v_ids, 1) > 1 then
    raise exception 'role_ambiguous';
  end if;
  return v_ids[1];
end $$;

revoke all on function public.prodfix_role_id(text) from public, anon, authenticated;
grant execute on function public.prodfix_role_id(text) to service_role;

-- 2. Attach an auth user to a tenant, atomically.
--
-- Outcomes (returned, never raised):
--   'created'         profile had no company, tenant or role: all three set
--   'repaired'        profile already homed in this company but missing
--                     company_id or role_id (the AUTH-2 lockout): filled in,
--                     an existing role is never changed
--   'already_member'  profile already belongs to this company: nothing changed
--   'other_company'   profile belongs to another company, or is a super
--                     admin: nothing changed. The route answers exactly as it
--                     does for 'created', so the response reveals nothing.
create or replace function public.provision_tenant_user(
  p_user_id uuid,
  p_email text,
  p_tenant_id uuid,
  p_role text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_role_id uuid;
  v_profile record;
  v_home_company uuid;
  v_outcome text;
begin
  if p_user_id is null or p_tenant_id is null then
    raise exception 'invalid_arguments';
  end if;
  if p_role is null or p_role not in ('admin', 'staff', 'driver') then
    raise exception 'invalid_role';
  end if;

  select t.company_id into v_company from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'tenant_not_found';
  end if;
  if v_company is null then
    raise exception 'tenant_without_company';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user_not_found';
  end if;

  v_role_id := public.prodfix_role_id(p_role);

  -- memberships.user_id references public.users, so make sure the row exists.
  insert into public.users (id, email)
  values (p_user_id, lower(btrim(coalesce(p_email, ''))))
  on conflict (id) do nothing;

  -- A signup trigger may already have created a bare profile; either way,
  -- lock one row and decide from it.
  insert into public.profiles (id) values (p_user_id) on conflict (id) do nothing;

  select p.id, p.company_id, p.tenant_id, p.role_id, r.name as role_name
    into v_profile
    from public.profiles p
    left join public.roles r on r.id = p.role_id
   where p.id = p_user_id
   for update of p;

  if v_profile.role_name = 'super_admin' then
    return 'other_company';
  end if;

  v_home_company := coalesce(
    v_profile.company_id,
    (select t.company_id from public.tenants t where t.id = v_profile.tenant_id)
  );

  if v_profile.company_id is null and v_profile.tenant_id is null then
    update public.profiles
       set tenant_id = p_tenant_id,
           company_id = v_company,
           role_id = v_role_id
     where id = p_user_id;
    v_outcome := 'created';
  elsif v_home_company is not distinct from v_company
        and v_profile.tenant_id is not null then
    if v_profile.company_id is null or v_profile.role_id is null then
      update public.profiles
         set company_id = v_company,
             role_id = coalesce(v_profile.role_id, v_role_id)
       where id = p_user_id;
      v_outcome := 'repaired';
    else
      return 'already_member';
    end if;
  else
    return 'other_company';
  end if;

  insert into public.memberships (tenant_id, user_id, role)
  select p_tenant_id, p_user_id,
         coalesce((select r.name from public.roles r
                   join public.profiles p on p.role_id = r.id
                   where p.id = p_user_id), p_role)
  where not exists (
    select 1 from public.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = p_user_id
  );

  return v_outcome;
end $$;

revoke all on function public.provision_tenant_user(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.provision_tenant_user(uuid, text, uuid, text) to service_role;

-- Internal: lock the target profile and prove it belongs to the company.
-- Returns the current role name (null when unset).
create or replace function public.prodfix_lock_company_profile(
  p_user_id uuid,
  p_company_id uuid,
  p_caller_is_super boolean
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile record;
begin
  select p.id, p.company_id, p.tenant_id, r.name as role_name
    into v_profile
    from public.profiles p
    left join public.roles r on r.id = p.role_id
   where p.id = p_user_id
   for update of p;

  if not found
     or coalesce(
          v_profile.company_id,
          (select t.company_id from public.tenants t where t.id = v_profile.tenant_id)
        ) is distinct from p_company_id then
    raise exception 'not_in_company';
  end if;

  if v_profile.role_name = 'super_admin' and not coalesce(p_caller_is_super, false) then
    raise exception 'super_admin_protected';
  end if;

  return v_profile.role_name;
end $$;

revoke all on function public.prodfix_lock_company_profile(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.prodfix_lock_company_profile(uuid, uuid, boolean) to service_role;

-- Internal: raise 'last_admin' when p_user_id is the company's only admin.
-- Locks every admin profile of the company so two concurrent demotions
-- cannot each see the other as the remaining admin.
create or replace function public.prodfix_assert_not_last_admin(
  p_user_id uuid,
  p_company_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_role uuid;
  v_others integer;
begin
  select r.id into v_admin_role from public.roles r where r.name = 'admin' limit 1;
  if v_admin_role is null then
    raise exception 'role_missing';
  end if;

  perform 1 from public.profiles p
   where p.company_id = p_company_id and p.role_id = v_admin_role
   for update;

  select count(*) into v_others
    from public.profiles p
   where p.company_id = p_company_id
     and p.role_id = v_admin_role
     and p.id <> p_user_id;

  if v_others = 0 then
    raise exception 'last_admin';
  end if;
end $$;

revoke all on function public.prodfix_assert_not_last_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.prodfix_assert_not_last_admin(uuid, uuid) to service_role;

-- 3. Change a company user's role. profiles.role_id is written (so RLS sees a
-- demotion on the very next query) and memberships is kept in step.
create or replace function public.set_company_user_role(
  p_user_id uuid,
  p_company_id uuid,
  p_role text,
  p_caller_is_super boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current text;
  v_role_id uuid;
begin
  if p_role is null or p_role not in ('admin', 'staff', 'driver') then
    raise exception 'invalid_role';
  end if;

  v_current := public.prodfix_lock_company_profile(p_user_id, p_company_id, p_caller_is_super);
  v_role_id := public.prodfix_role_id(p_role);

  if v_current = 'admin' and p_role <> 'admin' then
    perform public.prodfix_assert_not_last_admin(p_user_id, p_company_id);
  end if;

  update public.profiles
     set role_id = v_role_id,
         company_id = p_company_id
   where id = p_user_id;

  update public.memberships m
     set role = p_role
   where m.user_id = p_user_id
     and m.tenant_id in (select t.id from public.tenants t where t.company_id = p_company_id);
end $$;

revoke all on function public.set_company_user_role(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.set_company_user_role(uuid, uuid, text, boolean) to service_role;

-- 4. Remove a user from a company: detach the profile, drop that company's
-- memberships, and switch off their portal links in its tenants. The auth
-- account itself is kept (it may belong to a person who is re-invited later);
-- with no company, tenant or role, RLS and every profile-based API check deny
-- them from the next request.
create or replace function public.remove_company_user(
  p_user_id uuid,
  p_company_id uuid,
  p_caller_is_super boolean
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current text;
begin
  v_current := public.prodfix_lock_company_profile(p_user_id, p_company_id, p_caller_is_super);

  if v_current = 'admin' then
    perform public.prodfix_assert_not_last_admin(p_user_id, p_company_id);
  end if;

  update public.profiles
     set company_id = null,
         tenant_id = null,
         role_id = null
   where id = p_user_id;

  delete from public.memberships m
   where m.user_id = p_user_id
     and m.tenant_id in (select t.id from public.tenants t where t.company_id = p_company_id);

  update public.driver_users d
     set active = false
   where d.user_id = p_user_id
     and d.tenant_id in (select t.id from public.tenants t where t.company_id = p_company_id);

  update public.subcontractor_users s
     set active = false
   where s.user_id = p_user_id
     and s.tenant_id in (select t.id from public.tenants t where t.company_id = p_company_id);
end $$;

revoke all on function public.remove_company_user(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.remove_company_user(uuid, uuid, boolean) to service_role;

-- 5. Seed the staff and driver role rows when missing (see header).
do $$
declare
  v_name text;
begin
  foreach v_name in array array['staff', 'driver'] loop
    if not exists (select 1 from public.roles where name = v_name) then
      begin
        insert into public.roles (name) values (v_name);
      exception when others then
        raise notice 'prodfix_20: could not seed role % (%). Add it by hand.', v_name, sqlerrm;
      end;
    end if;
  end loop;
end $$;

commit;

-- Verify (expect: every row exec_anon=false, exec_auth=false, exec_service=true;
-- and the three role names each present exactly once):
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'execute') as exec_anon,
--        has_function_privilege('authenticated', p.oid, 'execute') as exec_auth,
--        has_function_privilege('service_role', p.oid, 'execute') as exec_service
--   from pg_proc p
--  where p.pronamespace = 'public'::regnamespace
--    and p.proname in ('find_auth_user_id_by_email', 'prodfix_role_id', 'provision_tenant_user',
--                      'prodfix_lock_company_profile', 'prodfix_assert_not_last_admin',
--                      'set_company_user_role', 'remove_company_user');
-- select name, count(*) from public.roles where name in ('admin', 'staff', 'driver') group by name;
