# pod-files Bucket Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public `pod-files` bucket private with tenant-scoped `storage.objects` RLS and switch the app from public URLs to short-lived signed URLs, closing a live cross-tenant read/write leak.

**Architecture:** Replace the bucket's permissive policies with SELECT+INSERT policies keyed on the tenant path segment via `can_access_tenant`; uploads become immutable (`upsert:false`) and store the object path; a pure `classifyPodValue` decides how each stored value is shown, and a `PodLink` component signs bucket paths on click (opening a tab synchronously to dodge the popup blocker) while rendering pasted external URLs as a distinct sandboxed link. Rollout is gap-free: apply policies while the bucket is still public, deploy the app, then privatize.

**Tech Stack:** Next.js 16 (App Router, `"use client"`), React 19, TypeScript, `@supabase/ssr` browser client, Postgres + Supabase Storage RLS, vitest.

**Spec:** `docs/superpowers/specs/2026-08-06-pod-files-bucket-lockdown-design.md`

**Branch:** `feat/pod-files-lockdown` (stacked on `feat/tenant-context-de-hardcode`; already checked out).

---

## File structure

New:
- `docs/sql/rls_10a_pod_files_policies.sql` - enable RLS, replace policies with SELECT+INSERT, MIME/size limits (Ethan runs FIRST, bucket still public).
- `docs/sql/rls_10b_pod_files_privatize.sql` - flip the bucket private (Ethan runs AFTER app deploy).
- `lib/pod/podUrl.ts` - pure `classifyPodValue` + `signPodPath`.
- `lib/pod/podUrl.test.ts` - vitest tests for the above.
- `app/components/PodLink.tsx` - the shared "View" control (path -> sign-on-click; external -> labeled link).

Modified:
- `app/pod/page.tsx` - `upsert:false`, store the path, two `<PodLink>` view spots.
- `app/jobs/page.tsx` - one `<PodLink>` view spot; `savePod` conditional payload.

## Rollout sequence (ops, after the code below is merged/deployed)

1. Ethan runs the **Step 0 discovery** queries (in Task 1) and shares output, so the drop scope is confirmed.
2. Ethan runs `rls_10a_pod_files_policies.sql` (bucket still public).
3. Deploy the app change.
4. Ethan runs `rls_10b_pod_files_privatize.sql` (privatize).
5. Manual security checks (Task 7).

---

## Task 1: `rls_10a_pod_files_policies.sql` (Ethan runs, after discovery)

**Files:**
- Create: `docs/sql/rls_10a_pod_files_policies.sql`

- [ ] **Step 1: Write the file**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/sql/rls_10a_pod_files_policies.sql
git commit -m "sql: pod-files storage policies (enable RLS, replace with SELECT+INSERT, MIME limits)"
```

- [ ] **Step 3: HALT for Ethan.** He runs Step 0 discovery (shares output to confirm drop scope), then `rls_10a` in Supabase while the bucket is still public. Expected: the VERIFY query returns exactly `pod_files_insert` and `pod_files_read`.

---

## Task 2: `rls_10b_pod_files_privatize.sql` (Ethan runs, after app deploy)

**Files:**
- Create: `docs/sql/rls_10b_pod_files_privatize.sql`

- [ ] **Step 1: Write the file**

```sql
-- pod-files lockdown -- 10b: privatize. Run AFTER the signed-URL app is deployed. Safe to re-run.
-- No destructive data clear: the app's classifier self-heals legacy public URLs (recovers the
-- object path and signs it), so old rows keep working and nothing is wiped.
update storage.buckets set public = false where id = 'pod-files';

-- VERIFY (expect public = false):
--   select id, public from storage.buckets where id = 'pod-files';
```

- [ ] **Step 2: Commit**

```bash
git add docs/sql/rls_10b_pod_files_privatize.sql
git commit -m "sql: privatize pod-files bucket (run after app deploy)"
```

- [ ] **Step 3: HALT for Ethan.** He runs this only AFTER the app change is deployed. Expected: `public = false`.

---

## Task 3: `lib/pod/podUrl.ts` (classifier + signer, vitest TDD)

**Files:**
- Create: `lib/pod/podUrl.ts`, `lib/pod/podUrl.test.ts`

- [ ] **Step 1: Write the failing tests**

`lib/pod/podUrl.test.ts`:

```ts
import { describe, it, expect } from "vitest";

const BASE = "https://proj.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;

import { classifyPodValue, signPodPath } from "./podUrl";

