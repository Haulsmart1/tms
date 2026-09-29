-- shifts_05: private bucket for walkaround defect photos.
-- Path rule: <tenant_id>/<check_id>/<defect_client_id>/<file>.
-- Deliberately NO storage.objects policies: the browser neither reads nor
-- writes this bucket directly. Uploads use server-issued signed upload URLs and
-- reads use short-lived signed URLs, both minted by route handlers after
-- authorization (same model as pod-files uploads).
-- Safe to re-run.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('walkaround-photos', 'walkaround-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;

-- VERIFY: expect public = false and no policy mentioning the bucket.
--   select id, public, file_size_limit from storage.buckets where id = 'walkaround-photos';
--   select policyname from pg_policies where schemaname = 'storage'
--     and (coalesce(qual,'') like '%walkaround-photos%' or coalesce(with_check,'') like '%walkaround-photos%');
