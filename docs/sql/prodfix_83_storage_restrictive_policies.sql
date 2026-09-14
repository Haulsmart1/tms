-- prodfix_83_storage_restrictive_policies.sql
--
-- Findings SQL-1 / POD-4 (job-files is cross-tenant), SQL-8 (pod-files restrictive policies bind
-- only `authenticated`), and audit item M7 (the pod-files restrictive policies were created in the
-- dashboard and never committed uncommented). SUPERSEDES docs/sql/rls_12_job_files_lockdown.sql.
--
-- WHY RESTRICTIVE, NOT DROP + CREATE
--   storage.objects is owned by supabase_storage_admin. rls_10a recorded that DROP POLICY on it
--   failed with 42501 from the SQL editor, and that the dashboard showed the original policies as
--   locked. rls_12 dropped policies by guessed names, which (a) hits the same 42501 and (b) even if
--   it ran, leaves any differently named bucket-only PERMISSIVE policy in place, and permissive
--   policies OR together. A RESTRICTIVE policy is ANDed with every permissive one, so it narrows
--   access whatever the original policies are called or say. This is what worked for pod-files.
--
-- WHAT IT CREATES (each only if a policy of that name does not already exist)
--   pod-files, reproducing what is live since 2026-08-10 (to authenticated):
--     pod_files_read_restrict    SELECT  first path segment is a tenant the caller can access
--     pod_files_insert_restrict  INSERT  same, on the new row
--     pod_files_update_deny      UPDATE  never (uploads are immutable)
--     pod_files_delete_deny      DELETE  never
--   job-files, the same four shapes (to authenticated):
--     job_files_read_restrict, job_files_insert_restrict, job_files_update_deny, job_files_delete_deny
--   SQL-8, both buckets (to public, which means every role, anon included):
--     pod_files_non_authenticated_deny / job_files_non_authenticated_deny
--       FOR ALL using / with check (bucket_id <> '<bucket>' or current_user = 'authenticated')
--     A restrictive policy constrains only the roles it names. If an original permissive policy is
--     `to public`, the `to authenticated` restrictive set never applies to anon, so anon-key storage
--     calls were unrestricted. This one applies to every role and lets only `authenticated`
--     through to the tenant checks above. It calls no function on purpose: a policy that applies
--     to anon and calls public.can_access_tenant would make EVERY anon storage request (any bucket)
--     fail with "permission denied for function" once prodfix_86 revokes anon EXECUTE.
--     service_role (BYPASSRLS) and the table owner are not subject to RLS, so server routes,
--     signed-URL generation and the dashboard storage browser are unaffected.
--
--   Every policy is written `bucket_id <> '<bucket>' or ...`, so rows in any other bucket pass
--   trivially: nothing outside pod-files and job-files can be tightened by this file.
--
-- EXISTING UPLOADS: pod-files uploads are written as `<tenant_id>/<stop_id>/...`
-- (app/jobs/StopCard.tsx, app/pod/page.tsx, driver evidence route). job-files has no code path;
-- any object in it without a tenant uuid as its first folder becomes unreadable to clients, which
-- is the intended result.
--
-- PRECONDITIONS (asserted below; any failure raises and nothing changes)
--   - storage.objects exists and has RLS enabled (policies on a table with RLS off are inert).
--   - public.can_access_tenant(uuid) exists and authenticated may EXECUTE it.
--   - this session can create policies on storage.objects (is a member of its owner role).
--   - no existing policy with one of the names above is PERMISSIVE or has a different command.
--
-- IF IT RAISES "cannot create policies on storage.objects" (the 42501 case)
--   Create the ten policies by hand in Dashboard > Storage > Policies > New policy > "For full
--   customization", one per statement generated in the second DO block: same name, same command,
--   RESTRICTIVE, same target roles (authenticated, or leave roles empty for public), and the USING /
--   WITH CHECK expression. The pod-files four already exist live (2026-08-10), so normally only
--   pod_files_non_authenticated_deny and the five job_files_* policies are needed. Then run the
--   VERIFY query at the bottom of this file.
--
-- job-files alternative: no app code uses the bucket. Emptying and deleting it in the dashboard
-- (Storage > job-files > delete bucket) closes SQL-1 outright; the job_files_* policies are then
-- inert but harmless.
--
-- Diag to check first: 02_policy (storage.objects rows: names, permissive, roles), 07_bucket,
-- 04_function (can_access_tenant auth_exec=true). Apply prodfix_82 first (the order is not needed
-- for safety, both only narrow).
--
-- Safe to re-run.

begin;

do $$
declare
  v_owner oid;
  v_rls   boolean;
  r       record;