describe("classifyPodValue", () => {
  it("empty for null or blank", () => {
    expect(classifyPodValue(null).kind).toBe("empty");
    expect(classifyPodValue("   ").kind).toBe("empty");
  });
  it("treats a relative string as a bucket path", () => {
    expect(classifyPodValue("t1/s1/photo.jpg")).toEqual({ kind: "path", path: "t1/s1/photo.jpg" });
  });
  it("self-heals a legacy public URL of our bucket into a path", () => {
    const v = `${BASE}/storage/v1/object/public/pod-files/t1/s1/photo.jpg`;
    expect(classifyPodValue(v)).toEqual({ kind: "path", path: "t1/s1/photo.jpg" });
  });
  it("classifies an arbitrary https URL as external with its host", () => {
    expect(classifyPodValue("https://example.com/x")).toEqual({
      kind: "external", href: "https://example.com/x", host: "example.com",
    });
  });
  it("classifies a javascript: URL as empty (never surfaced)", () => {
    expect(classifyPodValue("javascript:alert(1)").kind).toBe("empty");
  });
});

describe("signPodPath", () => {
  it("returns the signed url on success", async () => {
    const supabase: any = { storage: { from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: "https://signed" }, error: null }) }) } };
    expect(await signPodPath(supabase, "t1/s1/x.jpg")).toBe("https://signed");
  });
  it("returns null on error", async () => {
    const supabase: any = { storage: { from: () => ({
      createSignedUrl: async () => ({ data: null, error: new Error("nope") }) }) } };
    expect(await signPodPath(supabase, "t1/s1/x.jpg")).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- lib/pod/podUrl.test.ts`
Expected: FAIL, cannot resolve `./podUrl`.

- [ ] **Step 3: Implement `lib/pod/podUrl.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export const POD_BUCKET = "pod-files";

export type PodValue =
  | { kind: "empty" }
  | { kind: "external"; href: string; host: string }
  | { kind: "path"; path: string };

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
    return { kind: "empty" };
  }
  return { kind: "path", path: v };
}

