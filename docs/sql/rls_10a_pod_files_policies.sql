-- pod-files lockdown -- 10a: enable RLS + replace policies + MIME limits. Bucket STAYS PUBLIC here.
-- Run AFTER the Step 0 discovery below confirms which policies exist. Safe to re-run.
--
-- SUPERSEDED 2026-08-10: this file's DROP+CREATE-PERMISSIVE approach could not be run as
-- written. storage.objects is owned by the reserved role supabase_storage_admin, not postgres
-- (only a true superuser can grant that membership -- confirmed via 42501 errors on both the SQL
-- editor and a `grant supabase_storage_admin to postgres` attempt). The Supabase Dashboard's
-- Storage > Policies UI also showed the 4 existing pod-files policies as locked/uneditable
-- (org-permission gate, not a Postgres issue -- resolving that is Stuart's call, he can also
-- decide the job-files bucket at the same time).
-- What actually landed instead: docs/sql/rls_10a_pod_files_restrictive.sql, 4 new RESTRICTIVE
-- policies created via the dashboard's "New Policy" flow (creating was allowed even though
-- editing/deleting the old ones was not). RESTRICTIVE policies AND against the existing
-- permissive grants instead of replacing them, achieving the same net tenant-scoped access
-- without touching the locked policies. VERIFIED LIVE 2026-08-10 (see that file for the
-- verification query and results). The bucket's public flag and MIME/size limits below WERE
-- applied via plain `update storage.buckets` (DML, not policy DDL, so no ownership issue).
-- Keep this file as the target state for whenever Stuart consolidates onto a single clean
-- policy set; do not re-run it as-is (the DROP POLICY step will fail with the same 42501).
--
-- STEP 0 discovery (run these first, share the output; do NOT skip):
--   select policyname, cmd, roles, qual, with_check
--     from pg_policies where schemaname='storage' and tablename='objects';
--   select relrowsecurity from pg_class where oid = 'storage.objects'::regclass;
--   select id, public, allowed_mime_types, file_size_limit from storage.buckets where id='pod-files';
--   select distinct split_part(name,'/',1) as first_segment, count(*)
--     from storage.objects where bucket_id='pod-files' group by 1 limit 20;

-- Assert RLS is on (if it was disabled to make the public bucket "just work", policies are inert).
alter table storage.objects enable row level security;

-- Step 0 discovery (2026-08-06) found a SECOND bucket 'job-files' with its own permissive
-- policies, so we must NOT drop-all. Drop only the policies that grant pod-files access (matched
-- by their bucket_id predicate, which is robust to the policy names) plus our own, leaving
-- job-files untouched. (job-files is a separate cross-tenant leak of the same class and needs its
-- own lockdown -- NOT handled in this file.)
do $$ declare pol record; begin
  for pol in
    select policyname from pg_policies
    where schemaname='storage' and tablename='objects'
      and ( coalesce(qual,'')       like '%''pod-files''%'
         or coalesce(with_check,'') like '%''pod-files''%'
         or policyname in ('pod_files_read','pod_files_insert') )
  loop execute format('drop policy %I on storage.objects', pol.policyname); end loop;
end $$;

-- Strict UUID pattern so the ::uuid cast can never raise on a regex-passing segment. First folder
-- segment is the tenant id (upload path = `${tenant_id}/${stop_id}/...`).
create policy pod_files_read on storage.objects for select to authenticated using (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and public.can_access_tenant(((storage.foldername(name))[1])::uuid));

create policy pod_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  and public.can_access_tenant(((storage.foldername(name))[1])::uuid));
-- No UPDATE policy (uploads immutable) and no DELETE policy (app never removes) = denied by default.

-- Restrict uploads to POD-appropriate types (no SVG/html active content) and cap size.
update storage.buckets
  set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic',
        'application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      file_size_limit = 15728640      -- 15 MB
  where id = 'pod-files';

-- VERIFY (pod-files now has exactly pod_files_insert + pod_files_read; job-files untouched):
--   select policyname, cmd from pg_policies
--   where schemaname='storage' and tablename='objects'
--     and (coalesce(qual,'') like '%''pod-files''%' or coalesce(with_check,'') like '%''pod-files''%')
--   order by policyname;   -- expect exactly two rows: pod_files_insert, pod_files_read
