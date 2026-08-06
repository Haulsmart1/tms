# pod-files bucket lockdown: design

Date: 2026-08-06
Status: approved (brainstorming), revised after adversarial review, pending user review + plan

## Problem

The `pod-files` Supabase Storage bucket is **public** (`getPublicUrl`, `upsert: true`). Storage
objects live in the `storage` schema and are governed by `storage.objects` RLS, not the
public-schema policies, and the bucket's current policies are permissive:

- **Read leak:** while the bucket is public, every uploaded POD photo / delivery document
  (recipient names, signatures, addresses, PII) is world-readable by URL, no auth, no tenant check.
- **Write leak:** the pod page is a `"use client"` component, so any authenticated user can
  `supabase.storage.from('pod-files').upload('<other-tenant-uuid>/.../evil.pdf', file, {upsert:true})`
  and plant or overwrite another tenant's proof-of-delivery evidence.

The de-hardcode work already made the upload path `${tenant_id}/${stop_id}/...`, so the first
folder segment is the tenant id, but a path prefix is not access control. Flagged HIGH by the
tenant-context review and elevated to its own security-week task.

## Goals

- Make `pod-files` private and enforce tenant isolation on storage objects (read and write) via
  `storage.objects` RLS keyed on the tenant path segment, reusing the fail-closed
  `can_access_tenant`.
- Replace the pre-existing permissive policies entirely (not add alongside them).
- Switch the app from public URLs to short-lived signed URLs generated on demand, client-only.
- Do all of the above without a broken window during rollout, and without destroying data.

## Non-goals (out of scope)

- The jobs page's manual "paste a POD URL" **input** stays a free-form external-link field. Its
  *display* is updated (external links render as a labeled, sandboxed link; not auto-opened), and
  its `savePod` is patched so it cannot null an uploaded path, but the paste input itself stays.
- No server route / service-role signing layer. Client-only.
- Other storage buckets (only `pod-files` is in scope; the policy cleanup is gated on a discovery
  query so it cannot silently affect another bucket).

## Approach: client-side signed URLs, permissive policies replaced

Enable RLS on `storage.objects`, **replace** the existing permissive pod-files policies with
tenant-scoped SELECT + INSERT policies keyed on the tenant path segment, apply those **while the
bucket is still public** so signing already works, deploy the app, then flip the bucket private.
The client mints short-lived signed URLs via `createSignedUrl`, which the storage API only grants
if the caller passes the SELECT policy. The pod page stores the object **path** (not a URL) and
uploads immutably (`upsert:false`). A pure classifier decides how each stored value is presented.
No server code, no new secrets. Rejected alternatives unchanged: server-route signing is
premature; a public bucket is the leak.

## Architecture

### Step 0: discovery (Ethan runs, shares output)

Because the current permissive policies were created out-of-band (the repo commits zero
`storage.objects` policy SQL) and are NOT named `pod_files_*`, we must see them before dropping:

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname='storage' and tablename='objects';
select relrowsecurity from pg_class where oid = 'storage.objects'::regclass;
select id, public, allowed_mime_types, file_size_limit from storage.buckets where id='pod-files';
select distinct split_part(name, '/', 1) as first_segment, count(*)
from storage.objects where bucket_id='pod-files' group by 1 limit 20;   -- sanity: paths look like tenant uuids
```

If any policy protects a **different** bucket, we scope the drop instead of dropping all. In this
project only `pod-files` is referenced by the app, so the expected case is "drop all, recreate two."

### Step 1: `docs/sql/rls_10a_pod_files_policies.sql` (run FIRST, bucket stays public)

Re-runnable. Reuses the rls_08-hardened `can_access_tenant` (rejects null; staff -> own tenant,
admin -> company, super -> all).

```sql
-- Assert RLS is on. If it was ever disabled to make the public bucket "just work",
-- the policies below would be inert. Do not trust the default.
alter table storage.objects enable row level security;

