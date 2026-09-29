-- shifts_05: private bucket for walkaround defect photos.
-- Path rule: <tenant_id>/<check_id>/<defect_client_id>/<file>.
--
-- The browser neither reads nor writes this bucket directly. Uploads use
-- server-issued signed upload URLs and reads use short-lived signed URLs, both
-- minted by route handlers after authorization (same model as pod-files
-- uploads).
--
-- A private bucket with no policy of its own is NOT enough on its own:
-- storage.objects may already carry PERMISSIVE policies that do not mention
-- bucket_id (a dashboard template, an old "authenticated can read" rule), and
-- those would reach this bucket too. So this file adds four RESTRICTIVE
-- policies, prodfix_83 style, that no client role can pass for this bucket:
--   walkaround_photos_block_select / _insert / _update / _delete
--     to public (every role, anon included), bucket_id <> 'walkaround-photos'
-- A restrictive policy is ANDed with every permissive one, so this holds
-- whatever the other policies are called or say, and rows in every other
-- bucket pass it trivially. service_role (BYPASSRLS) and the table owner are
-- not subject to RLS, so signed-URL minting, signed uploads and downloads
-- (the storage server serves those with its own elevated access after
-- checking the token) and the dashboard storage browser are unaffected.
--
-- Behavioural check after applying, from the app (the SQL editor bypasses
-- RLS): a driver photo upload through the signed upload URL still works, and
--   signed in as any user: supabase.storage.from('walkaround-photos').list('<tenant uuid>') -> []
--   anon key, no session:  the same call                                             -> []
--
-- IF IT RAISES "cannot create policies on storage.objects" (the 42501 case,
-- see prodfix_83): create the four policies by hand in Dashboard > Storage >
-- Policies > "For full customization": same names, RESTRICTIVE, roles left
-- empty (public), and the expressions below. Then run shifts_verify.sql.
--
-- Safe to re-run.

begin;

do $$
declare
  v_owner oid;
  v_rls   boolean;
begin
  select c.relowner, c.relrowsecurity into v_owner, v_rls
  from pg_class c where c.oid = to_regclass('storage.objects');
  if v_owner is null then
    raise exception 'shifts_05: storage.objects not found. Nothing changed.';
  end if;
  if not v_rls then
    raise exception 'shifts_05: RLS is OFF on storage.objects, so every storage policy is inert. Enabling it needs the table owner (%). Nothing changed.',
      pg_get_userbyid(v_owner);
  end if;
  if not pg_has_role(current_user, v_owner, 'USAGE') then
    raise exception 'shifts_05: % cannot create policies on storage.objects (owner %). Create them in the dashboard as described in this file''s header. Nothing changed.',
      current_user, pg_get_userbyid(v_owner);
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('walkaround-photos', 'walkaround-photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists walkaround_photos_block_select on storage.objects;
create policy walkaround_photos_block_select on storage.objects
  as restrictive for select to public
  using (bucket_id <> 'walkaround-photos');

drop policy if exists walkaround_photos_block_insert on storage.objects;
create policy walkaround_photos_block_insert on storage.objects
  as restrictive for insert to public
  with check (bucket_id <> 'walkaround-photos');

drop policy if exists walkaround_photos_block_update on storage.objects;
create policy walkaround_photos_block_update on storage.objects
  as restrictive for update to public
  using (bucket_id <> 'walkaround-photos')
  with check (bucket_id <> 'walkaround-photos');

drop policy if exists walkaround_photos_block_delete on storage.objects;
create policy walkaround_photos_block_delete on storage.objects
  as restrictive for delete to public
  using (bucket_id <> 'walkaround-photos');

commit;

-- VERIFY: expect public = false, and exactly the four RESTRICTIVE
-- walkaround_photos_block_* rows (roles {public}); shifts_verify.sql section 7
-- also lists any permissive storage policy not scoped by bucket.
--   select id, public, file_size_limit from storage.buckets where id = 'walkaround-photos';
--   select policyname, permissive, roles, cmd from pg_policies where schemaname = 'storage'
--     and (coalesce(qual,'') like '%walkaround-photos%' or coalesce(with_check,'') like '%walkaround-photos%');
