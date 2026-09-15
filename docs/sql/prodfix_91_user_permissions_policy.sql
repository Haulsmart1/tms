-- prodfix_91_user_permissions_policy.sql
--
-- Finding SQL-20. rls_06 records user_permissions as deny-all ("matching users/user_permissions"),
-- and rls_03 excludes it from re-keying, yet app/settings/permissions/page.tsx upserts
-- { user_id, page } into it with the browser client. So either the page is broken, or the table has
-- live policies and grants that no migration records, with nothing limiting which user a row targets.
-- Nothing in app/ reads the table for authorization today, which keeps this LOW, but it is a
-- ready-made escalation point for whoever wires it up.
--
-- CHOICE MADE (not deny-all): an admin may manage the permission rows of users in tenants they
-- manage, and nobody else may write. Concretely, for authenticated:
--   user_permissions_admin_manage  FOR ALL
--     using / with check: the row's user_id is a profile whose tenant_id passes
--     public.can_manage_tenant (super_admin, or admin of that tenant's company). If the table also
--     has a uuid tenant_id column, the row's tenant_id must pass can_manage_tenant AND equal that
--     profile's tenant_id.
--   user_permissions_self_read     SELECT own rows (user_id = auth.uid()), so a future "what may I
--     see" lookup works without widening anything.
-- Every other existing policy on the table is dropped (none is recorded in the repo; diag
-- 02_policy shows what they were). Deny-all was rejected because the settings fix agent is making
-- /settings/permissions work, and deny-all would silently break it again.
--
-- GRANTS: anon loses everything. authenticated gets select, insert, update, delete, bounded by the
-- policies above (a policy without a grant reads as an empty table, which is how this page broke).
-- This is the one place in this batch that ADDS a grant; the policy is what keeps it narrow.
--
-- Caveats for the settings agent:
--   - The admin must be able to SEE the target profile: profiles_select (rls_04) shows admins the
--     profiles of their own company, so a profile with a NULL company_id (audit L4) cannot be
--     managed. That fails closed.
--   - If the table has a NOT NULL tenant_id, the page's current upsert (no tenant_id) is rejected.
--
-- PRECONDITIONS (asserted): public.user_permissions exists with a uuid user_id; profiles has id and
-- tenant_id; public.can_manage_tenant(uuid) exists; this session owns the table. If the table does
-- not exist the file raises and changes nothing.
--
-- Diag to check first: 10_column (user_permissions), 02_policy (user_permissions), 01_table_rls.
-- prodfix_80 section J_user_perms shows the same. Safe to re-run.

begin;

do $$
begin
  if to_regclass('public.user_permissions') is null then
    raise exception 'prodfix_91: public.user_permissions does not exist. Nothing to do, nothing changed.';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.user_permissions'::regclass
                 and attname = 'user_id' and atttypid = 'uuid'::regtype and not attisdropped) then
    raise exception 'prodfix_91: public.user_permissions.user_id is missing or not uuid. Nothing changed.';
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.profiles'::regclass
                 and attname = 'tenant_id' and not attisdropped) then
    raise exception 'prodfix_91: public.profiles.tenant_id is missing. Nothing changed.';
  end if;
  if to_regprocedure('public.can_manage_tenant(uuid)') is null then
    raise exception 'prodfix_91: public.can_manage_tenant(uuid) is missing. Nothing changed.';
  end if;
  if not pg_has_role(current_user, (select relowner from pg_class where oid = 'public.user_permissions'::regclass), 'USAGE') then
    raise exception 'prodfix_91: % does not own public.user_permissions. Nothing changed.', current_user;
  end if;
end $$;

do $$
declare
  pol record;
  v_expr text;
begin
  execute 'alter table public.user_permissions enable row level security';

  for pol in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'user_permissions' loop
    execute format('drop policy %I on public.user_permissions', pol.policyname);
  end loop;

  if exists (select 1 from pg_attribute where attrelid = 'public.user_permissions'::regclass
             and attname = 'tenant_id' and atttypid = 'uuid'::regtype and not attisdropped) then
    v_expr := 'public.can_manage_tenant(user_permissions.tenant_id) and exists ('
              'select 1 from public.profiles p where p.id = user_permissions.user_id '
              'and p.tenant_id = user_permissions.tenant_id and public.can_manage_tenant(p.tenant_id))';
  else
    v_expr := 'exists (select 1 from public.profiles p where p.id = user_permissions.user_id '
              'and public.can_manage_tenant(p.tenant_id))';
  end if;

  execute format(
    'create policy user_permissions_admin_manage on public.user_permissions '
    'for all to authenticated using (%s) with check (%s)', v_expr, v_expr);

  execute 'create policy user_permissions_self_read on public.user_permissions '
          'for select to authenticated using (user_id = auth.uid())';
end $$;

revoke all on public.user_permissions from anon;
grant select, insert, update, delete on public.user_permissions to authenticated;

commit;

-- VERIFY (read-only). Expect rls=true, exactly the two policies, anon without privileges.
select c.relrowsecurity as rls,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'insert') as auth_insert,
       (select string_agg(policyname || ':' || cmd, ', ' order by policyname)
          from pg_policies where schemaname = 'public' and tablename = 'user_permissions') as policies
from pg_class c where c.oid = 'public.user_permissions'::regclass;
--
-- Behavioural check (rolled back): a STAFF user must not grant themselves a page.
--   begin;
--     set local role authenticated;
--     set local request.jwt.claims to '{"sub":"<STAFF_USER_ID>","role":"authenticated"}';
--     insert into public.user_permissions (user_id, page) values ('<STAFF_USER_ID>', 'billing');  -- expect ERROR (RLS)
--   rollback;
