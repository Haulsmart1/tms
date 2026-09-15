-- prodfix_82_storage_buckets_private.sql
--
-- Findings SQL-1 / POD-4 (bucket half). Makes the job-files bucket private and re-asserts that
-- pod-files is private. Plain DML on storage.buckets, which rls_10a/rls_10b showed runs fine from
-- the SQL editor (unlike policy DDL on storage.objects, see prodfix_83).
--
-- Only ever narrows: `public = false` switches off the unauthenticated /object/public/ URL path.
-- A grep of app/ and lib/ on 2026-09-14 finds no code that reads or writes job-files, and every
-- pod-files read in the app is a short-lived signed URL (lib/pod/podUrl.ts), so nothing breaks.
-- Safe to re-run.
--
-- Note: `public = false` does NOT stop API calls (list/download/upload/remove) made with the anon
-- key or a user JWT. Those are governed by storage.objects RLS, which prodfix_83 fixes.
--
-- Diag to check first: 07_bucket (public flag of job-files and pod-files).

begin;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise exception 'prodfix_82: storage.buckets not found. Nothing changed.';
  end if;
end $$;

update storage.buckets set public = false where id in ('job-files', 'pod-files') and public;

commit;

-- VERIFY (expect public = false for both rows that exist):
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id in ('job-files', 'pod-files') order by id;
