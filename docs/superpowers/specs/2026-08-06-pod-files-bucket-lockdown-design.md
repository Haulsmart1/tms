# pod-files bucket lockdown: design

Date: 2026-08-06
Status: approved (brainstorming), pending adversarial review + implementation plan

## Problem

The `pod-files` Supabase Storage bucket is **public** (`getPublicUrl`, `upsert: true`). Storage
objects live in the `storage` schema and are NOT governed by the public-schema RLS the rest of
the tenancy model relies on, so:

- **Read leak:** every uploaded POD photo / delivery document (recipient names, signatures,
  addresses, customer PII) is world-readable by anyone who has the URL, with no auth and no
  tenant check.
- **Write leak:** the pod page is a `"use client"` component, so any authenticated user can call
  `supabase.storage.from('pod-files').upload('<other-tenant-uuid>/.../evil.pdf', file, {upsert:true})`
  and plant or **overwrite** another tenant's proof-of-delivery evidence.

The de-hardcode work already made the upload path `${tenant_id}/${stop_id}/...`, so the first
folder segment is the tenant id, but a path prefix is not access control. This was flagged HIGH
by the tenant-context adversarial review and elevated to its own security-week task.

## Goals

- Make `pod-files` private so objects are not world-readable.
- Enforce tenant isolation on storage objects (read and write) via `storage.objects` RLS keyed
  on the tenant path segment, reusing the fail-closed `can_access_tenant` helper.
- Switch the app from public URLs to short-lived signed URLs generated on demand, with no new
  server layer.

## Non-goals (out of scope)

- The jobs page's manual "paste a POD URL" **input** stays a free-form external-link field. (Its
  display link is updated to use the shared helper, but the paste input is untouched.)
- No server route / service-role signing layer (that is a separate future decision, also needed
  for TomTom/Square). This piece is client-only.
- Other storage buckets (only `pod-files` is in scope).

## Approach: client-side signed URLs

Make the bucket private, add tenant-scoped `storage.objects` policies, and have the client mint
short-lived signed URLs via `supabase.storage.from('pod-files').createSignedUrl(path, ttl)`,
which the storage API only grants if the caller passes the SELECT policy. The pod page keeps
uploading (an INSERT/UPDATE policy allows it) but stores the **object path** instead of a public
URL. A single shared helper turns a stored path into a viewable link on demand. No server code,
no new secrets; it fits the existing all-client architecture and fully closes the leak.

Rejected: a server route signing with the service-role key (introduces the app's first server
layer and service-role handling before this fix needs it; the storage policies are required
either way). Keeping the bucket public is the leak itself.

## Architecture

### Storage layer: `docs/sql/rls_10_pod_files_lockdown.sql` (Ethan runs it)

Re-runnable. Reuses the rls_08-hardened `can_access_tenant` (rejects null, scopes staff to own
tenant / admin to company / super to all).

```sql
-- 1. Make the bucket private. Public getPublicUrl links stop resolving.
update storage.buckets set public = false where id = 'pod-files';

-- 2. Tenant-scope storage.objects. Upload path is `${tenant_id}/${stop_id}/...`,
--    so the first folder segment is the tenant id.
do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='storage' and tablename='objects' and policyname like 'pod_files_%'
  loop execute format('drop policy %I on storage.objects', pol.policyname); end loop;
end $$;

-- The regex guards the ::uuid cast so a non-uuid or root path segment is denied
-- cleanly instead of raising a cast error (fail-closed).
create policy pod_files_read on storage.objects for select to authenticated using (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.can_access_tenant(((storage.foldername(name))[1])::uuid));

create policy pod_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.can_access_tenant(((storage.foldername(name))[1])::uuid));

create policy pod_files_update on storage.objects for update to authenticated
using (bucket_id = 'pod-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.can_access_tenant(((storage.foldername(name))[1])::uuid))
with check (bucket_id = 'pod-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.can_access_tenant(((storage.foldername(name))[1])::uuid));

create policy pod_files_delete on storage.objects for delete to authenticated using (
  bucket_id = 'pod-files'
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  and public.can_access_tenant(((storage.foldername(name))[1])::uuid));

-- 3. Clear old public-URL values so every stored value is now a path (test data).
update public.job_stops set pod_photo_url = null, pod_document_url = null;
```

- Read and write both gate on `can_access_tenant` (POD is filed by drivers, a staff activity, so
  uploads are not admin-only). Swapping the insert/update policies to `can_manage_tenant` would
  make uploads admin-only; not the intent.
