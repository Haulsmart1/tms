-- prodfix_88_profiles_guard_extend.sql
--
-- Finding SQL-7, database side. Decision already taken: profiles (role_id, company_id, tenant_id) is
-- the single source of truth for roles and tenancy. Nothing here reads memberships.
--
-- CONFIRMED FROM THE REPO: docs/sql/profiles_privileged_columns_guard.sql blocks client writes to
-- role_id, company_id and tenant_id on both INSERT and UPDATE for every role except service_role,
-- supabase_admin, postgres and an existing super_admin, and rls_05 revokes INSERT/DELETE on profiles
-- from anon/authenticated. So a signed-in user cannot promote themselves or hop tenants through
-- PostgREST. Two gaps remain, closed here:
--
-- GAP 1: the guard only knows three column names. If profiles carries another power-bearing column
--   (a text `role`, `is_super_admin`, `is_admin`, `user_role`), or a user rewrites `id`, the guard
--   does not see it. The replacement compares through to_jsonb(), so a column that does not exist
--   reads NULL on both sides and costs nothing, and a column that does exist is protected. RLS
--   `with check (id = auth.uid())` already stops a self-edit changing id; the guard is the second
--   layer.
--
-- GAP 2: nothing binds profiles.company_id to the company of profiles.tenant_id. The service-role
--   routes are exempt from the guard (they are "our own server code"), and a route bug can write a
--   tenant from company A with company_id B, making that user an RLS admin over the wrong company
--   (SQL-7's failure scenario). The new BEFORE INSERT / UPDATE OF tenant_id, company_id trigger
--   requires, for EVERY role including service_role, that when both are non-null the tenant belongs
--   to that company. A NULL company_id is still allowed (the invite route currently omits it, audit
--   L4; get_tenant_context then answers 'no-tenant', which fails closed). Existing rows are not
--   rewritten; a bad existing row only raises when its tenant_id or company_id is next changed.
--   The pre-check below reports how many such rows exist, so they can be fixed deliberately.
--
-- The remaining SQL-7 half is app side (which caller may write role_id through a service route),
-- owned by the settings fix agent.
--
-- PRECONDITIONS (asserted): profiles has role_id, tenant_id, company_id; tenants has company_id;
-- public.get_my_role() exists; this session owns profiles.
--
-- Diag to check first: 06_trigger (profiles rows: guard_profiles_privileged_columns present),
-- 10_column (profiles columns), 12_role_counts. Safe to re-run.

begin;

do $$
declare v_col text;
begin
  foreach v_col in array array['role_id', 'tenant_id', 'company_id'] loop
    if not exists (select 1 from pg_attribute where attrelid = to_regclass('public.profiles')
                   and attname = v_col and not attisdropped) then
      raise exception 'prodfix_88: public.profiles.% is missing. Nothing changed.', v_col;
    end if;
  end loop;
  if not exists (select 1 from pg_attribute where attrelid = to_regclass('public.tenants')
                 and attname = 'company_id' and not attisdropped) then
    raise exception 'prodfix_88: public.tenants.company_id is missing (rls_01). Nothing changed.';
  end if;
  if to_regprocedure('public.get_my_role()') is null then
    raise exception 'prodfix_88: public.get_my_role() is missing. Nothing changed.';
  end if;
  if not pg_has_role(current_user, (select relowner from pg_class where oid = 'public.profiles'::regclass), 'USAGE') then
    raise exception 'prodfix_88: % does not own public.profiles. Nothing changed.', current_user;
  end if;
end $$;

-- GAP 1: same exemptions and messages as profiles_privileged_columns_guard.sql, wider column set.
create or replace function public.guard_profiles_privileged_columns()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_key text;
  v_insert_keys constant text[] := array['role_id', 'tenant_id', 'company_id', 'role',
                                         'is_super_admin', 'is_admin', 'user_role'];
  v_update_keys constant text[] := array['id', 'role_id', 'tenant_id', 'company_id', 'role',
                                         'is_super_admin', 'is_admin', 'user_role'];
begin
  -- Deliberately NOT security definer: current_user must be the real caller.
  if current_user in ('service_role', 'supabase_admin', 'postgres')
     or coalesce(public.get_my_role(), '') = 'super_admin'
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    foreach v_key in array v_insert_keys loop
      if v_new ? v_key and jsonb_typeof(v_new -> v_key) <> 'null'
         and not (v_key in ('is_super_admin', 'is_admin') and v_new -> v_key = 'false'::jsonb) then
        raise exception
          'Setting role_id, tenant_id, company_id or another role column on a new profile is not permitted'
          using errcode = 'insufficient_privilege';
      end if;
    end loop;
    return new;
  end if;

  v_old := to_jsonb(old);
  foreach v_key in array v_update_keys loop
    if (v_new -> v_key) is distinct from (v_old -> v_key) then
      raise exception
        'Changing id, role_id, tenant_id, company_id or another role column on profiles is not permitted'
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists guard_profiles_privileged_columns on public.profiles;
create trigger guard_profiles_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profiles_privileged_columns();

-- GAP 2: tenant must belong to the stated company. SECURITY DEFINER so the tenants lookup is not
-- narrowed by the caller's RLS (a false "mismatch" for a legitimate service or super_admin write).
create or replace function public.guard_profiles_tenant_company_match()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.tenant_id is not null and new.company_id is not null
     and not exists (select 1 from public.tenants t
                     where t.id = new.tenant_id and t.company_id = new.company_id)
  then
    raise exception 'profiles.tenant_id % does not belong to profiles.company_id %',
      new.tenant_id, new.company_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profiles_tenant_company_match() from public, anon, authenticated;

drop trigger if exists guard_profiles_tenant_company_match on public.profiles;
create trigger guard_profiles_tenant_company_match
  before insert or update of tenant_id, company_id on public.profiles
  for each row execute function public.guard_profiles_tenant_company_match();

commit;

-- VERIFY 1 (read-only): both triggers installed. Expect 2 rows.
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid = 'public.profiles'::regclass and not tgisinternal
--     and tgname in ('guard_profiles_privileged_columns', 'guard_profiles_tenant_company_match');
--
-- VERIFY 2 (read-only): existing rows that already break the binding. Fix each deliberately
-- (usually company_id should follow the tenant). Expect 0.
select p.id, p.tenant_id, p.company_id as profile_company, t.company_id as tenant_company
from public.profiles p
left join public.tenants t on t.id = p.tenant_id
where p.tenant_id is not null and p.company_id is not null
  and t.company_id is distinct from p.company_id;
--
-- VERIFY 3 (escalation still blocked, rolled back): as in profiles_privileged_columns_guard.sql:
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<NON_SUPER_USER_ID>","role":"authenticated"}';
--     update public.profiles set company_id = gen_random_uuid() where id = '<NON_SUPER_USER_ID>';  -- expect ERROR
--   rollback;
