-- Guard: stop non-super-admins changing privileged columns on public.profiles
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- WHY THIS EXISTS
--   profiles.role_id decides a user's role (get_my_role() reads it) and
--   profiles.company_id decides their tenant (get_my_company_id() reads it).
--   Every logged-in user has table-wide UPDATE on profiles, and the
--   profiles_update_self policy lets them update their own row while checking
--   only id = auth.uid(). Nothing checks that role_id, tenant_id and company_id
--   are left alone. So any authenticated user can send one request:
--
--     PATCH /rest/v1/profiles?id=eq.<their-own-id>
--     { "role_id": "<the super_admin role uuid>" }
--
--   and get_my_role() returns 'super_admin' for them everywhere. The same trick
--   on company_id hops them into another tenant's data. This trigger closes both
--   by rejecting any change to those three columns unless the caller is already a
--   super admin, or is the trusted service role used only by our own server code.

-- The guard function.
-- SECURITY INVOKER (the default) is deliberate: the function must see the REAL
-- caller in current_user (authenticated / anon / service_role). A SECURITY
-- DEFINER function would report the definer instead and defeat the role check.
-- get_my_role() is itself SECURITY DEFINER, so it still resolves the caller's
-- app role correctly when called from here.
create or replace function public.guard_profiles_privileged_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Only the three power-granting columns are protected. Everything else on the
  -- row (name, contact details, and so on) stays freely self-editable.
  if (new.role_id    is distinct from old.role_id
      or new.tenant_id  is distinct from old.tenant_id
      or new.company_id is distinct from old.company_id)
     -- Trusted database roles keep full control. The service role is only ever
     -- used from our own server code; postgres / supabase_admin are the dashboard
     -- and SQL editor, so your own admin edits are never blocked.
     and current_user not in ('service_role', 'supabase_admin', 'postgres')
     -- An existing super admin may still legitimately reassign roles and tenants.
     and coalesce(public.get_my_role(), '') <> 'super_admin'
  then
    raise exception
      'Changing role_id, tenant_id or company_id on profiles is not permitted'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Fire it before every row update on profiles. A trigger runs regardless of RLS
-- and regardless of which policy allowed the write, so it cannot be bypassed by
-- the permissive profiles_update_self policy.
drop trigger if exists guard_profiles_privileged_columns on public.profiles;

create trigger guard_profiles_privileged_columns
  before update on public.profiles
  for each row
  execute function public.guard_profiles_privileged_columns();

-- VERIFY the trigger is installed (expect one row):
--   select tgname from pg_trigger
--   where tgrelid = 'public.profiles'::regclass and not tgisinternal;

-- PROVE IT BLOCKS the escalation, without changing any data (both wrapped in a
-- rollback). Replace <user-uuid> with a real NON super-admin profiles.id.
--
--   -- 1. Self-promotion attempt: expect ERROR "insufficient_privilege".
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<user-uuid>","role":"authenticated"}';
--     update public.profiles
--        set role_id = (select id from public.roles where name = 'super_admin')
--      where id = '<user-uuid>';
--   rollback;
--
--   -- 2. Control: a normal edit still works: expect UPDATE 1.
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<user-uuid>","role":"authenticated"}';
--     update public.profiles set full_name = full_name where id = '<user-uuid>';
--   rollback;

-- ROLLBACK the guard itself if it ever gets in the way:
--   drop trigger if exists guard_profiles_privileged_columns on public.profiles;
--   drop function if exists public.guard_profiles_privileged_columns();
