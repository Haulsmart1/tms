-- pod-files lockdown -- ACTUALLY APPLIED 2026-08-10 (supersedes rls_10a_pod_files_policies.sql).
-- See that file's header for why: storage.objects is owned by the reserved role
-- supabase_storage_admin; postgres cannot ALTER/DROP/CREATE POLICY on it directly, and the
-- Supabase Dashboard's Storage > Policies UI showed the 4 existing pod-files policies as
-- locked/uneditable (org-permission gate -- Stuart's call to unlock, tracked separately, same
-- decision point as the deferred job-files bucket).
--
-- Workaround: the Dashboard's "New Policy" flow DID allow creating brand-new policies (just not
-- editing/deleting the old ones). Postgres RESTRICTIVE policies AND against existing PERMISSIVE
-- policies instead of OR-ing, so they can narrow access without touching what's already there.
-- The 4 original permissive policies (`Allow authenticated {read,upload,update,delete}
-- {from,to} pod-files`, bucket_id-only, no tenant check) remain live and untouched. Each policy
-- below was created individually through Storage > Policies > New Policy > For full
-- customization, pasting the USING / WITH CHECK expression shown here.
--
-- `bucket_id <> 'pod-files' or ...` is deliberate: for any row in another bucket (job-files
-- etc.), the restrictive check passes trivially, so this cannot accidentally tighten anything
-- outside pod-files.

-- Narrows the existing broad SELECT down to same-tenant only.
-- create policy pod_files_read_restrict on storage.objects
--   as restrictive for select to authenticated using (
--     bucket_id <> 'pod-files'
--     or ((storage.foldername(name))[1] ~
--         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
--         and public.can_access_tenant(((storage.foldername(name))[1])::uuid)));

-- Narrows the existing broad INSERT down to same-tenant only.
-- create policy pod_files_insert_restrict on storage.objects
--   as restrictive for insert to authenticated with check (
--     bucket_id <> 'pod-files'
--     or ((storage.foldername(name))[1] ~
--         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
--         and public.can_access_tenant(((storage.foldername(name))[1])::uuid)));

-- Fully denies UPDATE on pod-files regardless of tenant (immutable uploads), overriding the
-- existing permissive UPDATE policy: for a pod-files row the restrictive check is always false,
-- and restrictive AND permissive with a false restrictive always denies.
-- create policy pod_files_update_deny on storage.objects
--   as restrictive for update to authenticated using (bucket_id <> 'pod-files');

-- Fully denies DELETE on pod-files regardless of tenant (app never removes uploads), same logic.
-- create policy pod_files_delete_deny on storage.objects
--   as restrictive for delete to authenticated using (bucket_id <> 'pod-files');

-- The statements above are commented out because they were run through the Dashboard UI, not
-- this file -- kept here as the exact, verified-live text for anyone who needs to recreate or
-- audit them. (If Stuart later unlocks the original policies and this whole file is replaced by
-- rls_10a's clean DROP+CREATE-PERMISSIVE approach, drop these 4 restrictive policies first so
-- the two approaches don't stack.)

-- MIME allowlist + size cap: plain `update storage.buckets`, not policy DDL, so no ownership
-- issue -- ran fine directly in the SQL editor.
update storage.buckets
  set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic',
        'application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      file_size_limit = 15728640      -- 15 MB
  where id = 'pod-files';

-- Privatize: also plain DML. Safe to run immediately (2026-08-10: bucket held zero objects and
-- the app is not yet in use by anyone, so there was no live public link to break).
update storage.buckets set public = false where id = 'pod-files';

-- VERIFY (run 2026-08-10, all confirmed):
--   select policyname, cmd, permissive, roles, qual, with_check
--   from pg_policies where schemaname='storage' and tablename='objects'
--     and (coalesce(qual,'') like '%''pod-files''%' or coalesce(with_check,'') like '%''pod-files''%'
--          or policyname like 'pod_files%')
--   order by permissive desc, cmd, policyname;
--   -- 4 PERMISSIVE (original, untouched) + 4 RESTRICTIVE (new) = 8 rows.
--   select id, public, allowed_mime_types, file_size_limit from storage.buckets where id='pod-files';
--   -- public=false, MIME array populated, file_size_limit=15728640.
--   select policyname, cmd, permissive from pg_policies
--   where schemaname='storage' and tablename='objects'
--     and (coalesce(qual,'') like '%''job-files%' or coalesce(with_check,'') like '%''job-files%');
--   -- 4 PERMISSIVE, unchanged -- confirms job-files was not touched by any of this.
