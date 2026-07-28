-- Guard: stop non-super-admins changing privileged columns on public.profiles
-- Run this in the Supabase SQL editor. Safe to re-run.
--
-- WHY THIS EXISTS
--   profiles.role_id decides a user's role (get_my_role() reads it) and
--   profiles.company_id decides their tenant scope (get_my_company_id() reads it).
--   Every logged-in user has table-wide write privileges on profiles, gated only
--   by RLS. Without this guard, a user could set those columns on their own row
--   and become super_admin or hop tenants in a single request.
--
-- WHY IT COVERS INSERT AND UPDATE (adversarial review, 2026-07-28)
--   A BEFORE UPDATE-only trigger is bypassable: delete-then-insert, or a bare
--   insert, sets role_id/tenant_id/company_id without ever firing an update
--   trigger. This fires on BOTH insert and update, so the privileged columns
--   cannot be set on a new row either. (Closing the profiles INSERT/DELETE
--   policies for the authenticated role is done separately in the RLS plan; this
--   trigger is the belt to that braces.)

create or replace function public.guard_profiles_privileged_columns()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- Trusted database roles keep full control: service_role is our own server
  -- code, postgres/supabase_admin are the dashboard and SQL editor. An existing
  -- super admin may still legitimately assign roles and tenants.
  if current_user in ('service_role', 'supabase_admin', 'postgres')
     or coalesce(public.get_my_role(), '') = 'super_admin'
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A normal user self-provisioning must not choose their own power. On INSERT
    -- OLD does not exist, so any non-null privileged column is a set.
    if new.role_id is not null or new.tenant_id is not null or new.company_id is not null then
      raise exception
        'Setting role_id, tenant_id or company_id on a new profile is not permitted'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- UPDATE: block any change to the three power-granting columns. Everything else
  -- on the row (name, contact details) stays freely self-editable.
  if new.role_id    is distinct from old.role_id
     or new.tenant_id  is distinct from old.tenant_id
     or new.company_id is distinct from old.company_id
  then
    raise exception
      'Changing role_id, tenant_id or company_id on profiles is not permitted'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Fire before INSERT and UPDATE. A trigger runs regardless of RLS and of which
-- policy allowed the write, so it cannot be bypassed by a permissive policy.
drop trigger if exists guard_profiles_privileged_columns on public.profiles;

create trigger guard_profiles_privileged_columns
  before insert or update on public.profiles
  for each row
  execute function public.guard_profiles_privileged_columns();

-- VERIFY the trigger is installed and covers insert + update:
--   select tgname, pg_get_triggerdef(oid) from pg_trigger
--   where tgrelid = 'public.profiles'::regclass and not tgisinternal;

-- PROVE IT BLOCKS escalation without changing data. Replace <user-uuid> with a
-- real NON super-admin profiles.id. Each block is wrapped in a rollback.
--
--   -- 1. Self-promotion by UPDATE: expect ERROR.
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<user-uuid>","role":"authenticated"}';
--     update public.profiles
--        set role_id = (select id from public.roles where name = 'super_admin')
--      where id = '<user-uuid>';
--   rollback;
--
--   -- 2. Self-promotion by INSERT: expect ERROR.
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<user-uuid>","role":"authenticated"}';
--     insert into public.profiles (id, role_id)
--       values ('<some-new-uuid>', (select id from public.roles where name = 'super_admin'));
--   rollback;
--
--   -- 3. Control: a normal edit still works: expect UPDATE 1.
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<user-uuid>","role":"authenticated"}';
--     update public.profiles set full_name = full_name where id = '<user-uuid>';
--   rollback;

-- ROLLBACK the guard itself if needed:
--   drop trigger if exists guard_profiles_privileged_columns on public.profiles;
--   drop function if exists public.guard_profiles_privileged_columns();