export async function signPodPath(
  supabase: SupabaseClient,
  path: string,
  ttlSeconds = 300,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(POD_BUCKET).createSignedUrl(path, ttlSeconds);
  return error ? null : (data?.signedUrl ?? null);
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test -- lib/pod/podUrl.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pod/podUrl.ts lib/pod/podUrl.test.ts
git commit -m "feat: podUrl classifier + signer with tests"
```

---

## Task 4: `app/components/PodLink.tsx` (shared View control)

**Files:**
- Create: `app/components/PodLink.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { createClient } from "../../lib/supabase/browser";
import { classifyPodValue, signPodPath } from "../../lib/pod/podUrl";

const linkButtonStyle: CSSProperties = {
  color: "#111827", fontWeight: 600, cursor: "pointer",
  textDecoration: "underline", background: "none", border: "none", padding: 0,
};

const externalStyle: CSSProperties = { color: "#111827", fontWeight: 600 };

export default function PodLink({
  value, label,
}: { value: string | null | undefined; label: string }) {
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const pod = classifyPodValue(value);
  if (pod.kind === "empty") return null;

  if (pod.kind === "external") {
    return (
      <a href={pod.href} target="_blank" rel="noopener noreferrer" style={externalStyle}>
        Open external link ({pod.host})
      </a>
    );
  }

  // kind === "path": open a blank tab synchronously (so it is not popup-blocked), sign, navigate.
  const path = pod.path;
  return (
    <>
      <button
        type="button"
        style={linkButtonStyle}
        disabled={busy}
        onClick={async () => {
          setFailed(false);
          setBusy(true);
          const w = window.open("", "_blank");
          const url = await signPodPath(supabase, path);
          setBusy(false);
          if (url && w) {
            try { (w as unknown as { opener: unknown }).opener = null; } catch { /* ignore */ }
            w.location.href = url;
          } else {
            w?.close();
            setFailed(true);
          }
        }}
      >
        {busy ? "Opening..." : label}
      </button>
      {failed ? (
        <span style={{ color: "#b91c1c", marginLeft: 8 }}>Could not open the file.</span>
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors from `PodLink.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/components/PodLink.tsx
git commit -m "feat: PodLink shared view control (sign-on-click paths, labeled external links)"
```

---

## Task 5: `app/pod/page.tsx` (immutable upload, store path, PodLink view)

**Files:**
- Modify: `app/pod/page.tsx` (`uploadFile` around lines 133-167; the two "View uploaded ..." link blocks around lines 405-462)

- [ ] **Step 1: Make uploads immutable and store the path**

Read the file. In `uploadFile`:
- change the upload options `{ upsert: true }` to `{ upsert: false }`.
- delete the `getPublicUrl` block (the `const { data: publicUrlData } = supabase.storage.from(POD_BUCKET).getPublicUrl(filePath);` and `const publicUrl = ...` lines).
- change `updateForm(stopId, fieldName, publicUrl)` to `updateForm(stopId, fieldName, filePath)`.

So the tail of `uploadFile` becomes:

```tsx
    const { error: uploadError } = await supabase.storage
      .from(POD_BUCKET)
      .upload(filePath, file, { upsert: false });

    if (uploadError) {
      setUploadingField("");
      setMessage(`Upload error: ${uploadError.message}`);
      return;
    }

    updateForm(stopId, fieldName, filePath);

    setUploadingField("");
    setMessage(
      fieldName === "pod_photo_url" ? "Photo uploaded." : "Document uploaded."
    );
```

- [ ] **Step 2: Replace the two "View uploaded ..." links with `<PodLink>`**

Add the import near the top:

```tsx
import PodLink from "../components/PodLink";
```

Replace the photo link block (the `{form.pod_photo_url ? ( <div ...><a href={form.pod_photo_url} ...>View uploaded photo</a></div> ) : null}`) with:

```tsx
{form.pod_photo_url ? (
  <div style={{ marginTop: 10 }}>
    <PodLink value={form.pod_photo_url} label="View uploaded photo" />
  </div>
) : null}
```

Replace the document link block similarly:

```tsx
{form.pod_document_url ? (
  <div style={{ marginTop: 10 }}>
    <PodLink value={form.pod_document_url} label="View uploaded document" />
  </div>
) : null}
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds; `git grep -n "getPublicUrl" app/pod/page.tsx` returns nothing.

- [ ] **Step 4: Commit**

```bash
git add app/pod/page.tsx
git commit -m "feat: pod page stores object path, immutable upload, PodLink views"
```

---

## Task 6: `app/jobs/page.tsx` (PodLink view + savePod cannot null a path)

**Files:**
- Modify: `app/jobs/page.tsx` (the "View POD" link around lines 921-933; `savePod` around lines 472-527)

- [ ] **Step 1: Replace the "View POD" link with `<PodLink>`**

Add the import near the top:

```tsx
import PodLink from "../components/PodLink";
```

Replace the display block (the `{stop.pod_photo_url ? ( <div ...>Photo: <a href={stop.pod_photo_url} ...>View POD</a></div> ) : null}`) with:

```tsx
{stop.pod_photo_url ? (
  <div style={{ marginTop: 6 }}>
    <PodLink value={stop.pod_photo_url} label="View POD" />
  </div>
) : null}
```

(Leave the manual "POD photo URL" paste `<input>` untouched.)

- [ ] **Step 2: Make `savePod` not null an uploaded path**

In `savePod`, build the update payload so `pod_photo_url` is only set when the box is non-blank (an empty box must not overwrite a path stored by the pod page):

```tsx
    const updatePayload: Record<string, any> = {
      recipient_name: podForm.recipient_name.trim() || null,
      pod_notes: podForm.pod_notes.trim() || null,
      delivered_at: new Date().toISOString(),
      pod_status: "delivered",
      status: "completed",
    };
    if (podForm.pod_photo_url.trim()) {
      updatePayload.pod_photo_url = podForm.pod_photo_url.trim();
    }

    const { error: stopError } = await supabase
      .from("job_stops")
      .update(updatePayload)
      .eq("id", stopId);
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/jobs/page.tsx
git commit -m "feat: jobs page PodLink view + savePod preserves uploaded POD path"
```

---

## Task 7: Verification

**Files:** none (verification only)

- [ ] **Step 1: Tests, typecheck, build**

Run: `npm test && npm run typecheck && npm run build`
Expected: vitest passes (includes the podUrl suite), typecheck clean, build succeeds.

- [ ] **Step 2: No public-URL usage remains in the POD paths**

Run: `git grep -n "getPublicUrl" app/`
Expected: no matches.

- [ ] **Step 3: SQL diagnostics (Ethan, after `rls_10a`)**

Confirm `pg_policies` for `storage.objects` shows exactly `pod_files_read` + `pod_files_insert`; `relrowsecurity` is true; no `to public` / `to anon` policy remains.

- [ ] **Step 4: Manual security matrix (Ethan, two accounts in DIFFERENT companies or staff)**

- **Read isolation:** tenant B cannot `createSignedUrl('<tenantA-uuid>/...')` (error); the owner's "View" opens the signed file; after `rls_10b`, a raw public object URL fetched logged-out returns 403/404.
- **Write isolation:** tenant B `upload('<tenantA-uuid>/x.jpg', ...)` is denied.
- **Popup:** "View" opens the signed file (not popup-blocked), including immediately after upload.
- **External link:** a pasted `https://example.com` renders as a labeled external link, not a "View" file, and `javascript:` values do not surface.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: pod-files lockdown verification fixes"
```

---

## Notes for the executor

- Ethan applies all SQL in Supabase. Tasks 1-2 create the files and HALT; do not run SQL.
- The rollout ORDER matters (run `rls_10a` while public -> deploy -> run `rls_10b`); do not privatize before the app is deployed.
- Commit after each task. Do not push; Ethan controls pushes.
- No em-dashes in code or comments.
- This branch stacks on `feat/tenant-context-de-hardcode`; do not rebase onto stale `main`.