-- Replace ALL existing pod-files-affecting policies. Per Step 0, in this project every
-- storage.objects policy concerns pod-files, so drop them all, then create exactly two.
-- (If Step 0 shows another bucket's policy, drop by explicit name list instead.)
do $$ declare pol record; begin
  for pol in select policyname from pg_policies
    where schemaname='storage' and tablename='objects'
  loop execute format('drop policy %I on storage.objects', pol.policyname); end loop;
end $$;

-- Strict UUID pattern so the ::uuid cast can never raise on a regex-passing segment.
-- First folder segment is the tenant id (upload path = `${tenant_id}/${stop_id}/...`).
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

-- No UPDATE policy: uploads are immutable (upsert:false, unique Date.now() names), so no legit
-- overwrite exists; omitting UPDATE removes the same-tenant evidence-forgery vector.
-- No DELETE policy: the app never removes objects; deny by default.

-- Cheap upload hardening: restrict to POD-appropriate types (no SVG/html active content) and cap
-- size. Client accept= is not a control; this is. Bucket stays public here (privatized in 10b).
update storage.buckets
  set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic',
        'application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      file_size_limit = 15728640      -- 15 MB
  where id = 'pod-files';

-- VERIFY: exactly the two intended policies remain for the bucket.
--   select policyname, cmd from pg_policies
--   where schemaname='storage' and tablename='objects' order by policyname;  -- pod_files_insert, pod_files_read
```

### Step 2: `docs/sql/rls_10b_pod_files_privatize.sql` (run AFTER the app is deployed)

```sql
-- Flip private only after the signed-URL app is live, so old getPublicUrl views never 404 in a gap.
update storage.buckets set public = false where id = 'pod-files';
-- No destructive data clear: the app's classifier self-heals legacy public URLs (recovers the
-- object path and signs it), so old rows keep working and nothing is wiped.
```

Notes:
- SELECT + INSERT both gate on `can_access_tenant` (POD is filed by drivers, a staff activity).
- The strict UUID regex means a matching segment always casts cleanly, and a root-level or
  non-uuid path (empty `foldername`, traversal, etc.) is denied.
- Service role bypasses all of this.

### App: upload stores a path, immutably

In `app/pod/page.tsx` `uploadFile`: change `upsert: true` -> `upsert: false`; drop the
`getPublicUrl` call; after a successful `upload`, store `filePath` via
`updateForm(stopId, fieldName, filePath)`. `savePod` persists the path.

### App: `lib/pod/podUrl.ts` (classifier + signer, unit-testable)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export const POD_BUCKET = "pod-files";

export type PodValue =
  | { kind: "empty" }
  | { kind: "external"; href: string; host: string } // arbitrary pasted external URL
  | { kind: "path"; path: string };                   // bucket object path -> sign to view

function publicPrefix(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return base ? `${base}/storage/v1/object/public/${POD_BUCKET}/` : "";
}

// Decide how to present a stored POD value:
//  - our own bucket's legacy PUBLIC url -> recover the object path and sign it (self-heal)
//  - a relative string -> a bucket object path -> sign it
//  - an arbitrary http(s) url (jobs paste) -> a labeled external link, never auto-opened
//  - anything else (empty, javascript:, data:, other schemes) -> empty (never surfaced)
export function classifyPodValue(value: string | null | undefined): PodValue {
  if (!value || !value.trim()) return { kind: "empty" };
  const v = value.trim();

  const prefix = publicPrefix();
  if (prefix && v.startsWith(prefix)) {
    const path = decodeURIComponent(v.slice(prefix.length).split("?")[0]);
    return path ? { kind: "path", path } : { kind: "empty" };
  }

  let parsed: URL | null = null;
  try { parsed = new URL(v); } catch { parsed = null; }
  if (parsed) {
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { kind: "external", href: parsed.toString(), host: parsed.host };
    }
    return { kind: "empty" }; // javascript:, data:, etc.
  }
  return { kind: "path", path: v }; // relative -> object path
}

export async function signPodPath(
  supabase: SupabaseClient, path: string, ttlSeconds = 300,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(POD_BUCKET).createSignedUrl(path, ttlSeconds);
  return error ? null : (data?.signedUrl ?? null);
}
```

### App: View controls

