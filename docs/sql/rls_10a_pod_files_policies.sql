-- pod-files lockdown -- 10a: enable RLS + replace policies + MIME limits. Bucket STAYS PUBLIC here.
-- Run AFTER the Step 0 discovery below confirms which policies exist. Safe to re-run.
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

-- Replace ALL existing storage.objects policies. In this project every such policy concerns
-- pod-files (Step 0 confirms), so drop them all then create exactly two. If Step 0 shows another
-- bucket's policy, replace this loop with an explicit drop-by-name list for pod-files only.
do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='storage' and tablename='objects'
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

-- VERIFY (expect exactly two rows: pod_files_insert, pod_files_read):
--   select policyname, cmd from pg_policies
--   where schemaname='storage' and tablename='objects' order by policyname;