- `storage.foldername(name)` returns the folder segments as a 1-indexed `text[]`; `[1]` is the
  tenant id. A root-level object yields an empty array, so `[1]` is null and the regex denies it.
- Service role bypasses RLS, so any future server-side code keeps working.
- RLS is already enabled on `storage.objects` by default in Supabase.

### App: upload stores a path

In `app/pod/page.tsx` `uploadFile`, remove the `getPublicUrl` call; after a successful `upload`,
store `filePath` (the object path) via `updateForm(stopId, fieldName, filePath)`. `savePod` then
persists the path into `job_stops.pod_photo_url` / `pod_document_url`.

### App: shared signing helper `lib/pod/podUrl.ts`

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export const POD_BUCKET = "pod-files";

// A stored POD value is either an external URL (pasted on the jobs page) or a
// private-bucket object path (uploaded). Resolve it to something viewable.
export async function resolvePodUrl(
  supabase: SupabaseClient,
  value: string | null | undefined,
  ttlSeconds = 60,
): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;              // external pasted URL
  const { data, error } = await supabase.storage
    .from(POD_BUCKET).createSignedUrl(value, ttlSeconds);
  return error ? null : (data?.signedUrl ?? null);
}
```

The `http(s)` branch keeps the jobs-page pasted external URLs working; anything else is treated
as a bucket path and signed.

### App: sign-on-click "View" controls

The three display spots become buttons whose `onClick` calls `resolvePodUrl(...)` then
`window.open(url, "_blank", "noopener")` (and set a "could not open the file" message on null):
- `app/pod/page.tsx`: the "View uploaded photo" and "View uploaded document" links.
- `app/jobs/page.tsx`: the inline "View POD" link (display only; the paste input is untouched).

Signing on click with a 60s TTL means a signed URL is minted only when actually used and expires
almost immediately, so it cannot be bookmarked or leaked; signing every visible photo on page
load would be more requests and the URLs could go stale before use.

## Data model / existing rows

`job_stops.pod_photo_url` / `pod_document_url` now hold a bucket **path** for uploads (and still
a free-form external URL for jobs-page pastes; the helper's `http` branch covers that). Existing
rows hold old public URLs and are cleared by step 3 of `rls_10` (test data, throwaway), so there
is no stale-URL back-compat beyond the ongoing external-URL case.

## Security / edge cases (all fail-closed)

- **Cross-tenant view:** `createSignedUrl` only succeeds if the caller passes the SELECT policy,
  so a tenant-B user signing a tenant-A path gets an error and the helper returns `null`.
  Isolation is enforced at the storage layer, not just the `job_stops` row.
- **Cross-tenant / malformed upload:** the INSERT/UPDATE policy denies a foreign-tenant, non-uuid,
  or root path; the upload error surfaces to the user.
- **Null / missing value:** helper returns `null`; the View control renders only when a value
  exists.

## Sequencing

Deploy the app change **first**, then run `rls_10`. The app change is backward-compatible (signed
URLs work on a still-public bucket, and old `http` values pass straight through the helper), so
nothing breaks in between. Flipping the bucket private before the new app deployed would 404 the
old `getPublicUrl` views until deploy.

## Files touched

New:
- `docs/sql/rls_10_pod_files_lockdown.sql` (Ethan runs it)
- `lib/pod/podUrl.ts`
- `lib/pod/podUrl.test.ts`

Modified:
- `app/pod/page.tsx` (upload stores the path; two View buttons)
- `app/jobs/page.tsx` (View POD button uses the helper)

## Verification

- Unit test (`lib/pod/podUrl.test.ts`): `http` branch returns an external URL unchanged;
  null/empty returns null; the sign branch mocked.
- Manual security checks once `rls_10` is live: upload a POD then View opens a signed link; the
  raw object URL fetched logged-out returns 403/404 (bucket private); a previously-working public
  URL now 404s; a second-tenant account cannot `createSignedUrl` the first tenant's path.
- Typecheck + build.

## Dependencies / order

0. **Stacks on the tenant-context de-hardcode** (branch `feat/tenant-context-de-hardcode`, not yet
   merged): that work provides the `${tenant_id}/${stop_id}/...` upload path and the current
   pod/jobs page structure this design edits. Implement this on top of that branch (or after it
   merges to main), not off a stale `main`.
1. RLS overhaul + `rls_08` must be applied (they provide `can_access_tenant`). Already done/queued
   with the tenant-context work.
2. Build the app change (helper + upload-stores-path + View buttons); typecheck/build/test.
3. Deploy the app change.
4. Run `rls_10_pod_files_lockdown.sql` in Supabase.
5. Manual security checks.
