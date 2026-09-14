-- RLS Tenancy Hardening -- 12: lock down the `job-files` storage bucket.
--
-- SUPERSEDED 2026-09-14. DO NOT RUN. Use, in order:
--   docs/sql/prodfix_82_storage_buckets_private.sql       (bucket public = false, plain DML)
--   docs/sql/prodfix_83_storage_restrictive_policies.sql  (RESTRICTIVE tenant policies)
-- Apply order and checks: docs/sql/prodfix_80_README.md.
--
-- WHY THIS DRAFT WAS RETIRED (review findings SQL-1 and POD-4, 2026-09-14):
--   1. It ran `drop policy if exists ... on storage.objects`. storage.objects is owned by
--      supabase_storage_admin, and rls_10a recorded exactly that DDL failing with 42501 from the
--      SQL editor. `if exists` does not skip the ownership check, so the script aborts there.
--   2. Even if the drops ran, they guessed policy names. The old header claimed a non-matching drop
--      was harmless because the new policies "define access on their own". That is false:
--      PERMISSIVE policies OR together, so a differently named bucket-only permissive policy keeps
--      granting every signed-in user full cross-tenant access and the new ones add nothing. Its
--      verify query only listed job_files_% names, so it would have reported success.
--   prodfix_83 uses RESTRICTIVE policies instead (ANDed with whatever permissive policies exist),
--   the approach that actually worked for pod-files in rls_10a_pod_files_restrictive.sql, and also
--   binds a deny to non-authenticated roles (finding SQL-8).
--
-- The guard below makes this file a no-op if it is run by mistake: the exception aborts the whole
-- script before anything else executes. The retired draft body is kept, commented out, for history.

do $$
begin
  raise exception 'rls_12 is superseded: apply prodfix_82 and prodfix_83 instead (see docs/sql/prodfix_80_README.md). Nothing changed.';
end $$;

-- RETIRED DRAFT (do not uncomment):
-- update storage.buckets set public = false where id = 'job-files';
-- drop policy if exists "job-files insert"  on storage.objects;
-- drop policy if exists "job-files select"  on storage.objects;
-- drop policy if exists "job-files update"  on storage.objects;
-- drop policy if exists "job-files delete"  on storage.objects;
-- create policy job_files_read on storage.objects
--   for select to authenticated using (
--     bucket_id = 'job-files'
--     and (storage.foldername(name))[1] ~
--         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
--     and public.can_access_tenant(((storage.foldername(name))[1])::uuid));
-- create policy job_files_insert on storage.objects
--   for insert to authenticated with check (
--     bucket_id = 'job-files'
--     and (storage.foldername(name))[1] ~
--         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
--     and public.can_access_tenant(((storage.foldername(name))[1])::uuid));
