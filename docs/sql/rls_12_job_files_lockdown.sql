-- RLS Tenancy Hardening -- 12: lock down the `job-files` storage bucket.
--
-- WHY: discovery during the pod-files work (see rls_10a comments) found a SECOND bucket,
-- `job-files`, left with 4 permissive `bucket_id`-only storage.objects policies and marked
-- public -- a cross-tenant leak of the same class pod-files had. See the 2026-08-25 security
-- audit, finding H2.
--
-- CONTEXT THAT MAKES THIS LOW-RISK: a repo-wide grep for "job-files" in app/ and lib/ finds NO
-- code that reads or writes this bucket today. So tightening it cannot break a live code path.
-- The policies below mirror the pod-files tenant-segment scheme (first path segment = tenant
-- UUID, checked via can_access_tenant) so that IF job-files is later used with the same
-- convention it keeps working; until then it is effectively deny-all for non-matching paths.
--
-- ⚠️ NOT YET APPLIED. Review, then run in the Supabase SQL editor. storage.objects already has
-- RLS enabled (rls_10a). After running, confirm from the storage policies list that job-files is
-- covered by exactly the restrictive policies below and the bucket is no longer public.

-- 1) Make the bucket private (signed URLs only, like pod-files).
update storage.buckets set public = false where id = 'job-files';

-- 2) Drop the known-permissive job-files policies if they exist. Names come from the Supabase
--    default template; adjust to match what the storage policies list actually shows.
drop policy if exists "job-files insert"  on storage.objects;
drop policy if exists "job-files select"  on storage.objects;
drop policy if exists "job-files update"  on storage.objects;
drop policy if exists "job-files delete"  on storage.objects;

-- 3) Restrictive, tenant-scoped policies. RESTRICTIVE means they AND with any remaining
--    permissive policy, so they can only tighten. For any row NOT in job-files the check passes
--    trivially (`bucket_id <> 'job-files'`), so these never affect other buckets.

-- SELECT: same-tenant only.
create policy job_files_read_restrict on storage.objects
  as restrictive for select to authenticated using (
    bucket_id <> 'job-files'
    or ((storage.foldername(name))[1] ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and public.can_access_tenant(((storage.foldername(name))[1])::uuid)));

-- INSERT: same-tenant only.
create policy job_files_insert_restrict on storage.objects
  as restrictive for insert to authenticated with check (
    bucket_id <> 'job-files'
    or ((storage.foldername(name))[1] ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and public.can_access_tenant(((storage.foldername(name))[1])::uuid)));

-- UPDATE: denied on job-files (uploads are immutable, matching pod-files).
create policy job_files_update_deny on storage.objects
  as restrictive for update to authenticated using (bucket_id <> 'job-files');

-- DELETE: denied on job-files (app never removes uploads, matching pod-files).
create policy job_files_delete_deny on storage.objects
  as restrictive for delete to authenticated using (bucket_id <> 'job-files');

-- VERIFY (expect the 4 job_files_* restrictive policies, and public=false for the bucket):
--   select policyname, cmd, permissive from pg_policies
--     where schemaname='storage' and tablename='objects' and policyname like 'job_files_%';
--   select id, public from storage.buckets where id='job-files';
