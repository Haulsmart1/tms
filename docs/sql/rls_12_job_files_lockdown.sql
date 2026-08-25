-- RLS Tenancy Hardening -- 12: lock down the `job-files` storage bucket.
--
-- WHY: discovery during the pod-files work (see rls_10a comments) found a SECOND bucket,
-- `job-files`, left with 4 permissive `bucket_id`-only storage.objects policies and marked
-- public -- a cross-tenant leak of the same class pod-files had. See the 2026-08-25 security
-- audit, finding H2.
--
-- CONTEXT THAT MAKES THIS LOW-RISK: a repo-wide grep for "job-files" in app/ and lib/ finds NO
-- code that reads or writes this bucket today. So tightening it cannot break a live code path.
--
-- DESIGN: in Postgres, a row is accessible only if at least one PERMISSIVE policy grants it AND
-- every RESTRICTIVE policy passes. We drop the too-broad `bucket_id`-only permissive policies and
-- replace them with PERMISSIVE policies that grant SELECT/INSERT only when the first path segment
-- is the caller's tenant (mirroring the pod-files tenant-segment scheme). We add NO update/delete
-- policy, so UPDATE and DELETE are denied for the `authenticated` role by absence (uploads are
-- immutable, matching pod-files). The Supabase service_role has BYPASSRLS, so signed-URL serving
-- and server-side writes are unaffected. Net effect: same-tenant read/insert works, cross-tenant
-- and anonymous access is denied. If job-files is later used with the same `<tenantId>/...` path
-- convention, it keeps working with no further policy changes.
--
-- Permissive policies OR together, and each policy below matches ONLY `bucket_id = 'job-files'`
-- rows, so this cannot widen or narrow any other bucket (pod-files etc. keep their own policies).
--
-- ⚠️ NOT YET APPLIED. Review, then run in the Supabase SQL editor. storage.objects already has
-- RLS enabled (rls_10a). After running, confirm the job_files_* policies below are present and
-- the bucket is no longer public.

-- 1) Make the bucket private (signed URLs only, like pod-files).
update storage.buckets set public = false where id = 'job-files';

-- 2) Drop the known-permissive job-files policies if they exist. Names come from the Supabase
--    default template; adjust to match what the storage policies list actually shows. If a name
--    does not match, the drop is a safe no-op (the tenant-scoped grants below still take effect
--    and, being the only job-files grants, define access on their own).
drop policy if exists "job-files insert"  on storage.objects;
drop policy if exists "job-files select"  on storage.objects;
drop policy if exists "job-files update"  on storage.objects;
drop policy if exists "job-files delete"  on storage.objects;

-- 3) PERMISSIVE, tenant-scoped grants. These are the ONLY policies that grant job-files access,
--    so access is exactly same-tenant and nothing else.

-- SELECT: a member may read only their own tenant's job-files objects.
create policy job_files_read on storage.objects
  for select to authenticated using (
    bucket_id = 'job-files'
    and (storage.foldername(name))[1] ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and public.can_access_tenant(((storage.foldername(name))[1])::uuid));

-- INSERT: a member may upload only under their own tenant's path segment.
create policy job_files_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'job-files'
    and (storage.foldername(name))[1] ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    and public.can_access_tenant(((storage.foldername(name))[1])::uuid));

-- UPDATE and DELETE: intentionally no policy -> denied for `authenticated` (immutable uploads).
-- The service_role bypasses RLS, so any server-side cleanup still works.

-- VERIFY (expect job_files_read + job_files_insert PERMISSIVE, no job-files update/delete policy,
-- and public=false for the bucket):
--   select policyname, cmd, permissive from pg_policies
--     where schemaname='storage' and tablename='objects' and policyname like 'job_files_%';
--   select id, public from storage.buckets where id='job-files';