For each stored POD value, `classifyPodValue` picks the affordance (in both `app/pod/page.tsx`'s
two "View uploaded ..." spots and `app/jobs/page.tsx`'s "View POD" spot):

- `kind === "path"` -> a **button** that opens a blank tab **synchronously** (so it is not
  popup-blocked), then navigates it once signed:
  ```tsx
  onClick={async () => {
    const w = window.open("", "_blank");
    const url = await signPodPath(supabase, pod.path);       // 5 min TTL
    if (url && w) { try { (w as unknown as { opener: unknown }).opener = null; } catch {} w.location.href = url; }
    else { w?.close(); setMessage("Could not open the file."); }
  }}
  ```
- `kind === "external"` -> a **distinct labeled link** (not the "View" button), so an attacker's
  pasted URL cannot masquerade as an in-app file and does not auto-navigate a reviewer:
  ```tsx
  <a href={pod.href} target="_blank" rel="noopener noreferrer">Open external link ({pod.host})</a>
  ```
- `kind === "empty"` -> render nothing.

### App: jobs `savePod` must not null an uploaded path

`app/jobs/page.tsx` `savePod` currently writes `pod_photo_url: podForm.pod_photo_url.trim() || null`,
which nulls a path uploaded via the pod page when an admin marks delivery with an empty box. Build
the update payload to **omit** `pod_photo_url` (and any POD-file field) when the box is blank, so it
never overwrites an existing value:
```ts
const payload: Record<string, any> = { recipient_name: ..., pod_notes: ..., /* delivery fields */ };
if (podForm.pod_photo_url.trim()) payload.pod_photo_url = podForm.pod_photo_url.trim();
```

## Data model / existing rows

`pod_photo_url` / `pod_document_url` hold a bucket **path** for uploads, and still a free-form
external URL for jobs-page pastes. **No destructive clear**: the classifier self-heals legacy
public URLs (recovers the object path and signs it), so pre-existing rows keep working and nothing
is wiped. (This reverses the earlier "clear old rows" decision; self-healing makes the clear
unnecessary and it would have destroyed the external URLs the paste field is meant to keep.)

## Security / edge cases

- **Cross-tenant read/view:** `createSignedUrl` only succeeds if the caller passes the SELECT
  policy, so a tenant-B user signing a tenant-A path errors and the helper returns `null`.
- **Cross-tenant / malformed / traversal upload:** the INSERT policy denies a foreign-tenant,
  non-uuid, root, or traversal path; the strict regex keeps the cast from raising.
- **Same-tenant forgery / deletion:** `upsert:false` + no UPDATE policy makes objects immutable; no
  DELETE policy means objects cannot be removed via the API. Orphaned superseded uploads are a
  storage-cost nit, not a security issue.
- **Stored external URLs (jobs paste):** never auto-opened; rendered as a labeled external link
  with `rel="noopener noreferrer"`; `javascript:`/`data:` values classify to `empty` and never
  surface (this also closes the pre-existing `javascript:` `<a href>` XSS on that field).
- **Content type:** the bucket `allowed_mime_types` restricts uploads to images + pdf/doc (no SVG /
  html active content); a same-tenant insider therefore cannot stash active content, and signed
  files open on the `*.supabase.co` origin, isolated from the app origin regardless.
- **Accepted limits:** `createSignedUrl`'s TTL is caller-chosen, so a same-tenant user could mint a
  longer-lived link directly; this is bounded by the SELECT policy (only their own tenant) and
  accepted. The 300s default is a balance for large document downloads on slow links.

## Sequencing (gap-free)

1. **Run `rls_10a`** (enable RLS, replace policies, mime limits) **while the bucket is still
   public.** Old `getPublicUrl` views keep working (public), and `createSignedUrl` now works (SELECT
   policy exists).
2. **Deploy the app** (stores paths, `upsert:false`, signs on view). Bucket still public, so any
   not-yet-migrated public URLs still resolve, and new paths sign fine.
3. **Run `rls_10b`** (privatize). Public URLs stop resolving; the classifier self-heals any legacy
   public-URL rows into signed views.

No ordering here leaves a window where a POD cannot be read by its own tenant.

## Files touched

New:
- `docs/sql/rls_10a_pod_files_policies.sql` (Ethan runs, step 1)
- `docs/sql/rls_10b_pod_files_privatize.sql` (Ethan runs, step 3)
- `lib/pod/podUrl.ts`
- `lib/pod/podUrl.test.ts`

Modified:
- `app/pod/page.tsx` (upsert:false; store path; two View controls via classifier)
- `app/jobs/page.tsx` (View POD control via classifier; `savePod` conditional payload)

## Verification

- **Unit test** (`lib/pod/podUrl.test.ts`): `classifyPodValue` for empty, a bucket path, a legacy
  public URL of our bucket (-> path), an external `https` URL (-> external + host), a `javascript:`
  value (-> empty); `signPodPath` mocked.
- **SQL diagnostics** (Ethan): after `rls_10a`, `pg_policies` for `storage.objects` shows exactly
  `pod_files_read` + `pod_files_insert`; `relrowsecurity` is true; no `to public`/`to anon` policy
  remains.
- **Manual, two accounts in DIFFERENT companies (or staff):**
  - read: tenant B cannot `createSignedUrl` a tenant-A path (error); a signed link opens for the
    owner; after `rls_10b`, a raw public object URL fetched logged-out returns 403/404.
  - **write**: tenant B `upload('<tenantA-uuid>/x.jpg', ...)` is denied.
  - popup: "View" opens the signed file (not popup-blocked), including right after upload.
  - external: a pasted `https://example.com` renders as a labeled external link, not a "View" file.
- Typecheck + build.

## Dependencies / order

0. **Stacks on the tenant-context de-hardcode** (`feat/tenant-context-de-hardcode`, unmerged): it
   provides the `${tenant_id}/${stop_id}/...` upload path and the current pod/jobs structure.
   Implement on `feat/pod-files-lockdown` (stacked on it), not off stale `main`.
1. RLS overhaul + `rls_08` applied (provides `can_access_tenant`). Queued with the tenant-context work.
2. Step 0 discovery -> confirm drop scope.
3. Build app change (classifier + upsert:false + View controls + jobs savePod); typecheck/build/test.
4. Run `rls_10a` (bucket still public) -> deploy app -> run `rls_10b` (privatize).
5. Manual security checks (read AND write cross-tenant denied; policy enumeration).