begin
  select c.relowner, c.relrowsecurity into v_owner, v_rls
  from pg_class c where c.oid = to_regclass('storage.objects');
  if v_owner is null then
    raise exception 'prodfix_83: storage.objects not found. Nothing changed.';
  end if;
  if not v_rls then
    raise exception 'prodfix_83: RLS is OFF on storage.objects, so every storage policy is inert. Enabling it needs the table owner (%). Nothing changed.',
      pg_get_userbyid(v_owner);
  end if;
  if to_regprocedure('public.can_access_tenant(uuid)') is null then
    raise exception 'prodfix_83: public.can_access_tenant(uuid) is missing. Nothing changed.';
  end if;
  if not has_function_privilege('authenticated', 'public.can_access_tenant(uuid)', 'execute') then
    raise exception 'prodfix_83: authenticated cannot EXECUTE public.can_access_tenant(uuid); the tenant policies would error for every signed-in storage call. Nothing changed.';
  end if;
  if not pg_has_role(current_user, v_owner, 'USAGE') then
    raise exception 'prodfix_83: % cannot create policies on storage.objects (owner %). Create them in the dashboard as described in this file''s header. Nothing changed.',
      current_user, pg_get_userbyid(v_owner);
  end if;

  -- A pre-existing policy under one of our names must be the same kind, or we would silently
  -- skip a policy that does something else (a PERMISSIVE one would widen access).
  for r in
    select policyname, permissive, cmd from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'pod_files_read_restrict', 'pod_files_insert_restrict', 'pod_files_update_deny',
        'pod_files_delete_deny', 'pod_files_non_authenticated_deny',
        'job_files_read_restrict', 'job_files_insert_restrict', 'job_files_update_deny',
        'job_files_delete_deny', 'job_files_non_authenticated_deny')
  loop
    if r.permissive <> 'RESTRICTIVE'
       or (r.policyname like '%\_read\_restrict' and r.cmd <> 'SELECT')
       or (r.policyname like '%\_insert\_restrict' and r.cmd <> 'INSERT')
       or (r.policyname like '%\_update\_deny' and r.cmd <> 'UPDATE')
       or (r.policyname like '%\_delete\_deny' and r.cmd <> 'DELETE')
       or (r.policyname like '%\_non\_authenticated\_deny' and r.cmd <> 'ALL')
    then
      raise exception 'prodfix_83: existing storage policy % is % %, not the expected RESTRICTIVE shape. Inspect it (diag 02_policy) first. Nothing changed.',
        r.policyname, r.permissive, r.cmd;
    end if;
  end loop;
end $$;

do $$
declare
  b      text;
  p      text;  -- policy name prefix: pod_files / job_files
  v_seg  constant text :=
    '(storage.foldername(name))[1] ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'' '
    'and public.can_access_tenant(((storage.foldername(name))[1])::uuid)';
begin
  foreach b in array array['pod-files', 'job-files'] loop
    p := replace(b, '-', '_');

    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = p || '_read_restrict') then
      execute format(
        'create policy %I on storage.objects as restrictive for select to authenticated '
        'using (bucket_id <> %L or (%s))', p || '_read_restrict', b, v_seg);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = p || '_insert_restrict') then
      execute format(
        'create policy %I on storage.objects as restrictive for insert to authenticated '
        'with check (bucket_id <> %L or (%s))', p || '_insert_restrict', b, v_seg);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = p || '_update_deny') then
      execute format(
        'create policy %I on storage.objects as restrictive for update to authenticated '
        'using (bucket_id <> %L) with check (bucket_id <> %L)', p || '_update_deny', b, b);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = p || '_delete_deny') then
      execute format(
        'create policy %I on storage.objects as restrictive for delete to authenticated '
        'using (bucket_id <> %L)', p || '_delete_deny', b);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                   and policyname = p || '_non_authenticated_deny') then
      execute format(
        'create policy %I on storage.objects as restrictive for all to public '
        'using (bucket_id <> %L or current_user = ''authenticated'') '
        'with check (bucket_id <> %L or current_user = ''authenticated'')',
        p || '_non_authenticated_deny', b, b);
    end if;
  end loop;
end $$;

commit;

-- VERIFY (read-only). Expect, for EACH of pod-files and job-files: the original PERMISSIVE policies
-- (whatever their names and roles) plus exactly five RESTRICTIVE rows: read_restrict (SELECT,
-- {authenticated}), insert_restrict (INSERT, {authenticated}), update_deny (UPDATE,
-- {authenticated}), delete_deny (DELETE, {authenticated}), non_authenticated_deny (ALL, {public}).
-- A PERMISSIVE row whose roles are not {authenticated} is covered by non_authenticated_deny.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (coalesce(qual, '') ~ '(pod|job)-files' or coalesce(with_check, '') ~ '(pod|job)-files'
       or policyname ~ '^(pod|job)_files_')
order by (coalesce(qual, '') || coalesce(with_check, '')) ~ 'job-files', permissive desc, cmd, policyname;

-- Behavioural check from the app, not the SQL editor (the editor runs as a BYPASSRLS role):
--   signed in as tenant A: supabase.storage.from('job-files').list('<tenant B uuid>')  -> []
--   signed in as tenant A: supabase.storage.from('pod-files').remove(['<own tenant>/x']) -> nothing removed
--   anon key, no session:  supabase.storage.from('pod-files').list('<any tenant uuid>') -> []
