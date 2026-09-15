-- prodfix_89_auth_users_provisioning_check.sql
--
-- Finding SQL-13. READ-ONLY CHECK. Creates, alters and writes nothing.
--
-- THE RISK: nothing in the repo shows how a new auth user becomes a profile. If a live trigger on
-- auth.users (a Supabase `handle_new_user`-style function) copies raw_user_meta_data into
-- profiles.tenant_id / company_id / role_id, or into memberships, driver_users or
-- subcontractor_users, then whoever controls that metadata chooses their own tenant and role.
--   - raw_user_meta_data is supplied by the CLIENT at signUp / signInWithOtp({ options: { data } })
--     and can be changed later with supabase.auth.updateUser({ data }).
--   - The app itself writes tenant_id and role into user_metadata when inviting
--     (app/api/settings/users/invite, portal-invites, subcontractor/users/invite), so such a trigger
--     is plausible, not hypothetical.
--   - profiles_privileged_columns_guard does NOT catch it: a SECURITY DEFINER trigger function runs
--     as its owner, postgres, which the guard exempts.
--   - app/login/page.tsx currently lets any email address create an auth user (being changed by the
--     auth fix agent), and GoTrue's /auth/v1/signup stays open until signups are disabled in the
--     dashboard, whatever the login page does.
--
-- WHY NO AUTOMATIC REPLACEMENT: the function body is not in the repo, and the invite flows put the
-- same keys in user_metadata that an attacker would. A replacement guessed from here could break
-- invite provisioning (a portal driver or subcontractor row the trigger creates) as easily as it
-- could close the hole. So this file reports, and the hardened shape is given below as a template to
-- apply only after reading the live source (diag 05_function_source, 06_trigger).
--
-- HOW TO READ THE RESULT
--   verdict = UNSAFE PATTERN   the trigger function reads user metadata AND mentions a privileged
--                              column. Treat as exploitable until the source proves otherwise.
--   verdict = review           it writes identity tables but does not visibly read metadata keys.
--   verdict = no known unsafe pattern
--   no rows at all             no trigger on auth.users: provisioning is purely the service-role
--                              routes, which is the intended design. SQL-13 then reduces to
--                              "disable public signups".
--
-- WHAT A SAFE PROVISIONING TRIGGER LOOKS LIKE (template, do not run blind):
--   create or replace function public.handle_new_user()
--   returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
--   begin
--     -- identity only; tenant, company and role are assigned by a service-role route after
--     -- checking the inviter, never read from raw_user_meta_data
--     insert into public.profiles (id, email) values (new.id, new.email)
--     on conflict (id) do nothing;
--     return new;
--   end $fn$;
--   revoke all on function public.handle_new_user() from public, anon, authenticated;
-- If privileged data must travel with the auth user, use raw_app_meta_data (settable only with the
-- service role, e.g. admin.auth.admin.updateUserById(id, { app_metadata })), never user_metadata.
--
-- DASHBOARD ACTION regardless of the result: Authentication > Sign In / Providers > disable
-- "Allow new users to sign up". admin.auth.admin.inviteUserByEmail keeps working with signups off.

select
  n.nspname || '.' || c.relname                       as table_name,
  t.tgname                                            as trigger_name,
  t.tgenabled                                         as enabled,
  t.tgfoid::regprocedure                              as function,
  p.prosecdef                                         as security_definer,
  pg_get_userbyid(p.proowner)                         as function_owner,
  p.prosrc ~* '(raw_user_meta_data|user_metadata)'    as reads_user_metadata,
  p.prosrc ~* '(tenant_id|company_id|role_id|\mrole\M)' as mentions_privileged_columns,
  p.prosrc ~* '(profiles|memberships|driver_users|subcontractor_users)' as writes_identity_tables,
  case
    when p.prosrc ~* '(raw_user_meta_data|user_metadata)'
     and p.prosrc ~* '(tenant_id|company_id|role_id|\mrole\M)' then 'UNSAFE PATTERN'
    when p.prosrc ~* '(profiles|memberships|driver_users|subcontractor_users)' then 'review'
    else 'no known unsafe pattern'
  end                                                 as verdict,
  pg_get_functiondef(p.oid)                           as source
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
order by verdict, trigger_name;
