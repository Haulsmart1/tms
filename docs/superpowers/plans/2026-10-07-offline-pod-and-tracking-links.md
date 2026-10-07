# Offline POD Saves and Customer Tracking Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a driver complete a delivery with no signal (queued and sent later), and let the office send a delivery contact a public tracking link with an ETA and, once the van is heading there, a live map.

**Architecture:** POD photos, scans and completions join the existing ordered IndexedDB queue (`lib/offline/*`, `app/driver/driverQueue.ts`) as three new item kinds; the driver routes accept the phone's recorded time and judge the walkaround gate at that time. Tracking links copy the POD share link design (random token, stored hashed, server-only table) and a public page polls a JSON route whose payload is built by one pure function that decides what may leave the server.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres + Storage, service role in routes), vitest, TomTom routing and web maps, Microsoft Graph email.

**Spec:** `docs/superpowers/specs/2026-10-07-offline-pod-and-tracking-links-design.md`. Read it first.

**House rules for every task (from `CLAUDE.md` and the user's memory):**
- Never use em-dashes in code, comments, docs or commit messages.
- Run `npm test` and `npm run typecheck` before each commit that touches TypeScript. Tests live only in `lib/**/*.test.ts`; nothing under `app/` runs through vitest.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `.env.local` points at the LIVE Supabase project. Do not run the app against it to "try" a write.
- Do not apply SQL. Migrations are written to `docs/sql/` and applied by hand later.
- Imports in `app/` use relative paths (no `@/` alias), matching the surrounding files.


> **Amendment after the Group 1 review (2026-10-07), overrides any code below that disagrees:** queued
> photo uploads are signed WITHOUT upsert. `createEvidenceUploadUrl(..., { clientId })` returns
> `{ path, token: string | null }`: `token: null` when a `pod_evidence` row already has that `storage_path`
> or when `createSignedUploadUrl` reports the object already exists. The queue runner (Task 9) skips the
> storage upload when `token` is null, uses `uploadToSignedUrl(..., { upsert: false })`, and treats a
> storage error whose status is 409 or whose message matches /already exists|duplicate/i as success; in
> every case it then calls the record route. The Task 6 routes answer 400 "Invalid clientId." when the
> body has a `clientId` that `parseQueuedMeta` rejected. `parseQueuedMeta`/`acceptRecordedTime` require
> an ISO time with an explicit offset (`Z` or `+hh:mm`).

---

## File structure

**Part A: offline POD**

| File | Action | Responsibility |
|---|---|---|
| `docs/sql/tracking_02_pod_flags.sql` | Create | `job_stops.pod_flags` column |
| `lib/pod/recordedTime.ts` (+ test) | Create | Accept or refuse a phone-recorded time |
| `lib/pod/evidencePath.ts` (+ test) | Modify | `buildQueuedPodEvidencePath` (path derived from `clientId`) |
| `lib/pod/evidenceServer.ts` | Modify | `createEvidenceUploadUrl` takes an optional `clientId` (deterministic path, upsert) |
| `lib/walkaround/jobGate.ts` (+ test) | Modify | `jobGateDecisionAt` |
| `lib/walkaround/server.ts` | Modify | `loadJobGateInputAt`, `queuedJobGate` |
| `lib/pod/queuedMeta.ts` (+ test) | Create | Parse `clientId` / `shiftClientId` / `recordedAt` from a request body |
| `app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/upload-url/route.ts` | Modify | Queued gate, deterministic path |
| `app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/route.ts` | Modify | Queued gate |
| `app/api/driver/jobs/[jobId]/stops/[stopId]/complete/route.ts` | Modify | Queued gate, recorded time, `pod_flags` |
| `lib/offline/driverSync.ts` (+ test) | Modify | POD payload kinds, `pendingPodByStop` projection |
| `lib/driver/offlinePod.ts` (+ test) | Create | Doorstep validation of a queued completion and a queued scan |
| `app/driver/driverQueue.ts` | Modify | Send POD kinds, `enqueuePod*`, rejected items carry job and stop |
| `app/driver/jobs/[jobId]/page.tsx` | Modify | Enqueue instead of sending; show pending state |
| `app/driver/jobs/[jobId]/BarcodeVerification.tsx` | Modify | Enqueue scans |
| `app/jobs/StopCard.tsx` | Modify | "Time not trusted" tag |

**Part B: tracking links**

| File | Action | Responsibility |
|---|---|---|
| `docs/sql/tracking_01_links_and_eta_cache.sql` | Create | `stop_tracking_links`, `stop_eta_cache` |
| `docs/sql/prodfix_00_APPLY_ORDER.md` | Modify | New section for both tracking migrations |
| `lib/tracking/links.ts` (+ test) | Create | Token, hash, expiry, link evaluation |
| `lib/documents/shareReference.ts` (+ test) | Modify | `trackingShareReference`, refuse `trk_` tokens and `/track/` URLs |
| `lib/documents/delivery.ts` | Modify | `tracking_link` document type |
| `lib/tracking/eta.ts` (+ test) | Create | State, stops before, lateness, window, refresh decision |
| `lib/tracking/publicPayload.ts` (+ test) | Create | The only builder of what the public route returns |
| `lib/tomtom/api.ts` (+ test) | Modify | `routeUrl(points, key, { traffic })` |
| `lib/tracking/linkStore.ts` | Create | Server: issue, resolve, revoke links; load a trackable stop |
| `lib/tracking/trackingServer.ts` | Create | Server: load everything for one view, TomTom call, cache |
| `lib/rateLimit.ts` | Modify | `trackingViewPerIp` rule |
| `app/api/tracking-links/route.ts` | Create | Mint a link |
| `app/api/tracking-links/email/route.ts` | Create | Mint and email a link |
| `app/api/tracking-links/revoke/route.ts` | Create | Revoke a stop's links |
| `app/api/public/track/[token]/route.ts` | Create | Public JSON |
| `app/track/[token]/page.tsx`, `TrackingView.tsx`, `TrackMap.tsx` | Create | Public page |
| `lib/auth/publicRoutes.ts` (+ tests), `lib/auth/routeClassification.test.ts` | Modify | Classify the new routes |
| `app/jobs/SendTrackingLinkDialog.tsx` | Create | Office dialog |
| `app/jobs/StopCard.tsx` | Modify | "Send tracking link" button |
| `README.md`, `CLAUDE.md` | Modify | Inventory, public page list, tables |

---

## Part A: Offline POD saves

### Task 1: `pod_flags` migration

**Files:**
- Create: `docs/sql/tracking_02_pod_flags.sql`

- [ ] **Step 1: Write the migration**

```sql
-- tracking_02_pod_flags.sql
--
-- Why: offline POD saves (docs/superpowers/specs/2026-10-07-offline-pod-and-tracking-links-design.md).
-- A delivery completed with no signal is sent later carrying the time the driver tapped Complete.
-- When the server cannot trust that time (outside the shift, in the future, older than 72 hours) it
-- uses its own receive time and marks the stop with the flag 'pod_time_untrusted' so the office can
-- see it in /jobs.
--
-- Deploy order: the app degrades without this column. The complete route retries its update without
-- pod_flags on 42703 and logs a warning, so a missing column never blocks a delivery.
--
-- Idempotent.

begin;

alter table public.job_stops
  add column if not exists pod_flags text[] not null default '{}';

commit;

-- VERIFY (expect one row, data_type ARRAY, is_nullable NO):
-- select column_name, data_type, is_nullable, column_default
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'job_stops' and column_name = 'pod_flags';
```

- [ ] **Step 2: Commit**

```bash
git add docs/sql/tracking_02_pod_flags.sql
git commit -m "feat(sql): job_stops.pod_flags for offline POD saves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Recorded time acceptance

**Files:**
- Create: `lib/pod/recordedTime.ts`
- Test: `lib/pod/recordedTime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { acceptRecordedTime, MAX_RECORDED_AGE_MS, MAX_RECORDED_FUTURE_MS } from "./recordedTime";

const now = new Date("2026-10-07T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("acceptRecordedTime", () => {
  it("trusts a recent time with no shift (subcontractor)", () => {
    const at = iso(now.getTime() - 60 * 60 * 1000);
    expect(acceptRecordedTime({ recordedAt: at, serverNow: now, shift: null })).toEqual({ at, trusted: true });
  });

  it("falls back to server time for garbage", () => {
    for (const recordedAt of [undefined, null, "", "yesterday", 42]) {
      expect(acceptRecordedTime({ recordedAt, serverNow: now, shift: null })).toEqual({ at: now.toISOString(), trusted: false });
    }
  });

  it("allows small future skew but refuses more", () => {
    const ok = iso(now.getTime() + MAX_RECORDED_FUTURE_MS);
    const bad = iso(now.getTime() + MAX_RECORDED_FUTURE_MS + 1);
    expect(acceptRecordedTime({ recordedAt: ok, serverNow: now, shift: null }).trusted).toBe(true);
    expect(acceptRecordedTime({ recordedAt: bad, serverNow: now, shift: null })).toEqual({ at: now.toISOString(), trusted: false });
  });

  it("refuses a time older than the maximum age", () => {
    const ok = iso(now.getTime() - MAX_RECORDED_AGE_MS);
    const bad = iso(now.getTime() - MAX_RECORDED_AGE_MS - 1);
    expect(acceptRecordedTime({ recordedAt: ok, serverNow: now, shift: null }).trusted).toBe(true);
    expect(acceptRecordedTime({ recordedAt: bad, serverNow: now, shift: null }).trusted).toBe(false);
  });

  it("requires the time to sit inside the named shift", () => {
    const shift = { startedAt: "2026-10-07T06:00:00.000Z", endedAt: "2026-10-07T10:00:00.000Z" };
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T06:00:00.000Z", serverNow: now, shift }).trusted).toBe(true);
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T10:00:00.000Z", serverNow: now, shift }).trusted).toBe(true);
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T05:59:59.999Z", serverNow: now, shift }).trusted).toBe(false);
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T10:00:00.001Z", serverNow: now, shift }).trusted).toBe(false);
  });

  it("has no upper bound while the shift is still open", () => {
    const shift = { startedAt: "2026-10-07T06:00:00.000Z", endedAt: null };
    expect(acceptRecordedTime({ recordedAt: "2026-10-07T11:59:00.000Z", serverNow: now, shift }).trusted).toBe(true);
  });

  it("normalises the accepted time to ISO", () => {
    const result = acceptRecordedTime({ recordedAt: "2026-10-07T11:00:00+01:00", serverNow: now, shift: null });
    expect(result).toEqual({ at: "2026-10-07T10:00:00.000Z", trusted: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/pod/recordedTime.test.ts`
Expected: FAIL, cannot find module `./recordedTime`.

- [ ] **Step 3: Implement**

```ts
/*
  Offline POD saves carry the time the driver acted (the phone's clock). The
  server takes that time only when it is believable: not in the future beyond
  a small clock skew, not older than 72 hours, and inside the shift the item
  names. Otherwise it uses its own receive time and the caller flags the stop
  (pod_flags 'pod_time_untrusted'). Without this, every delivery made with no
  signal would look late; with it unchecked, a wrong phone clock could
  backdate a POD. Pure.
*/

export const MAX_RECORDED_FUTURE_MS = 2 * 60 * 1000;
export const MAX_RECORDED_AGE_MS = 72 * 60 * 60 * 1000;

export type RecordedTimeInput = {
  recordedAt: unknown;
  serverNow: Date;
  /** The shift the item names; null for drivers who are not gated (subcontractors). */
  shift: null | { startedAt: string; endedAt: string | null };
};

export type RecordedTimeDecision = { at: string; trusted: boolean };

export function acceptRecordedTime(input: RecordedTimeInput): RecordedTimeDecision {
  const fallback = { at: input.serverNow.toISOString(), trusted: false };
  if (typeof input.recordedAt !== "string" || input.recordedAt.trim() === "") return fallback;

  const t = Date.parse(input.recordedAt);
  if (Number.isNaN(t)) return fallback;

  const now = input.serverNow.getTime();
  if (t > now + MAX_RECORDED_FUTURE_MS) return fallback;
  if (t < now - MAX_RECORDED_AGE_MS) return fallback;

  if (input.shift) {
    const start = Date.parse(input.shift.startedAt);
    if (Number.isNaN(start) || t < start) return fallback;
    if (input.shift.endedAt !== null) {
      const end = Date.parse(input.shift.endedAt);
      if (Number.isNaN(end) || t > end) return fallback;
    }
  }

  return { at: new Date(t).toISOString(), trusted: true };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/pod/recordedTime.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pod/recordedTime.ts lib/pod/recordedTime.test.ts
git commit -m "feat(pod): accept or refuse a phone-recorded POD time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Queued request metadata parser

**Files:**
- Create: `lib/pod/queuedMeta.ts`
- Test: `lib/pod/queuedMeta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseQueuedMeta } from "./queuedMeta";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("parseQueuedMeta", () => {
  it("is null for a body from a page that does not queue", () => {
    expect(parseQueuedMeta({ recipient_name: "x" })).toBeNull();
    expect(parseQueuedMeta(null)).toBeNull();
  });

  it("reads all three fields", () => {
    expect(parseQueuedMeta({ clientId: A, shiftClientId: B, recordedAt: "2026-10-07T10:00:00.000Z" })).toEqual({
      clientId: A,
      shiftClientId: B,
      recordedAt: "2026-10-07T10:00:00.000Z",
    });
  });

  it("keeps recordedAt as given (acceptance is decided later) and drops malformed ids", () => {
    expect(parseQueuedMeta({ clientId: "nope", shiftClientId: 7, recordedAt: "garbage" })).toEqual({
      clientId: null,
      shiftClientId: null,
      recordedAt: "garbage",
    });
  });

  it("treats a body with only clientId as queued", () => {
    expect(parseQueuedMeta({ clientId: A })).toEqual({ clientId: A, shiftClientId: null, recordedAt: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/pod/queuedMeta.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

```ts
/*
  The three fields an offline-queued POD request carries (driver app queue,
  app/driver/driverQueue.ts). A body with none of them comes from a page that
  sends directly, and the routes treat it exactly as before. Pure.
*/

import { isUuid } from "../uuid";

export type QueuedMeta = {
  /** Phone-generated id of this queued item. */
  clientId: string | null;
  /** Client id of the start check of the shift open on the phone when the item was queued. */
  shiftClientId: string | null;
  /** Phone clock, as sent. Whether to trust it is lib/pod/recordedTime.ts's decision. */
  recordedAt: string | null;
};

export function parseQueuedMeta(body: unknown): QueuedMeta | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.clientId === undefined && b.shiftClientId === undefined && b.recordedAt === undefined) return null;
  return {
    clientId: typeof b.clientId === "string" && isUuid(b.clientId) ? b.clientId : null,
    shiftClientId: typeof b.shiftClientId === "string" && isUuid(b.shiftClientId) ? b.shiftClientId : null,
    recordedAt: typeof b.recordedAt === "string" ? b.recordedAt : null,
  };
}
```

Check that `lib/uuid.ts` exports `isUuid` (it is imported that way by `lib/documents/shareReference.ts`). If the export name differs, use the one that file uses.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/pod/queuedMeta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pod/queuedMeta.ts lib/pod/queuedMeta.test.ts
git commit -m "feat(pod): parse offline queue metadata from driver requests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Deterministic evidence path for queued photos

**Files:**
- Modify: `lib/pod/evidencePath.ts`
- Modify: `lib/pod/evidencePath.test.ts`
- Modify: `lib/pod/evidenceServer.ts:15-27`

- [ ] **Step 1: Append the failing test to `lib/pod/evidencePath.test.ts`**

Add `buildQueuedPodEvidencePath` to the existing import from `./evidencePath`, then append:

```ts
describe("buildQueuedPodEvidencePath", () => {
  const owner = {
    tenantId: "11111111-1111-4111-8111-111111111111",
    jobId: "22222222-2222-4222-8222-222222222222",
    stopId: "33333333-3333-4333-8333-333333333333",
  };
  const clientId = "44444444-4444-4444-8444-444444444444";

  it("is the same path every time for the same client id", () => {
    const a = buildQueuedPodEvidencePath({ ...owner, folder: "photos", clientId, filename: "pod 1.jpg" });
    const b = buildQueuedPodEvidencePath({ ...owner, folder: "photos", clientId, filename: "pod 1.jpg" });
    expect(a).toBe(b);
    expect(a).toBe(`${owner.tenantId}/${owner.jobId}/${owner.stopId}/photos/q-${clientId}-pod_1.jpg`);
  });

  it("stays inside the evidence path rule", () => {
    const path = buildQueuedPodEvidencePath({ ...owner, folder: "photos", clientId, filename: null });
    expect(isPodEvidencePathFor(path, owner)).toBe(true);
  });

  it("refuses a client id that is not a UUID", () => {
    expect(() => buildQueuedPodEvidencePath({ ...owner, folder: "photos", clientId: "../x", filename: "a.jpg" })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/pod/evidencePath.test.ts`
Expected: FAIL, `buildQueuedPodEvidencePath` is not exported.

- [ ] **Step 3: Implement in `lib/pod/evidencePath.ts`** (add after `buildPodEvidencePath`)

```ts
/**
  The path for a photo sent from the driver's offline queue. Derived from the
  item's client id instead of a timestamp and random part, so a retry after a
  lost answer uploads to the same object (signed with upsert) and records the
  same path, which recordEvidenceRow already treats as one row.
*/
export function buildQueuedPodEvidencePath(input: PodEvidenceOwner & {
  folder: PodEvidenceFolder;
  clientId: string;
  filename: string | null | undefined;
}): string {
  const { tenantId, jobId, stopId, folder, clientId } = input;
  if (!isUuidLike(tenantId) || !isUuidLike(jobId) || !isUuidLike(stopId) || !isUuidLike(clientId)) {
    throw new Error("POD evidence owner ids and the client id must be UUIDs.");
  }
  if (!POD_EVIDENCE_FOLDERS.includes(folder)) {
    throw new Error("Unknown POD evidence folder.");
  }
  return `${tenantId}/${jobId}/${stopId}/${folder}/q-${clientId.toLowerCase()}-${sanitizePodFilename(input.filename)}`;
}
```

- [ ] **Step 4: Change `createEvidenceUploadUrl` in `lib/pod/evidenceServer.ts`**

Replace the function (lines 15-27) with:

```ts
export async function createEvidenceUploadUrl(
  admin: SupabaseClient,
  owner: PodEvidenceOwner,
  folder: PodEvidenceFolder,
  filename: string | null | undefined,
  options: { clientId?: string | null } = {},
): Promise<{ path: string; token: string }> {
  // A queued photo gets a path derived from its client id and an upsert
  // signature, so a retry overwrites the same object rather than adding one.
  const path = options.clientId
    ? buildQueuedPodEvidencePath({ ...owner, folder, clientId: options.clientId, filename })
    : buildPodEvidencePath({ ...owner, folder, filename, timestamp: Date.now(), random: randomUUID() });
  const { data, error } = await admin.storage
    .from(POD_BUCKET)
    .createSignedUploadUrl(path, options.clientId ? { upsert: true } : undefined);
  if (error || !data?.token) {
    throw new Error(`Unable to prepare upload: ${error?.message ?? "no token"}`);
  }
  return { path, token: data.token };
}
```

Add `buildQueuedPodEvidencePath` to the existing import from `./evidencePath` at the top of the file.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run lib/pod && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/pod/evidencePath.ts lib/pod/evidencePath.test.ts lib/pod/evidenceServer.ts
git commit -m "feat(pod): deterministic evidence path for queued photos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Walkaround gate judged at a recorded time

**Files:**
- Modify: `lib/walkaround/jobGate.ts`
- Modify: `lib/walkaround/jobGate.test.ts`
- Modify: `lib/walkaround/server.ts`

- [ ] **Step 1: Append the failing test to `lib/walkaround/jobGate.test.ts`**

Add `jobGateDecisionAt` to the import from `./jobGate` (and `JOB_GATE_MESSAGES` if not already imported), then append:

```ts
describe("jobGateDecisionAt", () => {
  const shift = { startedAt: "2026-10-07T06:00:00.000Z", endedAt: "2026-10-07T15:00:00.000Z" };

  it("does not gate subcontractor drivers", () => {
    expect(jobGateDecisionAt({ portalType: "subcontractor_driver", shift: null, periodAt: null })).toEqual({ ok: true });
  });

  it("refuses when the named shift does not exist", () => {
    expect(jobGateDecisionAt({ portalType: "direct_driver", shift: null, periodAt: null })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noShift });
  });

  it("refuses when no vehicle period covered the time", () => {
    expect(jobGateDecisionAt({ portalType: "direct_driver", shift, periodAt: null })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noVehicle });
  });

  it("refuses a failed check", () => {
    const periodAt = { checkResult: "dangerous" as const, open: false, vehicleVor: false };
    expect(jobGateDecisionAt({ portalType: "direct_driver", shift, periodAt })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.noCheck });
  });

  it("accepts pass and minor on a closed period even if the vehicle is VOR now", () => {
    for (const checkResult of ["pass", "minor"] as const) {
      expect(jobGateDecisionAt({ portalType: "direct_driver", shift, periodAt: { checkResult, open: false, vehicleVor: true } })).toEqual({ ok: true });
    }
  });

  it("refuses VOR on a period that is still open", () => {
    const periodAt = { checkResult: "pass" as const, open: true, vehicleVor: true };
    expect(jobGateDecisionAt({ portalType: "direct_driver", shift, periodAt })).toEqual({ ok: false, message: JOB_GATE_MESSAGES.vor });
  });
});
```

Check the `DriverPortalType` values in `lib/driver/session.ts`; if the subcontractor value is not `"subcontractor_driver"`, use the real one in the first test.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/walkaround/jobGate.test.ts`
Expected: FAIL, `jobGateDecisionAt` is not exported.

- [ ] **Step 3: Implement in `lib/walkaround/jobGate.ts`** (append)

```ts
/*
  The same gate, judged at the moment an offline-queued POD item was recorded
  rather than when it reached the server: a driver who delivered at 10:00 with
  a valid check is not refused because their shift ended before signal came
  back. VOR is only re-checked when the covering vehicle period is still open,
  because vehicles.vor has no history; a VOR raised after a closed period
  cannot be placed in time. That limit is deliberate and recorded in the spec.
*/
export type JobGateAtInput = {
  portalType: DriverPortalType;
  /** The shift the item names, or null when it does not exist for this driver. */
  shift: null | { startedAt: string; endedAt: string | null };
  /** The vehicle period whose [started_at, ended_at) contains the recorded time. */
  periodAt: null | { checkResult: CheckResult | null; open: boolean; vehicleVor: boolean };
};

export function jobGateDecisionAt(input: JobGateAtInput): { ok: true } | { ok: false; message: string } {
  if (input.portalType !== "direct_driver") return { ok: true };
  if (!input.shift) return { ok: false, message: JOB_GATE_MESSAGES.noShift };
  const period = input.periodAt;
  if (!period) return { ok: false, message: JOB_GATE_MESSAGES.noVehicle };
  if (period.checkResult !== "pass" && period.checkResult !== "minor") return { ok: false, message: JOB_GATE_MESSAGES.noCheck };
  if (period.open && period.vehicleVor) return { ok: false, message: JOB_GATE_MESSAGES.vor };
  return { ok: true };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/walkaround/jobGate.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the loader and the route helper to `lib/walkaround/server.ts`**

Add imports at the top: `jobGateDecisionAt` from `./jobGate`, `acceptRecordedTime` from `../pod/recordedTime`, and `type QueuedMeta` from `../pod/queuedMeta`. Append after `jobGateResponse`:

```ts
/** The named shift's bounds and the vehicle period covering `at`, for jobGateDecisionAt. */
async function loadGateRowsAt(
  admin: SupabaseClient,
  session: DriverSession,
  shiftClientId: string,
): Promise<{ shift: { id: string; startedAt: string; endedAt: string | null } | null }> {
  const { data, error } = await admin
    .from("driver_shifts")
    .select("id,started_at,ended_at")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .eq("client_id", shiftClientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { shift: null };
  return { shift: { id: String(data.id), startedAt: String(data.started_at), endedAt: data.ended_at ? String(data.ended_at) : null } };
}

async function loadPeriodAt(admin: SupabaseClient, shiftId: string, at: string) {
  const { data, error } = await admin
    .from("shift_vehicle_periods")
    .select("vehicle_id,walkaround_check_id,started_at,ended_at")
    .eq("shift_id", shiftId)
    .lte("started_at", at)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.ended_at && Date.parse(String(data.ended_at)) <= Date.parse(at)) return null;

  const open = !data.ended_at;
  const [check, vehicle] = await Promise.all([
    admin.from("walkaround_checks").select("result").eq("id", data.walkaround_check_id).maybeSingle(),
    open ? admin.from("vehicles").select("vor").eq("id", data.vehicle_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (check.error) throw new Error(check.error.message);
  if (vehicle.error) throw new Error(vehicle.error.message);
  return {
    checkResult: (check.data?.result as CheckResult | undefined) ?? null,
    open,
    vehicleVor: (vehicle.data as { vor?: boolean } | null)?.vor === true,
  };
}

export type QueuedGateResult = {
  /** A 409 refusal, or null when the driver may proceed. */
  response: NextResponse | null;
  /** The time to record: the phone's when trusted, otherwise the server's. */
  at: string;
  trusted: boolean;
};

/**
  The job gate for a request from the offline queue. Trusted recorded time:
  the gate is judged at that time against the shift the item names. Untrusted
  time, or no shift client id: today's open-shift rule, at server time.
  FAILS CLOSED like jobGateResponse.
*/
export async function queuedJobGate(
  admin: SupabaseClient,
  session: DriverSession,
  meta: QueuedMeta,
  now: Date = new Date(),
): Promise<QueuedGateResult> {
  const refuse = (message: string): QueuedGateResult => ({
    response: NextResponse.json({ error: message }, { status: 409 }),
    at: now.toISOString(),
    trusted: false,
  });

  if (session.portalType !== "direct_driver") {
    const time = acceptRecordedTime({ recordedAt: meta.recordedAt, serverNow: now, shift: null });
    return { response: null, ...time };
  }

  try {
    if (meta.shiftClientId) {
      const { shift } = await loadGateRowsAt(admin, session, meta.shiftClientId);
      const time = acceptRecordedTime({ recordedAt: meta.recordedAt, serverNow: now, shift });
      if (shift && time.trusted) {
        const periodAt = await loadPeriodAt(admin, shift.id, time.at);
        const decision = jobGateDecisionAt({ portalType: session.portalType, shift, periodAt });
        return decision.ok ? { response: null, ...time } : refuse(decision.message);
      }
    }
  } catch (error) {
    console.error("[walkaround] queued job gate lookup failed", error);
    return refuse("Walkaround checks are not available right now, so jobs cannot be completed. Ask the office.");
  }

  const current = await jobGateResponse(admin, session);
  return { response: current, at: now.toISOString(), trusted: false };
}
```

If `CheckResult`, `DriverSession`, `NextResponse` or `SupabaseClient` are not already imported in `server.ts`, they are (the file uses all four); confirm with a quick read of its import block.

- [ ] **Step 6: Typecheck and run the walkaround tests**

Run: `npx vitest run lib/walkaround && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/walkaround/jobGate.ts lib/walkaround/jobGate.test.ts lib/walkaround/server.ts
git commit -m "feat(walkaround): judge the job gate at an offline item's recorded time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Driver POD routes accept queued requests

**Files:**
- Modify: `app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/upload-url/route.ts`
- Modify: `app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/route.ts`
- Modify: `app/api/driver/jobs/[jobId]/stops/[stopId]/complete/route.ts`

No vitest coverage (app/ is not tested); the logic they call was tested in Tasks 2 to 5. Keep every existing check.

- [ ] **Step 1: upload-url route**

Add imports: `parseQueuedMeta` from `lib/pod/queuedMeta` and `queuedJobGate` from `lib/walkaround/server` (same relative depth as the existing `jobGateResponse` import). Replace:

```ts
    const gate = await jobGateResponse(admin, session);
    if (gate) return gate;
```

with:

```ts
    // A request from the offline queue is gated at the time it was recorded.
    const meta = parseQueuedMeta(body);
    if (meta) {
      const queued = await queuedJobGate(admin, session, meta);
      if (queued.response) return queued.response;
    } else {
      const gate = await jobGateResponse(admin, session);
      if (gate) return gate;
    }
```

and change the `createEvidenceUploadUrl` call to pass the client id:

```ts
    const upload = await createEvidenceUploadUrl(
      admin,
      { tenantId: session.tenantId, jobId, stopId },
      "photos",
      typeof body.filename === "string" ? body.filename : null,
      { clientId: meta?.clientId ?? null },
    );
```

Make sure the `body` type annotation in that file allows the extra fields (change it to `Record<string, unknown>` if it is a narrow object type, keeping the existing `typeof` checks).

- [ ] **Step 2: evidence record route**

Same import additions. Widen the body type to include `clientId?: unknown; shiftClientId?: unknown; recordedAt?: unknown`. Replace the `jobGateResponse` block with the same `meta` / `queuedJobGate` block as Step 1. Nothing else changes: `recordEvidenceRow` is already idempotent on `storage_path`.

- [ ] **Step 3: complete route**

Changes, in order:

1. Add imports: `parseQueuedMeta` and `queuedJobGate` as above.
2. Move body parsing ABOVE the gate (the queued gate needs the body). Widen `CompleteBody` with `clientId?: unknown; shiftClientId?: unknown; recordedAt?: unknown`.
3. Replace the gate and the later `completedAt = new Date().toISOString();` so the block reads:

```ts
    if (!alreadyCompleted) {
      let body: CompleteBody;

      try {
        body = (await request.json()) as CompleteBody;
      } catch {
        return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
      }

      const meta = parseQueuedMeta(body);
      let recordedAt = new Date().toISOString();
      let timeTrusted = true;

      if (meta) {
        const queued = await queuedJobGate(admin, session, meta);
        if (queued.response) return queued.response;
        recordedAt = queued.at;
        timeTrusted = queued.trusted;
      } else {
        const gate = await jobGateResponse(admin, session);
        if (gate) return gate;
      }

      if (!isWorkableJobStatus(job.status)) {
        return NextResponse.json({ error: jobNotWorkableMessage(job.status) }, { status: 409 });
      }

      // ... existing Promise.all lookups, validation and barcode block unchanged ...

      completedAt = recordedAt;
```

4. Replace the stop update with a version that writes `pod_flags` when the time was not trusted, and retries without it if the column is missing:

```ts
      const stopPatch: Record<string, unknown> = {
        recipient_name: validation.recipientName,
        pod_notes: validation.podNotes,
        delivered_at: completedAt,
        pod_updated_at: completedAt,
        pod_status: "delivered",
        status: "completed",
      };
      if (meta && !timeTrusted) stopPatch.pod_flags = ["pod_time_untrusted"];

      const updateStop = (patch: Record<string, unknown>) =>
        admin
          .from("job_stops")
          .update(patch)
          .eq("id", stopId)
          .eq("job_id", jobId)
          .eq("tenant_id", session.tenantId)
          .or("pod_status.is.null,pod_status.neq.delivered")
          .select("id");

      let { data: updatedStops, error: updateStopError } = await updateStop(stopPatch);

      if (updateStopError?.code === "42703" && "pod_flags" in stopPatch) {
        // tracking_02 not applied yet: never block a delivery on a missing flag column.
        console.warn("[driver/complete] job_stops.pod_flags is missing; saved without the untrusted-time flag. Apply tracking_02.");
        const { pod_flags: _omit, ...withoutFlag } = stopPatch;
        ({ data: updatedStops, error: updateStopError } = await updateStop(withoutFlag));
      }

      if (updateStopError) throw new Error(updateStopError.message);
```

The `if (!updatedStops || updatedStops.length === 0)` check and everything after it stay as they are.

- [ ] **Step 4: Typecheck and full test run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/api/driver/jobs/[jobId]/stops/[stopId]"
git commit -m "feat(driver): POD routes accept offline-queued requests

Gated at the recorded time against the named shift, recorded time used for
delivered_at when trusted, pod_time_untrusted flag otherwise, and queued
photos uploaded to a path derived from their client id.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: POD payload kinds and the pending projection

**Files:**
- Modify: `lib/offline/driverSync.ts`
- Modify: `lib/offline/driverSync.test.ts`

- [ ] **Step 1: Append the failing test to `lib/offline/driverSync.test.ts`**

Add `pendingPodByStop` and `type DriverQueuePayload` to the import from `./driverSync`, and `type QueueItem` from `./queue` if not already imported. Append:

```ts
describe("pendingPodByStop", () => {
  const item = (id: string, payload: DriverQueuePayload): QueueItem<DriverQueuePayload> => ({
    id,
    payload,
    attempts: 0,
    serverFailures: 0,
    nextAttemptAt: 0,
    lastError: null,
  });
  const base = { ownerId: "u1", jobId: "j1", shiftClientId: null, recordedAt: "2026-10-07T10:00:00.000Z" };
  const blob = new Blob(["x"]);

  it("groups photos, scans and the completion per stop for one job", () => {
    const queue = [
      item("p1", { kind: "pod_photo", ...base, clientId: "p1", stopId: "s1", blob, mimeType: "image/jpeg", filename: "a.jpg" }),
      item("c1", { kind: "pod_scan", ownerId: "u1", clientId: "c1", jobId: "j1", stopId: "s1", jobItemId: "i1", serialNumber: "SN1", scanFormat: "manual" }),
      item("d1", { kind: "pod_complete", ...base, clientId: "d1", stopId: "s1", recipientName: "Pat", podNotes: "" }),
      item("p2", { kind: "pod_photo", ...base, clientId: "p2", stopId: "s2", blob, mimeType: "image/jpeg", filename: "b.jpg" }),
      item("other", { kind: "pod_photo", ...base, jobId: "j2", clientId: "other", stopId: "s9", blob, mimeType: "image/jpeg", filename: "c.jpg" }),
    ];

    const result = pendingPodByStop(queue, "j1");

    expect(result.get("s1")).toEqual({
      photos: 1,
      scans: [{ job_item_id: "i1", serial_number: "SN1" }],
      completion: { recipientName: "Pat", podNotes: "", recordedAt: base.recordedAt },
    });
    expect(result.get("s2")).toEqual({ photos: 1, scans: [], completion: null });
    expect(result.has("s9")).toBe(false);
  });

  it("ignores shift events and defect photos", () => {
    const queue = [item("x", { kind: "photo", ownerId: "u1", defectClientId: "d", blob, mimeType: "image/jpeg", filename: "a.jpg" })];
    expect(pendingPodByStop(queue, "j1").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/offline/driverSync.test.ts`
Expected: FAIL, `pendingPodByStop` not exported (and type errors on the new kinds).

- [ ] **Step 3: Implement in `lib/offline/driverSync.ts`**

Replace the `DriverQueuePayload` type with:

```ts
export type DriverQueuePayload =
  | { kind: "event"; ownerId: string; event: DriverEvent }
  | { kind: "photo"; ownerId: string; defectClientId: string; blob: Blob; mimeType: string; filename: string }
  /* Offline POD. Queued in the order the driver acted, so a stop's photos and
     scans always reach the server before its completion. */
  | {
      kind: "pod_photo";
      ownerId: string;
      clientId: string;
      jobId: string;
      stopId: string;
      shiftClientId: string | null;
      recordedAt: string;
      blob: Blob;
      mimeType: string;
      filename: string;
    }
  | {
      kind: "pod_scan";
      ownerId: string;
      clientId: string;
      jobId: string;
      stopId: string;
      /** Matched on the phone (findExpectedSerial) for the projection; the server matches again. */
      jobItemId: string;
      serialNumber: string;
      scanFormat: string;
    }
  | {
      kind: "pod_complete";
      ownerId: string;
      clientId: string;
      jobId: string;
      stopId: string;
      shiftClientId: string | null;
      recordedAt: string;
      recipientName: string;
      podNotes: string;
    };
```

Update the header comment's second paragraph to mention POD items. Append:

```ts
export type PendingPod = {
  photos: number;
  scans: { job_item_id: string; serial_number: string }[];
  completion: null | { recipientName: string; podNotes: string; recordedAt: string };
};

/** Queued POD work for one job, per stop, so the job page can show it before it is sent. */
export function pendingPodByStop(queue: readonly QueueItem<DriverQueuePayload>[], jobId: string): Map<string, PendingPod> {
  const out = new Map<string, PendingPod>();
  const entry = (stopId: string) => {
    let found = out.get(stopId);
    if (!found) {
      found = { photos: 0, scans: [], completion: null };
      out.set(stopId, found);
    }
    return found;
  };
  for (const { payload } of queue) {
    if (payload.kind !== "pod_photo" && payload.kind !== "pod_scan" && payload.kind !== "pod_complete") continue;
    if (payload.jobId !== jobId) continue;
    const stop = entry(payload.stopId);
    if (payload.kind === "pod_photo") stop.photos += 1;
    else if (payload.kind === "pod_scan") stop.scans.push({ job_item_id: payload.jobItemId, serial_number: payload.serialNumber });
    else stop.completion = { recipientName: payload.recipientName, podNotes: payload.podNotes, recordedAt: payload.recordedAt };
  }
  return out;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run lib/offline && npm run typecheck`
Expected: tests PASS. Typecheck may now fail in `app/driver/driverQueue.ts` where `sendItem` assumes only two kinds; that is fixed in Task 9. If it fails only there, continue; fix anything else now.

- [ ] **Step 5: Commit**

```bash
git add lib/offline/driverSync.ts lib/offline/driverSync.test.ts
git commit -m "feat(offline): POD item kinds and per-stop pending projection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Doorstep validation for queued POD

**Files:**
- Create: `lib/driver/offlinePod.ts`
- Test: `lib/driver/offlinePod.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { checkQueuedCompletion, checkQueuedScan } from "./offlinePod";

const items = [
  { id: "i1", serial_numbers: ["SN1", "SN2"] },
  { id: "i2", serial_numbers: null },
];

describe("checkQueuedScan", () => {
  it("matches a known serial to its item", () => {
    expect(checkQueuedScan({ items, verified: [], value: "SN1" })).toEqual({ ok: true, jobItemId: "i1", serialNumber: "SN1" });
  });

  it("refuses an unknown serial with the server's wording", () => {
    const result = checkQueuedScan({ items, verified: [], value: "NOPE" });
    expect(result.ok).toBe(false);
  });

  it("says when the serial is already verified or queued", () => {
    const result = checkQueuedScan({ items, verified: [{ job_item_id: "i1", serial_number: "SN1" }], value: "SN1" });
    expect(result).toEqual({ ok: false, duplicate: true, message: "This item has already been verified on this job." });
  });
});

describe("checkQueuedCompletion", () => {
  const base = {
    recipientName: "Pat",
    podNotes: "",
    evidenceCount: 1,
    legacyPhotoUrl: null,
    items,
    verified: [
      { job_item_id: "i1", serial_number: "SN1" },
      { job_item_id: "i1", serial_number: "SN2" },
    ],
    otherOutstandingDeliveryStops: 0,
  };

  it("passes a complete delivery", () => {
    expect(checkQueuedCompletion(base)).toEqual({ ok: true });
  });

  it("needs a recipient name", () => {
    expect(checkQueuedCompletion({ ...base, recipientName: "  " })).toEqual({ ok: false, message: "Recipient name is required." });
  });

  it("needs evidence", () => {
    const result = checkQueuedCompletion({ ...base, evidenceCount: 0 });
    expect(result.ok).toBe(false);
  });

  it("needs every serial before the final delivery only", () => {
    const partial = { ...base, verified: [{ job_item_id: "i1", serial_number: "SN1" }] };
    expect(checkQueuedCompletion(partial).ok).toBe(false);
    expect(checkQueuedCompletion({ ...partial, otherOutstandingDeliveryStops: 1 })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/driver/offlinePod.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/*
  The checks the server runs on a POD, run on the phone before an item is
  queued, so a driver with no signal is told at the doorstep rather than hours
  later when the queue sends. The server still runs every check itself; these
  reuse the same pure rules (lib/driver/pod.ts, completionRules.ts, barcode.ts).
*/

import { findExpectedSerial } from "./barcode";
import { barcodeCompletionBlock } from "./completionRules";
import { validatePodCompletion } from "./pod";

type Item = { id: string; serial_numbers: string[] | null };
type Verified = { job_item_id: string; serial_number: string };

export const ALREADY_VERIFIED_MESSAGE = "This item has already been verified on this job.";

export function checkQueuedScan(input: { items: Item[]; verified: Verified[]; value: string }):
  | { ok: true; jobItemId: string; serialNumber: string }
  | { ok: false; duplicate: boolean; message: string } {
  const match = findExpectedSerial(input.items, input.value);
  if (!match.ok) return { ok: false, duplicate: false, message: match.message };
  if (input.verified.some((v) => v.job_item_id === match.itemId && v.serial_number === match.serialNumber)) {
    return { ok: false, duplicate: true, message: ALREADY_VERIFIED_MESSAGE };
  }
  return { ok: true, jobItemId: match.itemId, serialNumber: match.serialNumber };
}

export function checkQueuedCompletion(input: {
  recipientName: string;
  podNotes: string;
  evidenceCount: number;
  legacyPhotoUrl: string | null;
  items: Item[];
  verified: Verified[];
  otherOutstandingDeliveryStops: number;
}): { ok: true } | { ok: false; message: string } {
  const validation = validatePodCompletion({
    recipientName: input.recipientName,
    podNotes: input.podNotes,
    evidenceCount: input.evidenceCount,
    legacyPhotoUrl: input.legacyPhotoUrl,
  });
  if (!validation.ok) return { ok: false, message: validation.message };

  const block = barcodeCompletionBlock({
    items: input.items,
    scans: input.verified,
    otherOutstandingDeliveryStops: input.otherOutstandingDeliveryStops,
  });
  return block ? { ok: false, message: block } : { ok: true };
}
```

Before running, read `findExpectedSerial`'s success shape in `lib/driver/barcode.ts` (around line 140) and the types `SerializedJobItem` / `JobItemScanLike`. If the success fields are not `itemId` and `serialNumber`, or the item type needs more fields, adapt this file to the real names (the scans route uses `match.itemId` and `match.serialNumber`, so those should be right).

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/driver/offlinePod.test.ts && npm run typecheck`
Expected: PASS (typecheck may still fail only in `app/driver/driverQueue.ts` until Task 9).

- [ ] **Step 5: Commit**

```bash
git add lib/driver/offlinePod.ts lib/driver/offlinePod.test.ts
git commit -m "feat(driver): doorstep validation for queued POD scans and completions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Queue runner sends POD items

**Files:**
- Modify: `app/driver/driverQueue.ts`

- [ ] **Step 1: Extend `RejectedItem`**

```ts
export type RejectedItem = { id: string; message: string; ownerId?: string; jobId?: string; stopId?: string };
```

- [ ] **Step 2: Add the POD senders** (after `sendPhoto`)

```ts
const POD_BUCKET = "pod-files";

function stopEndpoint(jobId: string, stopId: string): string {
  return `/api/driver/jobs/${encodeURIComponent(jobId)}/stops/${encodeURIComponent(stopId)}`;
}

/* Same three steps as lib/pod/uploadClient.ts. The client id makes the server
   derive the path and sign with upsert, so a retry rewrites the same object. */
async function sendPodPhoto(payload: Extract<QueuePayload, { kind: "pod_photo" }>): Promise<SyncResult> {
  const endpoint = stopEndpoint(payload.jobId, payload.stopId);
  const meta = { clientId: payload.clientId, shiftClientId: payload.shiftClientId, recordedAt: payload.recordedAt };
  const start = await post(`${endpoint}/evidence/upload-url`, {
    ...meta,
    mimeType: payload.mimeType,
    size: payload.blob.size,
    filename: payload.filename,
  });
  if (start.status !== 200) return eventOutcome(start.status, start.error);
  const { path, token } = start.json;
  if (typeof path !== "string" || typeof token !== "string") return { kind: "retry", error: "Unable to start the photo upload.", status: 500 };

  try {
    const { error } = await createClient()
      .storage.from(POD_BUCKET)
      .uploadToSignedUrl(path, token, payload.blob, { contentType: payload.mimeType, upsert: true });
    if (error) return { kind: "retry", error: "The photo upload did not complete.", status: null };
  } catch {
    return { kind: "retry", error: "The photo upload did not complete.", status: null };
  }

  const record = await post(`${endpoint}/evidence`, {
    ...meta,
    storagePath: path,
    originalFilename: payload.filename,
    mimeType: payload.mimeType,
  });
  return eventOutcome(record.status, record.error);
}

async function sendPodScan(payload: Extract<QueuePayload, { kind: "pod_scan" }>): Promise<SyncResult> {
  const result = await post(`${stopEndpoint(payload.jobId, payload.stopId)}/scans`, {
    serial_number: payload.serialNumber,
    scan_format: payload.scanFormat,
  });
  return eventOutcome(result.status, result.error);
}

async function sendPodComplete(payload: Extract<QueuePayload, { kind: "pod_complete" }>): Promise<SyncResult> {
  const result = await post(`${stopEndpoint(payload.jobId, payload.stopId)}/complete`, {
    clientId: payload.clientId,
    shiftClientId: payload.shiftClientId,
    recordedAt: payload.recordedAt,
    recipient_name: payload.recipientName,
    pod_notes: payload.podNotes,
  });
  return eventOutcome(result.status, result.error);
}
```

- [ ] **Step 3: Route every kind in `sendItem`**

```ts
async function sendItem(item: QueueItem<QueuePayload>): Promise<SyncResult> {
  const payload = item.payload;
  switch (payload.kind) {
    case "photo":
      return sendPhoto(item, payload);
    case "pod_photo":
      return sendPodPhoto(payload);
    case "pod_scan":
      return sendPodScan(payload);
    case "pod_complete":
      return sendPodComplete(payload);
    case "event": {
      const result = await post(EVENTS_URL, payload.event);
      return eventOutcome(result.status, result.error);
    }
  }
}
```

- [ ] **Step 4: Record job and stop on POD refusals**

In `flushOnce`, replace the line that appends to `rejected`:

```ts
      const pod = "stopId" in head.payload ? { jobId: head.payload.jobId, stopId: head.payload.stopId } : {};
      rejected = [...rejected, { id: head.id, message, ownerId: head.payload.ownerId, ...pod }];
```

- [ ] **Step 5: Export enqueue helpers** (after `enqueuePhoto`)

```ts
type PodTarget = { jobId: string; stopId: string };

/** Queue one POD photo. Resolves once it is stored, not once it is sent. */
export function enqueuePodPhoto(
  input: PodTarget & { shiftClientId: string | null; blob: Blob; mimeType: string; filename: string },
): Promise<void> {
  const clientId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  return add(clientId, (ownerId) => ({ kind: "pod_photo", ownerId, clientId, recordedAt, ...input }));
}

/** Queue one barcode verification, already matched on the phone. */
export function enqueuePodScan(input: PodTarget & { jobItemId: string; serialNumber: string; scanFormat: string }): Promise<void> {
  const clientId = crypto.randomUUID();
  return add(clientId, (ownerId) => ({ kind: "pod_scan", ownerId, clientId, ...input }));
}

/** Queue a delivery completion. It is sent after the stop's queued photos and scans. */
export function enqueuePodComplete(
  input: PodTarget & { shiftClientId: string | null; recipientName: string; podNotes: string },
): Promise<void> {
  const clientId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  return add(clientId, (ownerId) => ({ kind: "pod_complete", ownerId, clientId, recordedAt, ...input }));
}
```

Update the file's header comment first paragraph to say it also carries offline POD photos, scans and completions.

- [ ] **Step 6: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/driver/driverQueue.ts
git commit -m "feat(driver): queue runner sends offline POD photos, scans and completions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Driver job page and barcode component enqueue

**Files:**
- Modify: `app/driver/jobs/[jobId]/page.tsx`
- Modify: `app/driver/jobs/[jobId]/BarcodeVerification.tsx`

Keep the fixed light palette and existing class names; this page is deliberately not tokenised.

- [ ] **Step 1: Page-level queue state** in `DriverJobPage`

Add imports:

```ts
import { useMemo, useSyncExternalStore } from "react";  // merge into the existing react import
import { pendingPodByStop, type PendingPod } from "../../../../lib/offline/driverSync";
import { getQueueSnapshot, getServerQueueSnapshot, subscribe, dismissRejected, type RejectedItem } from "../../driverQueue";
import { useDriverShift } from "../../useDriverShift";
```

Inside `DriverJobPage`, after the `loadJob` effect:

```ts
  const queue = useSyncExternalStore(subscribe, getQueueSnapshot, getServerQueueSnapshot);
  const shift = useDriverShift();
  const pendingByStop = useMemo(() => pendingPodByStop(queue.pending, jobId), [queue.pending, jobId]);
  const jobRejections = queue.rejected.filter((r) => r.jobId === jobId);
  const shiftClientId = shift.state?.openShift?.clientId ?? null;

  // Re-read the job once queued POD items for it have been sent.
  const pendingForJob = useMemo(() => [...pendingByStop.values()].reduce((n, p) => n + p.photos + p.scans.length + (p.completion ? 1 : 0), 0), [pendingByStop]);
  const lastPending = useRef(pendingForJob);
  useEffect(() => {
    if (pendingForJob < lastPending.current) {
      const timer = setTimeout(() => void loadJob(), 600);
      lastPending.current = pendingForJob;
      return () => clearTimeout(timer);
    }
    lastPending.current = pendingForJob;
  }, [pendingForJob, loadJob]);
```

These hooks must sit above the early `return`s for loading and missing job (hooks cannot be conditional). Move them directly under the existing `useEffect(() => { void loadJob(); }, [loadJob]);`.

Render a refusal list above the job section (below the `message` banner):

```tsx
        {jobRejections.map((r) => (
          <div key={r.id} className="mt-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-900">
            Not sent, tell the office: {r.message}
            <button type="button" className="ml-2 underline" onClick={() => dismissRejected(r.id)}>
              Dismiss
            </button>
          </div>
        ))}
```

Pass new props to every `StopCard`: `pending={pendingByStop.get(stop.id) ?? null}`, `shiftClientId={shiftClientId}`, `allStops={job.stops}`, `allPending={pendingByStop}`.

- [ ] **Step 2: `StopCard` enqueues**

Add to the props type: `pending: PendingPod | null; shiftClientId: string | null; allStops: Stop[]; allPending: Map<string, PendingPod>;`.

Add imports: `enqueuePodPhoto, enqueuePodComplete` from `"../../driverQueue"` and `checkQueuedCompletion` from `"../../../../lib/driver/offlinePod"`.

Replace `const delivered = stop.pod_status === "delivered";` with:

```ts
  const delivered = stop.pod_status === "delivered";
  const waitingToSend = !delivered && Boolean(pending?.completion);
```

Replace `uploadPhoto` with:

```ts
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      // Shrunk on the phone, then queued: it is sent now if there is signal,
      // or when signal returns. Queued shift events ahead of it go first.
      const photo = await preparePodPhoto(file);
      await enqueuePodPhoto({
        jobId,
        stopId: stop.id,
        shiftClientId,
        blob: photo.blob,
        mimeType: photo.mimeType,
        filename: photo.filename,
      });
      setMessage(navigator.onLine ? "POD photo saved. Sending now." : "POD photo saved. It will send when you have signal.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Unable to save POD photo.");
    } finally {
      setBusy(false);
    }
  }
```

Replace `completeDelivery` with:

```ts
  async function completeDelivery() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const verified = [...scans, ...[...allPending.values()].flatMap((p) => p.scans)];
      const otherOutstandingDeliveryStops = allStops.filter(
        (s) => s.type === "delivery" && s.id !== stop.id && s.pod_status !== "delivered" && !allPending.get(s.id)?.completion,
      ).length;

      const check = checkQueuedCompletion({
        recipientName,
        podNotes,
        evidenceCount: stop.evidence.length + (pending?.photos ?? 0),
        legacyPhotoUrl: stop.pod_photo_url,
        items,
        verified,
        otherOutstandingDeliveryStops,
      });
      if (!check.ok) {
        setError(check.message);
        return;
      }

      await enqueuePodComplete({ jobId, stopId: stop.id, shiftClientId, recipientName, podNotes });
      setMessage(navigator.onLine ? "Delivery saved. Sending now." : "Delivery saved. It will send when you have signal.");
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "Unable to save delivery.");
    } finally {
      setBusy(false);
    }
  }
```

Remove the now-unused imports (`uploadEvidenceViaSignedUrl`, `flushDriverQueue`, `createClient`, `POD_BUCKET` constant) only if nothing else in the file uses them; check with a search before deleting.

- [ ] **Step 3: Show the waiting state**

In `StopCard`'s JSX, find the block that renders when `delivered` is true (the "Delivery complete" panel around the original line 598). Add a sibling branch so the card renders, in order: `delivered` (unchanged), else `waitingToSend`:

```tsx
            {waitingToSend ? (
              <div className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
                Delivered, waiting to send
                {pending?.photos ? ` (${pending.photos} photo${pending.photos === 1 ? "" : "s"} queued)` : ""}.
                It will send automatically when you have signal.
              </div>
            ) : null}
```

and hide the POD form (recipient, notes, photo buttons, Complete button) while `waitingToSend` is true, by extending the existing condition that hides it when `delivered` to `delivered || waitingToSend`. Also show the queued photo count under the evidence list when `pending?.photos` is non-zero and the stop is not waiting: `"{n} photo(s) waiting to send"`.

Pass `pendingScans={pending?.scans ?? []}` and `allPendingScans={[...allPending.values()].flatMap((p) => p.scans)}` to `BarcodeVerification` (Step 4 needs them).

- [ ] **Step 4: `BarcodeVerification` enqueues**

Add props: `allPendingScans: { job_item_id: string; serial_number: string }[]`.

Add imports: `enqueuePodScan` from `"../../driverQueue"` and `checkQueuedScan` from `"../../../../lib/driver/offlinePod"`.

Change `verifiedKeys` to include queued scans:

```ts
  const verifiedKeys = useMemo(
    () => new Set([...scans, ...allPendingScans].map((scan) => `${scan.job_item_id}\u0000${scan.serial_number}`)),
    [scans, allPendingScans],
  );
```

Inside `submitSerial`, replace the `submitBarcodeScan(...)` call and the code that uses `outcome` with:

```ts
      const check = checkQueuedScan({
        items: items.map((i) => ({ id: i.id, serial_numbers: i.serial_numbers })),
        verified: [...scans, ...allPendingScans],
        value: submittedValue,
      });

      if (scanFormat === "manual") setSerial("");

      if (!check.ok && check.duplicate) {
        // Same answer the server gave for a repeat scan: ok, but a duplicate.
        setMessage(check.message);
        return { ok: true, duplicate: true, message: check.message };
      }

      if (!check.ok) {
        setError(check.message);
        return { ok: false, duplicate: false, message: check.message };
      }

      await enqueuePodScan({ jobId, stopId, jobItemId: check.jobItemId, serialNumber: check.serialNumber, scanFormat });
      const outcome: BarcodeSubmitResult = { ok: true, duplicate: false, message: "Item verified." };
      setMessage(outcome.message);
      return outcome;
```

Keep the `try/catch/finally` around it. Remove the `submitBarcodeScan` import and the `onChanged` call from this function only if nothing else in the file uses them. The duplicate rule matches the old server answer (`ok: true, duplicate: true`), so the camera scanner's handling of `duplicate` is unchanged.

- [ ] **Step 5: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/driver/jobs/[jobId]"
git commit -m "feat(driver): complete deliveries offline through the queue

Photos, scans and completions are queued and sent in order; the stop shows
'Delivered, waiting to send' straight away, doorstep checks run on the phone,
and refusals for the job are listed on the page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: "Time not trusted" tag in /jobs

**Files:**
- Modify: `app/jobs/StopCard.tsx`

- [ ] **Step 1: Add the field and the tag**

Add `pod_flags?: string[] | null;` to the exported `Stop` type. Check where `/jobs` selects stop columns (search `app/jobs/page.tsx` for the `job_stops` select string); add `pod_flags` to it ONLY if the select lists columns explicitly, and handle the column being absent: if the select is explicit, PostgREST answers 42703 for a missing column and fails the whole list, so instead keep the select unchanged and read the flag from a `*` select if one is used. If the select is explicit, skip adding the column there and add a follow-up line to the handoff instead ("add pod_flags to the /jobs stop select after tracking_02 is applied"). Do not break /jobs before the migration is applied.

Next to the stop's delivered time, render:

```tsx
{stop.pod_flags?.includes("pod_time_untrusted") ? (
  <span
    className="ml-1.5 rounded border border-line px-1 text-xs text-warning"
    title="This delivery was saved with no signal and the phone's clock could not be trusted, so the time shown is when the server received it."
  >
    Time not trusted
  </span>
) : null}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/jobs/StopCard.tsx app/jobs/page.tsx
git commit -m "feat(jobs): show when an offline POD time was not trusted

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part B: Customer tracking links

### Task 12: Tracking tables migration and apply order

**Files:**
- Create: `docs/sql/tracking_01_links_and_eta_cache.sql`
- Modify: `docs/sql/prodfix_00_APPLY_ORDER.md`

- [ ] **Step 1: Write the migration**

```sql
-- tracking_01_links_and_eta_cache.sql
--
-- Why: customer tracking links (docs/superpowers/specs/2026-10-07-offline-pod-and-tracking-links-design.md).
-- The office sends a delivery contact a link to a public page with an ETA and, once the van is heading
-- to that stop, a live map. Tokens are random and only their SHA-256 hash is stored, exactly like
-- pod_share_links (prodfix_60).
--
-- Access model: both tables are read and written ONLY by server routes on the service role
-- (app/api/tracking-links/*, app/api/public/track/[token]). RLS on with no policies, every client
-- grant revoked, so anon and authenticated users cannot see or forge rows.
--
-- Deploy order: the app degrades safely without these tables. Minting a link answers "Tracking links
-- are not available yet" and every token reads as an ended link.
--
-- document_delivery_log: emailed links are logged with document_type 'tracking_link'. The DDL for
-- that table is not in the repo. The block at the end WARNS (does not fail) if a check constraint on
-- document_type exists; if it does, the email route will 500 before sending anything until the
-- constraint is widened by hand to include 'tracking_link'.
--
-- Idempotent.

begin;

create table if not exists public.stop_tracking_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  stop_id uuid not null references public.job_stops(id) on delete cascade,
  token_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  sent_to_email text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  last_viewed_at timestamptz,
  constraint stop_tracking_links_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint stop_tracking_links_expiry_after_creation check (expires_at > created_at)
);

create unique index if not exists stop_tracking_links_token_hash_uidx
  on public.stop_tracking_links (token_hash);

create index if not exists stop_tracking_links_stop_idx
  on public.stop_tracking_links (tenant_id, stop_id)
  where revoked_at is null;

create table if not exists public.stop_eta_cache (
  stop_id uuid primary key references public.job_stops(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  eta timestamptz not null,
  computed_at timestamptz not null default now(),
  from_position_at timestamptz not null
);

do $$
declare
  t text;
begin
  foreach t in array array['stop_tracking_links', 'stop_eta_cache'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('revoke all on public.%I from public', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;

do $$
declare
  def text;
begin
  if to_regclass('public.document_delivery_log') is null then
    raise warning 'document_delivery_log does not exist; tracking link emails cannot be logged.';
    return;
  end if;
  select string_agg(pg_get_constraintdef(c.oid), '; ')
  into def
  from pg_constraint c
  where c.conrelid = 'public.document_delivery_log'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%document_type%';
  if def is not null and def not ilike '%tracking_link%' then
    raise warning 'document_delivery_log has a document_type check that does not allow tracking_link: %', def;
  end if;
end $$;

commit;

-- VERIFY (expect for both tables: rls=true, force=true, policies=0, all client privileges false):
-- select c.relname,
--        c.relrowsecurity as rls,
--        c.relforcerowsecurity as force,
--        (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
--        has_table_privilege('anon', c.oid, 'select') as anon_select,
--        has_table_privilege('authenticated', c.oid, 'select') as auth_select,
--        has_table_privilege('authenticated', c.oid, 'insert') as auth_insert
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'public' and c.relname in ('stop_tracking_links', 'stop_eta_cache');
```

- [ ] **Step 2: Append a section to `docs/sql/prodfix_00_APPLY_ORDER.md`**

```markdown
## Offline POD and tracking links, 2026-10-07

Spec: `docs/superpowers/specs/2026-10-07-offline-pod-and-tracking-links-design.md`. Both files are
additive and the app degrades without them, so they can run before or after deploying. Order between
them does not matter.

| Order | File | Needs | Applied |
|---|---|---|---|
| 1 | `tracking_01_links_and_eta_cache.sql` | none. Read its WARNING output: a document_type check on `document_delivery_log` must be widened to allow `tracking_link` or emailing a link fails (before anything is sent) | no |
| 2 | `tracking_02_pod_flags.sql` | none | no |

Offline POD for own-fleet drivers is still gated by the walkaround job gate, so it only works once
`shifts_01..05` are applied (after S-1 from the 2026-10-07 security scan is fixed). Prefilled tracking
link recipients come from `20260929093000_job_stop_contacts.sql`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/sql/tracking_01_links_and_eta_cache.sql docs/sql/prodfix_00_APPLY_ORDER.md
git commit -m "feat(sql): tracking link and ETA cache tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Tracking tokens and expiry

**Files:**
- Create: `lib/tracking/links.ts`
- Test: `lib/tracking/links.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  evaluateTrackingLink,
  generateTrackingToken,
  hashTrackingToken,
  isWellFormedTrackingToken,
  trackingLinkExpiry,
} from "./links";

describe("tracking tokens", () => {
  it("mints well-formed, distinct tokens", () => {
    const a = generateTrackingToken();
    const b = generateTrackingToken();
    expect(isWellFormedTrackingToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.startsWith("trk_")).toBe(true);
  });

  it("refuses anything else, including POD share tokens", () => {
    for (const value of [undefined, "", "trk_short", `pod_${"a".repeat(43)}`, `trk_${"a".repeat(43)}/x`]) {
      expect(isWellFormedTrackingToken(value)).toBe(false);
    }
  });

  it("hashes to 64 hex characters, deterministically", () => {
    const token = generateTrackingToken();
    expect(hashTrackingToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashTrackingToken(token)).toBe(hashTrackingToken(token));
  });
});

describe("trackingLinkExpiry", () => {
  const now = new Date("2026-10-07T09:00:00.000Z");

  it("lasts until the end of the planned date plus two days", () => {
    expect(trackingLinkExpiry("2026-10-08", now)).toBe("2026-10-11T00:00:00.000Z");
  });

  it("lasts at least 24 hours when the planned date is in the past", () => {
    expect(trackingLinkExpiry("2026-09-01", now)).toBe("2026-10-08T09:00:00.000Z");
  });

  it("lasts 7 days with no planned date", () => {
    expect(trackingLinkExpiry(null, now)).toBe("2026-10-14T09:00:00.000Z");
    expect(trackingLinkExpiry("not-a-date", now)).toBe("2026-10-14T09:00:00.000Z");
  });
});

describe("evaluateTrackingLink", () => {
  const now = new Date("2026-10-07T09:00:00.000Z");
  it("accepts a live link and refuses revoked, expired and missing ones", () => {
    expect(evaluateTrackingLink({ expires_at: "2026-10-08T00:00:00.000Z", revoked_at: null }, now)).toBe(true);
    expect(evaluateTrackingLink({ expires_at: "2026-10-08T00:00:00.000Z", revoked_at: "2026-10-07T08:00:00.000Z" }, now)).toBe(false);
    expect(evaluateTrackingLink({ expires_at: "2026-10-07T09:00:00.000Z", revoked_at: null }, now)).toBe(false);
    expect(evaluateTrackingLink(null, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/tracking/links.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/*
  Customer tracking links: the same design as POD share links
  (lib/pod/shareLinks.ts). A token is 32 random bytes with no meaning of its
  own; only its SHA-256 hash is stored, in stop_tracking_links
  (docs/sql/tracking_01_links_and_eta_cache.sql), with expiry and revocation,
  and every view re-checks the row, the stop and the job.

  Pure except for node:crypto; the store is lib/tracking/linkStore.ts.
*/

import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "trk_";
const TOKEN_RE = /^trk_[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function generateTrackingToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isWellFormedTrackingToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function hashTrackingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
  When a new link expires. With a planned date: the end of that day plus two
  more, taken at UTC midnight (at most an hour after London midnight in
  summer), but never less than 24 hours from now. With none: 7 days.
*/
export function trackingLinkExpiry(plannedDate: string | null, now: Date): string {
  const match = plannedDate ? DATE_RE.exec(plannedDate) : null;
  if (!match) return new Date(now.getTime() + 7 * DAY_MS).toISOString();
  const end = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 3);
  return new Date(Math.max(end, now.getTime() + DAY_MS)).toISOString();
}

export type TrackingLinkRow = { expires_at: string; revoked_at: string | null };

export function evaluateTrackingLink(row: TrackingLinkRow | null, now: Date): boolean {
  if (!row || row.revoked_at) return false;
  const expires = Date.parse(row.expires_at);
  return !Number.isNaN(expires) && expires > now.getTime();
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/tracking/links.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tracking/links.ts lib/tracking/links.test.ts
git commit -m "feat(tracking): opaque tracking link tokens and expiry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Share reference and delivery type for tracking emails

**Files:**
- Modify: `lib/documents/shareReference.ts`
- Modify: the existing share reference test (find it with `ls lib/documents/*.test.ts`; it contains `describe("assertOpaqueShareReference"`)
- Modify: `lib/documents/delivery.ts:3-10`

- [ ] **Step 1: Append failing tests to that test file**

Add `trackingShareReference` to its import, then append:

```ts
describe("tracking share references", () => {
  it("builds a reference from the stored hash", () => {
    const hash = "a".repeat(64);
    expect(trackingShareReference(hash)).toBe(`tracking_share:${hash}`);
    expect(assertOpaqueShareReference(trackingShareReference(hash))).toBe(`tracking_share:${hash}`);
  });

  it("refuses anything that is not a hash", () => {
    expect(() => trackingShareReference("trk_abc")).toThrow();
  });

  it("refuses a raw tracking token or a tracking URL", () => {
    expect(() => assertOpaqueShareReference(`trk_${"A".repeat(43)}`)).toThrow();
    expect(() => assertOpaqueShareReference("/track/abc")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/documents`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `lib/documents/shareReference.ts`: add `tracking_share:<sha256 hex>  the stop_tracking_links.token_hash column` to the header list; add

```ts
// trk_ plus 43 base64url characters is the shape generateTrackingToken mints.
const LOOKS_LIKE_TRACKING_TOKEN = /^trk_[A-Za-z0-9_-]{43}$/;
```

extend the refusal condition in `assertOpaqueShareReference` with `|| reference.includes("/track/") || LOOKS_LIKE_TRACKING_TOKEN.test(reference)`, and append:

```ts
export function trackingShareReference(tokenHash: string): string {
  if (!SHA256_HEX.test(tokenHash)) {
    throw new Error("trackingShareReference expects the stored token hash");
  }
  return `tracking_share:${tokenHash}`;
}
```

In `lib/documents/delivery.ts`, add `| "tracking_link"` to `DeliveryDocumentType`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/documents && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/documents
git commit -m "feat(documents): opaque share reference for tracking link emails

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: ETA logic

**Files:**
- Create: `lib/tracking/eta.ts`
- Test: `lib/tracking/eta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { etaWindow, latenessMs, roundToFiveMinutes, shouldRefreshEta, stopsBefore, trackingState, type EtaContext } from "./eta";

const now = new Date("2026-10-07T11:00:00.000Z"); // 12:00 London (BST)

function ctx(over: Partial<EtaContext> = {}): EtaContext {
  return {
    now,
    stop: { id: "s3", jobId: "j3", completed: false, deliveredAt: null, plannedDate: "2026-10-07" },
    job: { vehicleId: "v1", deliveryEta: "2026-10-07T13:00:00.000Z", deliveryStopCount: 1, incompleteStopIds: ["s3"] },
    itinerary: [
      { stopId: "s1", jobId: "j1", type: "delivery", completed: true, deliveredAt: "2026-10-07T10:20:00.000Z" },
      { stopId: "s2", jobId: "j2", type: "delivery", completed: false, deliveredAt: null },
      { stopId: "s3", jobId: "j3", type: "delivery", completed: false, deliveredAt: null },
    ],
    baselines: { j1: "2026-10-07T10:00:00.000Z", j2: "2026-10-07T12:00:00.000Z", j3: "2026-10-07T13:00:00.000Z" },
    ...over,
  };
}

describe("trackingState", () => {
  it("is delivered once the stop is complete", () => {
    expect(trackingState(ctx({ stop: { ...ctx().stop, completed: true, deliveredAt: "2026-10-07T10:59:00.000Z" } }))).toBe("delivered");
  });

  it("is next when it is the first incomplete stop in the itinerary", () => {
    const c = ctx();
    c.itinerary![1] = { ...c.itinerary![1], completed: true, deliveredAt: "2026-10-07T10:50:00.000Z" };
    expect(trackingState(c)).toBe("next");
  });

  it("is en route when earlier stops are still to do today", () => {
    expect(trackingState(ctx())).toBe("en_route_earlier");
  });

  it("is scheduled before the planned date", () => {
    expect(trackingState(ctx({ stop: { ...ctx().stop, plannedDate: "2026-10-08" } }))).toBe("scheduled");
  });

  it("without an itinerary, is next only when it is the job's last incomplete stop and a vehicle is assigned", () => {
    expect(trackingState(ctx({ itinerary: null }))).toBe("next");
    expect(trackingState(ctx({ itinerary: null, job: { ...ctx().job, incompleteStopIds: ["s0", "s3"] } }))).toBe("en_route_earlier");
    expect(trackingState(ctx({ itinerary: null, job: { ...ctx().job, vehicleId: null } }))).toBe("en_route_earlier");
  });
});

describe("stopsBefore", () => {
  it("counts incomplete delivery stops ahead in the itinerary", () => {
    expect(stopsBefore(ctx())).toBe(1);
  });
  it("is null without an itinerary", () => {
    expect(stopsBefore(ctx({ itinerary: null }))).toBeNull();
  });
});

describe("latenessMs", () => {
  it("uses the most recent completed stop before this one that has a baseline", () => {
    expect(latenessMs(ctx())).toBe(20 * 60 * 1000);
  });
  it("clamps to the allowed range", () => {
    const c = ctx();
    c.itinerary![0] = { ...c.itinerary![0], deliveredAt: "2026-10-07T20:00:00.000Z" };
    expect(latenessMs(c)).toBe(6 * 60 * 60 * 1000);
  });
  it("is zero with nothing to compare", () => {
    expect(latenessMs(ctx({ itinerary: null }))).toBe(0);
  });
});

describe("etaWindow", () => {
  it("is baseline plus lateness, plus and minus 30 minutes, rounded outward to 15 minutes", () => {
    // 13:00Z + 20m = 13:20Z; window 12:50Z to 13:50Z; rounded outward 12:45Z to 14:00Z.
    expect(etaWindow(ctx())).toEqual({ from: "2026-10-07T12:45:00.000Z", to: "2026-10-07T14:00:00.000Z" });
  });
  it("is null for a job with several delivery stops", () => {
    expect(etaWindow(ctx({ job: { ...ctx().job, deliveryStopCount: 2 } }))).toBeNull();
  });
  it("is null with no baseline", () => {
    expect(etaWindow(ctx({ job: { ...ctx().job, deliveryEta: null } }))).toBeNull();
  });
});

describe("shouldRefreshEta", () => {
  const positionAt = "2026-10-07T10:59:00.000Z";
  it("refreshes with no cache, a stale cache, or a newer position", () => {
    expect(shouldRefreshEta(null, positionAt, now)).toBe(true);
    expect(shouldRefreshEta({ computedAt: "2026-10-07T10:57:59.000Z", fromPositionAt: positionAt }, positionAt, now)).toBe(true);
    expect(shouldRefreshEta({ computedAt: "2026-10-07T10:59:30.000Z", fromPositionAt: "2026-10-07T10:58:00.000Z" }, positionAt, now)).toBe(true);
  });
  it("reuses a fresh cache built from the same position", () => {
    expect(shouldRefreshEta({ computedAt: "2026-10-07T10:59:30.000Z", fromPositionAt: positionAt }, positionAt, now)).toBe(false);
  });
});

describe("roundToFiveMinutes", () => {
  it("rounds to the nearest five minutes", () => {
    expect(roundToFiveMinutes("2026-10-07T13:22:29.000Z")).toBe("2026-10-07T13:20:00.000Z");
    expect(roundToFiveMinutes("2026-10-07T13:22:31.000Z")).toBe("2026-10-07T13:25:00.000Z");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tracking/eta.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/*
  ETA rules for the public tracking page. Pure; lib/tracking/trackingServer.ts
  loads the inputs and does the TomTom call.

  Before the van is heading to this stop the page shows a window: the
  planner's ETA for the job (jobs.delivery_eta, only meaningful when the job
  has a single delivery stop) shifted by how late or early the driver ran on
  the last completed stop earlier in the day. Once this stop is next, the live
  ETA from TomTom replaces it (shouldRefreshEta decides when to ask again).
*/

import { operatorDay } from "../time";

export type ItineraryStop = { stopId: string; jobId: string; type: string; completed: boolean; deliveredAt: string | null };

export type EtaContext = {
  now: Date;
  stop: { id: string; jobId: string; completed: boolean; deliveredAt: string | null; plannedDate: string | null };
  job: { vehicleId: string | null; deliveryEta: string | null; deliveryStopCount: number; incompleteStopIds: string[] };
  /** Today's planned order for the job's vehicle, or null when the day was not planned. */
  itinerary: ItineraryStop[] | null;
  /** delivery_eta per job id, for single-delivery-stop jobs only (null otherwise). */
  baselines: Record<string, string | null>;
};

export type TrackingState = "scheduled" | "en_route_earlier" | "next" | "delivered";

const MINUTE = 60 * 1000;
export const LATENESS_MIN_MS = -2 * 60 * MINUTE;
export const LATENESS_MAX_MS = 6 * 60 * MINUTE;
export const ETA_CACHE_MS = 2 * MINUTE;

function indexInItinerary(ctx: EtaContext): number {
  return ctx.itinerary ? ctx.itinerary.findIndex((s) => s.stopId === ctx.stop.id) : -1;
}

export function trackingState(ctx: EtaContext): TrackingState {
  if (ctx.stop.completed) return "delivered";
  if (ctx.stop.plannedDate && ctx.stop.plannedDate > operatorDay(ctx.now)) return "scheduled";

  const index = indexInItinerary(ctx);
  if (ctx.itinerary && index >= 0) {
    const firstIncomplete = ctx.itinerary.findIndex((s) => !s.completed);
    return firstIncomplete === index ? "next" : "en_route_earlier";
  }

  const onlyRemaining = ctx.job.incompleteStopIds.length === 1 && ctx.job.incompleteStopIds[0] === ctx.stop.id;
  return onlyRemaining && ctx.job.vehicleId ? "next" : "en_route_earlier";
}

export function stopsBefore(ctx: EtaContext): number | null {
  const index = indexInItinerary(ctx);
  if (!ctx.itinerary || index < 0) return null;
  return ctx.itinerary.slice(0, index).filter((s) => s.type === "delivery" && !s.completed).length;
}

export function latenessMs(ctx: EtaContext): number {
  const index = indexInItinerary(ctx);
  if (!ctx.itinerary || index < 0) return 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const s = ctx.itinerary[i];
    const baseline = ctx.baselines[s.jobId];
    if (!s.completed || !s.deliveredAt || !baseline) continue;
    const diff = Date.parse(s.deliveredAt) - Date.parse(baseline);
    if (Number.isNaN(diff)) continue;
    return Math.min(LATENESS_MAX_MS, Math.max(LATENESS_MIN_MS, diff));
  }
  return 0;
}

const QUARTER = 15 * MINUTE;

export function etaWindow(ctx: EtaContext): { from: string; to: string } | null {
  if (ctx.job.deliveryStopCount !== 1 || !ctx.job.deliveryEta) return null;
  const baseline = Date.parse(ctx.job.deliveryEta);
  if (Number.isNaN(baseline)) return null;
  const centre = baseline + latenessMs(ctx);
  const from = Math.floor((centre - 30 * MINUTE) / QUARTER) * QUARTER;
  const to = Math.ceil((centre + 30 * MINUTE) / QUARTER) * QUARTER;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

export type EtaCacheRow = { computedAt: string; fromPositionAt: string };

export function shouldRefreshEta(cache: EtaCacheRow | null, positionAt: string, now: Date): boolean {
  if (!cache) return true;
  if (now.getTime() - Date.parse(cache.computedAt) > ETA_CACHE_MS) return true;
  return Date.parse(positionAt) > Date.parse(cache.fromPositionAt);
}

export function roundToFiveMinutes(iso: string): string {
  const step = 5 * MINUTE;
  return new Date(Math.round(Date.parse(iso) / step) * step).toISOString();
}
```

Before running, confirm `operatorDay(now)` in `lib/time.ts` returns a `YYYY-MM-DD` London date (it is defined at line 43). If the name differs, use the London-date helper that file exports.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tracking/eta.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tracking/eta.ts lib/tracking/eta.test.ts
git commit -m "feat(tracking): ETA window, lateness and next-stop rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: Public payload builder

**Files:**
- Create: `lib/tracking/publicPayload.ts`
- Test: `lib/tracking/publicPayload.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { POSITION_FRESH_MS, buildTrackingPayload, isTrackingEnded, type TrackingPayloadInput } from "./publicPayload";

const now = new Date("2026-10-07T11:00:00.000Z");
const ALLOWED_KEYS = ["operator", "state", "etaWindow", "etaLive", "stopsBefore", "position", "destination", "deliveredAt"].sort();

function input(over: Partial<TrackingPayloadInput> = {}): TrackingPayloadInput {
  return {
    now,
    operatorName: "Acme Haulage",
    state: "next",
    etaWindow: { from: "2026-10-07T12:45:00.000Z", to: "2026-10-07T14:00:00.000Z" },
    etaLive: "2026-10-07T11:25:00.000Z",
    stopsBefore: 0,
    position: { lat: 52.1, lng: -1.2, at: "2026-10-07T10:58:00.000Z" },
    destination: { lat: 52.3, lng: -1.4 },
    deliveredAt: null,
    ...over,
  };
}

describe("buildTrackingPayload", () => {
  it("never carries anything outside the allowed keys, whatever it is given", () => {
    const smuggled = { ...input(), driverName: "Sam", registration: "AB12 CDE", vehicleId: "v1", reference: "J-1", recipientName: "Pat" };
    for (const state of ["scheduled", "en_route_earlier", "next", "delivered"] as const) {
      const payload = buildTrackingPayload({ ...smuggled, state } as TrackingPayloadInput);
      expect(Object.keys(payload).sort()).toEqual(ALLOWED_KEYS);
      expect(Object.keys(payload.operator)).toEqual(["name"]);
      const text = JSON.stringify(payload);
      for (const secret of ["Sam", "AB12 CDE", "J-1", "Pat", "v1"]) expect(text).not.toContain(secret);
    }
  });

  it("shows position, destination and live ETA only when next", () => {
    const next = buildTrackingPayload(input());
    expect(next.position).toEqual({ lat: 52.1, lng: -1.2, at: "2026-10-07T10:58:00.000Z" });
    expect(next.destination).toEqual({ lat: 52.3, lng: -1.4 });
    expect(next.etaLive).toBe("2026-10-07T11:25:00.000Z");

    for (const state of ["scheduled", "en_route_earlier", "delivered"] as const) {
      const other = buildTrackingPayload(input({ state }));
      expect(other.position).toBeNull();
      expect(other.destination).toBeNull();
      expect(other.etaLive).toBeNull();
    }
  });

  it("hides a stale position but keeps the destination", () => {
    const stale = new Date(now.getTime() - POSITION_FRESH_MS - 1).toISOString();
    const payload = buildTrackingPayload(input({ position: { lat: 1, lng: 2, at: stale } }));
    expect(payload.position).toBeNull();
    expect(payload.destination).toEqual({ lat: 52.3, lng: -1.4 });
  });

  it("shows the delivered time only when delivered, and no window then", () => {
    const delivered = buildTrackingPayload(input({ state: "delivered", deliveredAt: "2026-10-07T10:32:00.000Z" }));
    expect(delivered.deliveredAt).toBe("2026-10-07T10:32:00.000Z");
    expect(delivered.etaWindow).toBeNull();
    expect(buildTrackingPayload(input({ deliveredAt: "2026-10-07T10:32:00.000Z" })).deliveredAt).toBeNull();
  });
});

describe("isTrackingEnded", () => {
  it("ends 24 hours after delivery or when the job is cancelled", () => {
    expect(isTrackingEnded({ jobStatus: "cancelled", deliveredAt: null, now })).toBe(true);
    expect(isTrackingEnded({ jobStatus: "in_progress", deliveredAt: "2026-10-06T10:59:59.000Z", now })).toBe(true);
    expect(isTrackingEnded({ jobStatus: "completed", deliveredAt: "2026-10-06T11:00:01.000Z", now })).toBe(false);
    expect(isTrackingEnded({ jobStatus: "accepted", deliveredAt: null, now })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tracking/publicPayload.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/*
  The ONLY place that decides what the public tracking route returns. Built
  field by field from explicit inputs (never by spreading a row), so a column
  added to a query can never leak to an anonymous viewer.

  Never included: the driver's name or id, the vehicle's registration or id,
  other stops' addresses or positions, the recipient, the job reference or the
  customer. The vehicle position is shown only while this stop is next and the
  fix is fresher than 10 minutes: it is the driver's location (personal data)
  and, earlier in the day, it would reveal other customers' drops.
*/

import type { TrackingState } from "./eta";

export const POSITION_FRESH_MS = 10 * 60 * 1000;
export const TRACKING_ENDS_AFTER_DELIVERY_MS = 24 * 60 * 60 * 1000;

type LatLng = { lat: number; lng: number };

export type TrackingPayloadInput = {
  now: Date;
  operatorName: string;
  state: TrackingState;
  etaWindow: { from: string; to: string } | null;
  etaLive: string | null;
  stopsBefore: number | null;
  position: (LatLng & { at: string }) | null;
  destination: LatLng | null;
  deliveredAt: string | null;
};

export type TrackingPayload = {
  operator: { name: string };
  state: TrackingState;
  etaWindow: { from: string; to: string } | null;
  etaLive: string | null;
  stopsBefore: number | null;
  position: (LatLng & { at: string }) | null;
  destination: LatLng | null;
  deliveredAt: string | null;
};

function latLng(value: LatLng | null): LatLng | null {
  if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lng)) return null;
  return { lat: value.lat, lng: value.lng };
}

export function buildTrackingPayload(input: TrackingPayloadInput): TrackingPayload {
  const next = input.state === "next";
  const delivered = input.state === "delivered";

  let position: TrackingPayload["position"] = null;
  if (next && input.position) {
    const fresh = input.now.getTime() - Date.parse(input.position.at) <= POSITION_FRESH_MS;
    const point = latLng(input.position);
    if (fresh && point) position = { ...point, at: input.position.at };
  }

  return {
    operator: { name: input.operatorName },
    state: input.state,
    etaWindow: delivered || !input.etaWindow ? null : { from: input.etaWindow.from, to: input.etaWindow.to },
    etaLive: next ? input.etaLive : null,
    stopsBefore: delivered ? null : input.stopsBefore,
    position,
    destination: next ? latLng(input.destination) : null,
    deliveredAt: delivered ? input.deliveredAt : null,
  };
}

export function isTrackingEnded(input: { jobStatus: string | null; deliveredAt: string | null; now: Date }): boolean {
  if (input.jobStatus === "cancelled") return true;
  if (!input.deliveredAt) return false;
  const at = Date.parse(input.deliveredAt);
  return !Number.isNaN(at) && input.now.getTime() - at > TRACKING_ENDS_AFTER_DELIVERY_MS;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/tracking/publicPayload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tracking/publicPayload.ts lib/tracking/publicPayload.test.ts
git commit -m "feat(tracking): public payload builder that decides what leaves the server

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: TomTom route with traffic

**Files:**
- Modify: `lib/tomtom/api.ts:27-30`
- Modify: `lib/tomtom/api.test.ts`

- [ ] **Step 1: Append failing test inside the existing `describe("routeUrl"` block**

```ts
  it("asks for traffic only when told to", () => {
    const points = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }];
    expect(routeUrl(points, "k")).toContain("traffic=false");
    expect(routeUrl(points, "k", { traffic: true })).toContain("traffic=true");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/tomtom/api.test.ts`
Expected: FAIL (TypeScript arity or `traffic=false` in the second URL).

- [ ] **Step 3: Implement**

```ts
export function routeUrl(points: LatLng[], key: string, options: { traffic?: boolean } = {}): string {
  const locations = points.map((p) => `${p.lat},${p.lng}`).join(":");
  const traffic = options.traffic ? "true" : "false";
  return `${BASE}/routing/1/calculateRoute/${locations}/json?key=${encodeURIComponent(key)}&travelMode=car&traffic=${traffic}&routeRepresentation=polyline`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/tomtom`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/tomtom/api.ts lib/tomtom/api.test.ts
git commit -m "feat(tomtom): optional traffic-aware routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 18: Server store and view loader

**Files:**
- Create: `lib/tracking/linkStore.ts`
- Create: `lib/tracking/trackingServer.ts`
- Modify: `lib/rateLimit.ts` (add one rule to `RATE_LIMITS`)

These touch Supabase and TomTom and are not unit tested; every decision they make is delegated to Tasks 13 to 17.

- [ ] **Step 1: Rate limit rule** in `RATE_LIMITS` (next to `podSharePdfPerIp`)

```ts
  /* Public tracking page JSON (GET /api/public/track/[token]). The page polls
     every 60 seconds, so 120 per 10 minutes per IP allows a dozen open tabs
     behind one office NAT while capping anonymous scraping. */
  trackingViewPerIp: { bucket: "tracking-view:ip", windowSeconds: 600, max: 120 },
```

- [ ] **Step 2: `lib/tracking/linkStore.ts`**

```ts
/*
  Server-only store for tracking links. Rules and rationale: lib/tracking/links.ts.
  Backed by docs/sql/tracking_01_links_and_eta_cache.sql. Never import from client code.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateTrackingLink, generateTrackingToken, hashTrackingToken, isWellFormedTrackingToken, trackingLinkExpiry } from "./links";

const TABLE = "stop_tracking_links";
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);

export class TrackingUnavailableError extends Error {
  constructor() {
    super("Tracking links are not available yet. An administrator needs to apply the tracking_01 database migration.");
  }
}

export class TrackableStopError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isMissingTable(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING_RELATION_CODES.has(error.code));
}

export type TrackableStop = {
  stopId: string;
  jobId: string;
  tenantId: string;
  plannedDate: string | null;
  customerId: string | null;
  reference: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

/**
  A delivery stop the office may send a tracking link for: in this tenant, on
  a job that is not cancelled, and not delivered more than a day ago. The
  contact columns come from the stop-contacts migration; when it is unapplied
  the select falls back to the columns that always exist.
*/
export async function loadTrackableStop(admin: SupabaseClient, tenantId: string, stopId: string): Promise<TrackableStop> {
  const base = "id,job_id,type,pod_status,delivered_at,planned_at";
  let result = await admin.from("job_stops").select(`${base},contact_name,contact_email,contact_phone`).eq("id", stopId).eq("tenant_id", tenantId).maybeSingle();
  if (result.error?.code === "42703") {
    result = await admin.from("job_stops").select(base).eq("id", stopId).eq("tenant_id", tenantId).maybeSingle();
  }
  if (result.error) throw new Error(result.error.message);
  const stop = result.data as Record<string, unknown> | null;
  if (!stop || stop.type !== "delivery") throw new TrackableStopError("Delivery stop not found.", 404);

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("id,status,reference,customer_id,planning_date,scheduled_date")
    .eq("id", String(stop.job_id))
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new TrackableStopError("Job not found.", 404);
  if (job.status === "cancelled") throw new TrackableStopError("This job is cancelled.", 409);
  if (stop.pod_status === "delivered") throw new TrackableStopError("This delivery is already complete.", 409);

  const plannedDate = (job.planning_date ?? job.scheduled_date ?? null) as string | null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  return {
    stopId,
    jobId: String(job.id),
    tenantId,
    plannedDate: plannedDate ? plannedDate.slice(0, 10) : null,
    customerId: job.customer_id ? String(job.customer_id) : null,
    reference: str(job.reference),
    contactName: str(stop.contact_name),
    contactEmail: str(stop.contact_email),
    contactPhone: str(stop.contact_phone),
  };
}

export async function issueTrackingLink(
  admin: SupabaseClient,
  input: { stop: TrackableStop; createdBy: string; sentToEmail?: string | null; now?: Date },
): Promise<{ token: string; tokenHash: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  const token = generateTrackingToken();
  const tokenHash = hashTrackingToken(token);
  const expiresAt = trackingLinkExpiry(input.stop.plannedDate, now);

  const { error } = await admin.from(TABLE).insert({
    tenant_id: input.stop.tenantId,
    job_id: input.stop.jobId,
    stop_id: input.stop.stopId,
    token_hash: tokenHash,
    created_by: input.createdBy,
    sent_to_email: input.sentToEmail ?? null,
    created_at: now.toISOString(),
    expires_at: expiresAt,
  });

  if (error) {
    if (isMissingTable(error)) throw new TrackingUnavailableError();
    console.error("[tracking] unable to store link", error.code);
    throw new Error("Unable to create the tracking link.");
  }

  return { token, tokenHash, expiresAt };
}

export type ResolvedTrackingLink = { linkId: string; tenantId: string; jobId: string; stopId: string };

/** Null for every refusal (malformed, unknown, revoked, expired, missing table) so callers cannot tell them apart. */
export async function resolveTrackingToken(admin: SupabaseClient, rawToken: string, now: Date = new Date()): Promise<ResolvedTrackingLink | null> {
  if (!isWellFormedTrackingToken(rawToken)) return null;

  const { data, error } = await admin
    .from(TABLE)
    .select("id,tenant_id,job_id,stop_id,expires_at,revoked_at")
    .eq("token_hash", hashTrackingToken(rawToken))
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) {
      console.warn("[tracking] stop_tracking_links is missing; refusing link. Apply tracking_01.");
      return null;
    }
    console.error("[tracking] link lookup failed", error.code);
    throw new Error("Unable to verify the tracking link.");
  }

  if (!data || !evaluateTrackingLink(data as { expires_at: string; revoked_at: string | null }, now)) return null;

  void admin
    .from(TABLE)
    .update({ last_viewed_at: now.toISOString() })
    .eq("id", data.id)
    .then(({ error: touchError }) => {
      if (touchError) console.warn("[tracking] unable to record view", touchError.code);
    });

  return { linkId: String(data.id), tenantId: String(data.tenant_id), jobId: String(data.job_id), stopId: String(data.stop_id) };
}

export async function revokeTrackingLinks(
  admin: SupabaseClient,
  input: { tenantId: string; stopId: string; revokedBy: string; now?: Date },
): Promise<number> {
  const now = (input.now ?? new Date()).toISOString();
  const { data, error } = await admin
    .from(TABLE)
    .update({ revoked_at: now, revoked_by: input.revokedBy })
    .eq("tenant_id", input.tenantId)
    .eq("stop_id", input.stopId)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    if (isMissingTable(error)) throw new TrackingUnavailableError();
    throw new Error(error.message);
  }
  return data?.length ?? 0;
}
```

Before writing, check the real column names on `jobs` for the planned date: the planning types use `planning_date` (see `lib/planning/types.ts` and `/tracking`, which places jobs on `planning_date` falling back to `scheduled_date`). If either column does not exist on `jobs`, drop it from the select.

- [ ] **Step 3: `lib/tracking/trackingServer.ts`**

```ts
/*
  Loads everything one public tracking view needs and returns the payload.
  Server-only (service role, called after the token resolved). All decisions
  are pure functions in eta.ts and publicPayload.ts; this file fetches, calls
  TomTom when shouldRefreshEta says so, and caches the answer in
  stop_eta_cache so a busy page costs at most one TomTom call per stop every
  two minutes.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPodBranding } from "../pod/brandingServer";
import { parseRoute, routeUrl } from "../tomtom/api";
import { etaWindow, roundToFiveMinutes, shouldRefreshEta, stopsBefore, trackingState, type EtaContext, type ItineraryStop } from "./eta";
import type { ResolvedTrackingLink } from "./linkStore";
import { POSITION_FRESH_MS, buildTrackingPayload, isTrackingEnded, type TrackingPayload } from "./publicPayload";

const COMPLETED = (row: { status?: unknown; pod_status?: unknown }) =>
  row.status === "completed" || row.pod_status === "delivered" || row.pod_status === "collected";

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Null when the link should read as ended (cancelled job, delivered over a day ago, stop gone). */
export async function loadTrackingView(admin: SupabaseClient, link: ResolvedTrackingLink, now: Date = new Date()): Promise<TrackingPayload | null> {
  const { tenantId, jobId, stopId } = link;

  const [jobResult, stopsResult] = await Promise.all([
    admin.from("jobs").select("id,status,vehicle_id,delivery_eta,planning_date,scheduled_date").eq("id", jobId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("job_stops").select("id,type,status,pod_status,delivered_at,lat,lng").eq("job_id", jobId).eq("tenant_id", tenantId),
  ]);
  if (jobResult.error) throw new Error(jobResult.error.message);
  if (stopsResult.error) throw new Error(stopsResult.error.message);
  const job = jobResult.data;
  const stops = stopsResult.data ?? [];
  const stop = stops.find((s) => s.id === stopId);
  if (!job || !stop) return null;
  if (isTrackingEnded({ jobStatus: job.status ?? null, deliveredAt: stop.delivered_at ?? null, now })) return null;

  const plannedDate = ((job.planning_date ?? job.scheduled_date ?? null) as string | null)?.slice(0, 10) ?? null;
  const deliveryStops = stops.filter((s) => s.type === "delivery");

  const itinerary = await loadItinerary(admin, tenantId, job.vehicle_id ? String(job.vehicle_id) : null, plannedDate);
  const baselines = itinerary ? await loadBaselines(admin, tenantId, [...new Set(itinerary.map((s) => s.jobId))]) : {};

  const ctx: EtaContext = {
    now,
    stop: { id: stopId, jobId, completed: COMPLETED(stop), deliveredAt: stop.delivered_at ?? null, plannedDate },
    job: {
      vehicleId: job.vehicle_id ? String(job.vehicle_id) : null,
      deliveryEta: job.delivery_eta ?? null,
      deliveryStopCount: deliveryStops.length,
      incompleteStopIds: stops.filter((s) => !COMPLETED(s)).map((s) => String(s.id)),
    },
    itinerary,
    baselines,
  };

  const state = trackingState(ctx);
  const destination = num(stop.lat) !== null && num(stop.lng) !== null ? { lat: num(stop.lat)!, lng: num(stop.lng)! } : null;

  let position: { lat: number; lng: number; at: string } | null = null;
  let etaLive: string | null = null;
  if (state === "next" && ctx.job.vehicleId) {
    position = await loadLatestPosition(admin, tenantId, ctx.job.vehicleId);
    if (position && destination && now.getTime() - Date.parse(position.at) <= POSITION_FRESH_MS) {
      etaLive = await liveEta(admin, { tenantId, stopId, position, destination, now });
    }
  }

  const branding = await loadPodBranding(admin, tenantId);

  return buildTrackingPayload({
    now,
    operatorName: branding.carrierName,
    state,
    etaWindow: etaWindow(ctx),
    etaLive,
    stopsBefore: stopsBefore(ctx),
    position,
    destination,
    deliveredAt: stop.delivered_at ?? null,
  });
}

async function loadItinerary(admin: SupabaseClient, tenantId: string, vehicleId: string | null, plannedDate: string | null): Promise<ItineraryStop[] | null> {
  if (!vehicleId || !plannedDate) return null;
  const { data: itinerary, error } = await admin
    .from("planning_route_itineraries")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .eq("planning_date", plannedDate)
    .maybeSingle();
  if (error || !itinerary) return null;

  const { data: visits, error: visitsError } = await admin
    .from("planning_route_visit_stops")
    .select("stop_id,job_id,service_sequence_number")
    .eq("tenant_id", tenantId)
    .eq("itinerary_id", itinerary.id)
    .order("service_sequence_number");
  if (visitsError || !visits || visits.length === 0) return null;

  const { data: stopRows, error: stopsError } = await admin
    .from("job_stops")
    .select("id,type,status,pod_status,delivered_at")
    .eq("tenant_id", tenantId)
    .in("id", visits.map((v) => v.stop_id));
  if (stopsError) return null;
  const byId = new Map((stopRows ?? []).map((s) => [String(s.id), s]));

  return visits.flatMap((v) => {
    const s = byId.get(String(v.stop_id));
    if (!s) return [];
    return [{ stopId: String(v.stop_id), jobId: String(v.job_id), type: String(s.type), completed: COMPLETED(s), deliveredAt: s.delivered_at ?? null }];
  });
}

/** delivery_eta for each job that has exactly one delivery stop; null otherwise. */
async function loadBaselines(admin: SupabaseClient, tenantId: string, jobIds: string[]): Promise<Record<string, string | null>> {
  if (jobIds.length === 0) return {};
  const [jobs, stops] = await Promise.all([
    admin.from("jobs").select("id,delivery_eta").eq("tenant_id", tenantId).in("id", jobIds),
    admin.from("job_stops").select("job_id").eq("tenant_id", tenantId).eq("type", "delivery").in("job_id", jobIds),
  ]);
  if (jobs.error || stops.error) return {};
  const counts = new Map<string, number>();
  for (const s of stops.data ?? []) counts.set(String(s.job_id), (counts.get(String(s.job_id)) ?? 0) + 1);
  const out: Record<string, string | null> = {};
  for (const j of jobs.data ?? []) out[String(j.id)] = counts.get(String(j.id)) === 1 ? (j.delivery_eta ?? null) : null;
  return out;
}

async function loadLatestPosition(admin: SupabaseClient, tenantId: string, vehicleId: string) {
  const { data, error } = await admin
    .from("telematics_positions")
    .select("latitude,longitude,recorded_at")
    .eq("tenant_id", tenantId)
    .eq("vehicle_id", vehicleId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const lat = num(data.latitude);
  const lng = num(data.longitude);
  if (lat === null || lng === null || !data.recorded_at) return null;
  return { lat, lng, at: String(data.recorded_at) };
}

async function liveEta(
  admin: SupabaseClient,
  input: { tenantId: string; stopId: string; position: { lat: number; lng: number; at: string }; destination: { lat: number; lng: number }; now: Date },
): Promise<string | null> {
  const { data: cache } = await admin.from("stop_eta_cache").select("eta,computed_at,from_position_at").eq("stop_id", input.stopId).maybeSingle();
  const cached = cache ? { computedAt: String(cache.computed_at), fromPositionAt: String(cache.from_position_at) } : null;
  if (cache && !shouldRefreshEta(cached, input.position.at, input.now)) return roundToFiveMinutes(String(cache.eta));

  const key = process.env.TOMTOM_API_KEY;
  if (!key) return cache ? roundToFiveMinutes(String(cache.eta)) : null;

  try {
    const response = await fetch(routeUrl([input.position, input.destination], key, { traffic: true }), { cache: "no-store" });
    if (!response.ok) throw new Error(`TomTom answered ${response.status}`);
    const route = parseRoute(await response.json());
    if (!route) throw new Error("TomTom route could not be parsed");
    const eta = new Date(input.now.getTime() + route.totalTravelTimeSeconds * 1000).toISOString();
    const { error } = await admin.from("stop_eta_cache").upsert({
      stop_id: input.stopId,
      tenant_id: input.tenantId,
      eta,
      computed_at: input.now.toISOString(),
      from_position_at: input.position.at,
    });
    if (error) console.warn("[tracking] unable to cache ETA", error.code);
    return roundToFiveMinutes(eta);
  } catch (error) {
    console.warn("[tracking] live ETA unavailable", error instanceof Error ? error.message : error);
    return cache ? roundToFiveMinutes(String(cache.eta)) : null;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS. Fix any column-name mismatch the types reveal by reading the real select strings used elsewhere for `jobs` and `job_stops`.

- [ ] **Step 5: Commit**

```bash
git add lib/tracking/linkStore.ts lib/tracking/trackingServer.ts lib/rateLimit.ts
git commit -m "feat(tracking): link store, view loader with cached live ETA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 19: Office routes

**Files:**
- Create: `app/api/tracking-links/route.ts`
- Create: `app/api/tracking-links/email/route.ts`
- Create: `app/api/tracking-links/revoke/route.ts`
- Modify: `lib/auth/routeClassification.test.ts` (PROTECTED_ROUTES)

- [ ] **Step 1: Classify the routes first (failing test)**

Add to `PROTECTED_ROUTES` in `lib/auth/routeClassification.test.ts`, next to the `/api/pod/share` entries:

```ts
  "/api/tracking-links",
  "/api/tracking-links/email",
  "/api/tracking-links/revoke",
```

Run: `npx vitest run lib/auth/routeClassification.test.ts`
Expected: FAIL (listed routes do not exist on disk yet).

- [ ] **Step 2: Shared request reading**

Each route reads `{ tenantId, stopId }` and authorizes exactly like `app/api/pod/share/route.ts`. Create `app/api/tracking-links/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { publicAppOrigin } from "../../../lib/accounts/appUrl";
import { createApiSupabase } from "../../../lib/api/server";
import { isUuid } from "../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../lib/jobs/officeAccess";
import { TrackableStopError, TrackingUnavailableError, issueTrackingLink, loadTrackableStop } from "../../../lib/tracking/linkStore";
import { createAdminClient } from "../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Mint a customer tracking link for one delivery stop. Office callers only:
  tenant access decided from profiles, drivers refused. The link is an opaque
  stored token (lib/tracking/linkStore.ts) revocable through
  /api/tracking-links/revoke. Built on publicAppOrigin(), never the request host.
*/
export async function POST(request: NextRequest) {
  try {
    let body: { tenantId?: unknown; stopId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    const stopId = typeof body.stopId === "string" ? body.stopId.trim() : "";
    if (!isUuid(tenantId) || !isUuid(stopId)) {
      return NextResponse.json({ error: "tenantId and stopId are required." }, { status: 400 });
    }

    const userClient = await createApiSupabase();
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const admin = createAdminClient();
    await authorizeOfficeTenant(admin, user.id, tenantId);

    const stop = await loadTrackableStop(admin, tenantId, stopId);
    const { token, expiresAt } = await issueTrackingLink(admin, { stop, createdBy: user.id });

    return NextResponse.json({
      ok: true,
      url: `${publicAppOrigin(request.url)}/track/${encodeURIComponent(token)}`,
      expiresAt,
      reference: stop.reference,
      contactName: stop.contactName,
      contactEmail: stop.contactEmail,
      contactPhone: stop.contactPhone,
    });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });
    if (error instanceof TrackableStopError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrackingUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("Unable to create tracking link:", error);
    return NextResponse.json({ error: "Unable to create tracking link." }, { status: 500 });
  }
}
```

Note `publicAppOrigin(request.url)` is the same call the POD share route makes; `lib/accounts/publicLinks.test.ts` only forbids building an origin from the request host directly.

- [ ] **Step 3: `app/api/tracking-links/email/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { publicAppOrigin } from "../../../../lib/accounts/appUrl";
import { createApiSupabase } from "../../../../lib/api/server";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { sendLoggedDocumentEmail } from "../../../../lib/documents/delivery";
import { buildDocumentEmailHtml } from "../../../../lib/documents/emailTemplate";
import { trackingShareReference } from "../../../../lib/documents/shareReference";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../../lib/jobs/officeAccess";
import { loadPodBranding } from "../../../../lib/pod/brandingServer";
import { checkPodRecipient } from "../../../../lib/pod/emailRecipients";
import { RATE_LIMITS, checkRateLimit } from "../../../../lib/rateLimit";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { TrackableStopError, TrackingUnavailableError, issueTrackingLink, loadTrackableStop } from "../../../../lib/tracking/linkStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Email a tracking link. Same guards as POD email: office callers only,
  recipient limited to the stop's delivery contact, an address stored on the
  job's customer, or the caller's own address; rate limited per user and per
  tenant; branded with the tenant's own name. The delivery log stores an
  opaque reference to the link row, never the URL.
*/
export async function POST(request: NextRequest) {
  try {
    let body: { tenantId?: unknown; stopId?: unknown; to?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    const stopId = typeof body.stopId === "string" ? body.stopId.trim() : "";
    if (!isUuid(tenantId) || !isUuid(stopId)) {
      return NextResponse.json({ error: "tenantId and stopId are required." }, { status: 400 });
    }

    const userClient = await createApiSupabase();
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const admin = createAdminClient();
    await authorizeOfficeTenant(admin, user.id, tenantId);

    const stop = await loadTrackableStop(admin, tenantId, stopId);

    let customer: { email: string | null; operations_email: string | null; accounts_email: string | null } | null = null;
    if (stop.customerId) {
      const { data, error } = await admin
        .from("customers")
        .select("email,operations_email,accounts_email")
        .eq("id", stop.customerId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      customer = data;
    }

    const recipientCheck = checkPodRecipient({
      requested: body.to,
      customerEmailFields: [stop.contactEmail, customer?.email, customer?.operations_email, customer?.accounts_email],
      callerEmail: user.email,
    });
    if (!recipientCheck.ok) return NextResponse.json({ error: recipientCheck.message }, { status: recipientCheck.status });

    const [perUser, perTenant] = await Promise.all([
      checkRateLimit(admin, RATE_LIMITS.documentEmailPerUser, user.id),
      checkRateLimit(admin, RATE_LIMITS.documentEmailPerTenant, tenantId),
    ]);
    if (!perUser.allowed || !perTenant.allowed) {
      return NextResponse.json({ error: "Too many document emails have been sent recently. Try again later." }, { status: 429 });
    }

    const recipient = recipientCheck.recipient;
    const { token, tokenHash } = await issueTrackingLink(admin, { stop, createdBy: user.id, sentToEmail: recipient });
    const url = `${publicAppOrigin(request.url)}/track/${encodeURIComponent(token)}`;

    const branding = await loadPodBranding(admin, tenantId);
    const carrierName = branding.carrierName;
    const contactName = stop.contactName ?? "Customer";
    const subject = `Track your delivery from ${carrierName}`.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 180);

    const text = [
      `Hi ${contactName},`,
      "",
      `${carrierName} is delivering to you. You can follow your delivery here:`,
      "",
      url,
      "",
      "The page shows an estimated arrival time, and a live map once the driver is on the way to you.",
      "",
      "Regards,",
      carrierName,
    ].join("\n");

    const html = buildDocumentEmailHtml({
      companyName: carrierName,
      recipientName: contactName,
      title: "Track your delivery",
      intro: `${carrierName} is delivering to you. Follow it with the link below.`,
      summaryRows: [],
      attachmentText: "",
      actionLabel: "Track delivery",
      actionUrl: url,
      footerText: branding.footerText ?? `Thank you for choosing ${carrierName}.`,
    });

    const delivery = await sendLoggedDocumentEmail({
      admin,
      tenantId,
      documentType: "tracking_link",
      documentId: stop.stopId,
      recipient,
      subject,
      text,
      html,
      shareReference: trackingShareReference(tokenHash),
      initiatedBy: user.id,
      metadata: { jobId: stop.jobId, stopId: stop.stopId },
    });

    return NextResponse.json({ ok: true, recipient, deliveryLogId: delivery.deliveryLogId });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });
    if (error instanceof TrackableStopError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrackingUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("Unable to email tracking link:", error);
    return NextResponse.json({ error: "Unable to email tracking link." }, { status: 500 });
  }
}
```

Before writing, read `buildDocumentEmailHtml`'s parameter type in `lib/documents/emailTemplate.ts`: if `summaryRows` or `attachmentText` cannot be empty, or if a field is optional, pass what it accepts (omit `attachmentText` if optional). Also check that `checkPodRecipient` tolerates `null` entries in `customerEmailFields` (the POD route passes possibly-undefined values, so it should).

- [ ] **Step 4: `app/api/tracking-links/revoke/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../../lib/api/server";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../../lib/jobs/officeAccess";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { TrackingUnavailableError, revokeTrackingLinks } from "../../../../lib/tracking/linkStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Withdraw every live tracking link for one stop. */
export async function POST(request: NextRequest) {
  try {
    let body: { tenantId?: unknown; stopId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    const stopId = typeof body.stopId === "string" ? body.stopId.trim() : "";
    if (!isUuid(tenantId) || !isUuid(stopId)) {
      return NextResponse.json({ error: "tenantId and stopId are required." }, { status: 400 });
    }

    const userClient = await createApiSupabase();
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const admin = createAdminClient();
    await authorizeOfficeTenant(admin, user.id, tenantId);

    const revoked = await revokeTrackingLinks(admin, { tenantId, stopId, revokedBy: user.id });
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });
    if (error instanceof TrackingUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("Unable to revoke tracking links:", error);
    return NextResponse.json({ error: "Unable to revoke tracking links." }, { status: 500 });
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS, including `routeClassification` and `publicLinks`.

- [ ] **Step 6: Commit**

```bash
git add app/api/tracking-links lib/auth/routeClassification.test.ts
git commit -m "feat(tracking): office routes to mint, email and revoke tracking links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 20: Public route and page

**Files:**
- Modify: `lib/auth/publicRoutes.ts`, `lib/auth/publicRoutes.test.ts`, `lib/auth/routeClassification.test.ts`
- Create: `app/api/public/track/[token]/route.ts`
- Create: `app/track/[token]/page.tsx`, `app/track/[token]/TrackingView.tsx`, `app/track/[token]/TrackMap.tsx`

- [ ] **Step 1: Failing tests**

In `lib/auth/publicRoutes.test.ts`, add `"/track/abc123"` and `"/api/public/track/abc123"` to the list of paths expected public, and `"/track"`, `"/track/abc/extra"`, `"/api/public/track"`, `"/api/public/track/abc/extra"`, `"/api/tracking-links"`, `"/api/tracking-links/email"` to the list expected NOT public (follow the file's existing `it.each` lists).

In `lib/auth/routeClassification.test.ts`, add `"/track/[token]"` and `"/api/public/track/[token]"` to `PUBLIC_ROUTES`.

Run: `npx vitest run lib/auth`
Expected: FAIL.

- [ ] **Step 2: Allowlist** in `lib/auth/publicRoutes.ts` `PUBLIC_PATTERNS`, after the quotation entries:

```ts
  /* Customer tracking links. Tokens are random, stored hashed in
     stop_tracking_links and re-checked on every poll (lib/tracking/links.ts).
     Only the page and its one JSON route are public; /api/tracking-links
     (mint, email, revoke) is staff-only and deliberately not matched here. */
  /^\/track\/[^/]+$/,
  /^\/api\/public\/track\/[^/]+$/,
```

- [ ] **Step 3: Public JSON route `app/api/public/track/[token]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { RATE_LIMITS, checkRateLimit, clientIp } from "../../../../../lib/rateLimit";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { resolveTrackingToken } from "../../../../../lib/tracking/linkStore";
import { loadTrackingView } from "../../../../../lib/tracking/trackingServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Public, token-gated tracking data, polled by /track/[token] every 60 seconds.
  Rate limited per IP. Unknown, malformed, expired, revoked and ended links all
  get the same answer. The payload comes only from buildTrackingPayload.
*/
const ENDED = "This tracking link has ended.";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const admin = createAdminClient();

  const limit = await checkRateLimit(admin, RATE_LIMITS.trackingViewPerIp, clientIp(request.headers));
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });
  }

  const { token } = await context.params;
  let rawToken: string;
  try {
    rawToken = decodeURIComponent(token);
  } catch {
    return NextResponse.json({ error: ENDED }, { status: 404 });
  }

  try {
    const link = await resolveTrackingToken(admin, rawToken);
    if (!link) return NextResponse.json({ error: ENDED }, { status: 404 });

    const payload = await loadTrackingView(admin, link);
    if (!payload) return NextResponse.json({ error: ENDED }, { status: 404 });

    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[tracking] public view failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Tracking is unavailable right now. Try again shortly." }, { status: 500 });
  }
}
```

- [ ] **Step 4: Page shell `app/track/[token]/page.tsx`**

```tsx
import type { Metadata } from "next";
import TrackingView from "./TrackingView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track your delivery",
  robots: { index: false, follow: false },
};

/*
  Public tracking page. Fixed light palette and no console shell, like
  /pod/share/[token]: a delivery recipient sees a neutral page, not the
  operator's theme. Deliberately absent from lib/nav/themeableRoutes.ts.
*/
export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 [color-scheme:light]">
      <div className="mx-auto max-w-xl">
        <TrackingView token={token} />
      </div>
    </main>
  );
}
```

Check how `app/pod/share/[token]/page.tsx` avoids the console shell (the app layout decides via `shouldShowShell` in `lib/legal/routes.ts` or a similar helper). Find where `/pod/share` is listed as shell-less (search for `"/pod/share"` under `app/` and `lib/nav`) and add `/track/` to the same list in the same way. If a test asserts that list, update it.

- [ ] **Step 5: Client view `app/track/[token]/TrackingView.tsx`**

```tsx
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { TrackingPayload } from "../../../lib/tracking/publicPayload";

const TrackMap = dynamic(() => import("./TrackMap"), { ssr: false });

const POLL_MS = 60_000;
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const t = (iso: string) => timeFmt.format(new Date(iso));

type Loaded = { kind: "ok"; data: TrackingPayload } | { kind: "ended"; message: string } | { kind: "error"; message: string } | { kind: "loading" };

export default function TrackingView({ token }: { token: string }) {
  const [state, setState] = useState<Loaded>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/public/track/${encodeURIComponent(token)}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (response.status === 404) setState({ kind: "ended", message: body.error ?? "This tracking link has ended." });
      else if (!response.ok) setState((s) => (s.kind === "ok" ? s : { kind: "error", message: body.error ?? "Tracking is unavailable right now." }));
      else setState({ kind: "ok", data: body as TrackingPayload });
    } catch {
      setState((s) => (s.kind === "ok" ? s : { kind: "error", message: "No connection. Retrying." }));
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (state.kind === "loading") return <Card>Loading your delivery...</Card>;
  if (state.kind === "ended" || state.kind === "error") return <Card>{state.message}</Card>;

  const d = state.data;
  return (
    <div className="grid gap-4">
      <Card>
        <div className="text-xs font-black uppercase tracking-wider text-blue-700">{d.operator.name}</div>
        <h1 className="mt-1 text-2xl font-black">{headline(d)}</h1>
        <p className="mt-2 text-slate-700">{detail(d)}</p>
      </Card>
      {d.state === "next" && d.destination ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <TrackMap position={d.position} destination={d.destination} />
          {!d.position ? <p className="p-3 text-sm text-slate-600">Location updating.</p> : null}
        </div>
      ) : null}
      <p className="text-center text-xs text-slate-500">Updates every minute. Times are UK time.</p>
    </div>
  );
}

function headline(d: TrackingPayload): string {
  if (d.state === "delivered") return d.deliveredAt ? `Delivered at ${t(d.deliveredAt)}` : "Delivered";
  if (d.state === "next") return d.etaLive ? `Arriving around ${t(d.etaLive)}` : "Your delivery is next";
  if (d.state === "scheduled") return "Your delivery is scheduled";
  return "Out for delivery";
}

function detail(d: TrackingPayload): string {
  if (d.state === "delivered") return "Thank you.";
  const window = d.etaWindow ? `Expected between ${t(d.etaWindow.from)} and ${t(d.etaWindow.to)}.` : "";
  if (d.state === "next") return d.etaLive ? "The driver is on the way to you." : window || "The driver is on the way to you.";
  if (d.state === "scheduled") return d.etaWindow ? `${dayFmt.format(new Date(d.etaWindow.from))}. ${window}` : "We will update this page on the day.";
  const before = d.stopsBefore !== null && d.stopsBefore > 0 ? ` ${d.stopsBefore} deliver${d.stopsBefore === 1 ? "y" : "ies"} before yours.` : "";
  return (window || "Out for delivery today.") + before;
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</section>;
}
```

- [ ] **Step 6: Map `app/track/[token]/TrackMap.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import "@tomtom-international/web-sdk-maps/dist/maps.css";

type LatLng = { lat: number; lng: number };
const MAP_KEY = process.env.NEXT_PUBLIC_TOMTOM_MAP_KEY;

/* Van and destination only. Never draws any other stop. */
export default function TrackMap({ position, destination }: { position: (LatLng & { at: string }) | null; destination: LatLng }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handle = useRef<{ tt: any; map: any; van: any | null } | null>(null);

  useEffect(() => {
    if (!MAP_KEY || !containerRef.current || handle.current) return;
    let cancelled = false;
    void (async () => {
      const tt = (await import("@tomtom-international/web-sdk-maps")).default;
      if (cancelled || !containerRef.current) return;
      const map = tt.map({ key: MAP_KEY, container: containerRef.current, center: [destination.lng, destination.lat], zoom: 11 });
      new tt.Marker({ color: "#047857" }).setLngLat([destination.lng, destination.lat]).addTo(map);
      handle.current = { tt, map, van: null };
    })();
    return () => {
      cancelled = true;
      handle.current?.map.remove();
      handle.current = null;
    };
  }, [destination.lat, destination.lng]);

  useEffect(() => {
    const h = handle.current;
    if (!h) return;
    h.van?.remove();
    h.van = null;
    if (!position) return;
    h.van = new h.tt.Marker({ color: "#1d4ed8" }).setLngLat([position.lng, position.lat]).addTo(h.map);
    const bounds = new h.tt.LngLatBounds();
    bounds.extend([position.lng, position.lat]);
    bounds.extend([destination.lng, destination.lat]);
    h.map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
  }, [position, destination.lat, destination.lng]);

  if (!MAP_KEY) return null;
  return <div ref={containerRef} className="h-72 w-full" aria-label="Map showing the delivery vehicle and your address" />;
}
```

The van marker effect can run before the map finishes loading (first poll). That is acceptable: the next poll (60 s) draws it. If you want it immediate, call the same marker code at the end of the first effect when `position` is set; keep it simple.

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/auth "app/api/public/track" "app/track"
git commit -m "feat(tracking): public tracking page and token-gated JSON route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 21: Office dialog and button

**Files:**
- Create: `app/jobs/SendTrackingLinkDialog.tsx`
- Modify: `app/jobs/StopCard.tsx`

- [ ] **Step 1: The dialog**

```tsx
"use client";

import { useEffect, useState } from "react";
import Modal from "../../components/Modal";
import Button from "../../components/Button";

type Props = {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  stopId: string;
};

type Minted = { url: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null };

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

function whatsappUrl(phone: string, link: string): string {
  const digits = phone.replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^0/, "44");
  const text = `Track your delivery: ${link}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/*
  Send a customer tracking link for one delivery stop: email (sent by the
  server, recipient restricted like POD email), WhatsApp (opens a prefilled
  message on this device), copy, or revoke every live link for the stop.
*/
export default function SendTrackingLinkDialog({ open, onClose, tenantId, stopId }: Props) {
  const [minted, setMinted] = useState<Minted | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setMinted(null);
    setMessage("");
    setError("");
    void (async () => {
      const { ok, data } = await postJson("/api/tracking-links", { tenantId, stopId });
      if (!ok) {
        setError(String(data.error ?? "Unable to create a tracking link."));
        return;
      }
      const m = data as unknown as Minted;
      setMinted(m);
      setEmail(m.contactEmail ?? "");
      setPhone(m.contactPhone ?? "");
    })();
  }, [open, tenantId, stopId]);

  async function sendEmail() {
    setBusy(true);
    setError("");
    setMessage("");
    const { ok, data } = await postJson("/api/tracking-links/email", { tenantId, stopId, to: email });
    setBusy(false);
    if (ok) setMessage(`Tracking link emailed to ${String(data.recipient ?? email)}.`);
    else setError(String(data.error ?? "Unable to email the tracking link."));
  }

  async function copy() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.url);
      setMessage("Link copied.");
    } catch {
      setError("Copy failed. Select the link and copy it by hand.");
    }
  }

  async function revoke() {
    setBusy(true);
    setError("");
    const { ok, data } = await postJson("/api/tracking-links/revoke", { tenantId, stopId });
    setBusy(false);
    if (ok) {
      setMinted(null);
      setMessage(`Withdrew ${String(data.revoked ?? 0)} link(s). Open this dialog again to make a new one.`);
    } else setError(String(data.error ?? "Unable to withdraw the links."));
  }

  return (
    <Modal open={open} onClose={onClose} title="Send tracking link">
      <div className="grid gap-4 text-sm">
        <p className="text-ink-2">
          The customer sees an estimated arrival time, and a live map only once this delivery is next. They never see the driver,
          the vehicle or other stops.
        </p>

        {minted ? (
          <>
            <input readOnly value={minted.url} className="w-full rounded border border-line bg-surface px-2 py-1.5 font-mono text-xs text-ink" aria-label="Tracking link" />

            <label className="grid gap-1">
              <span className="text-ink-2">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border border-line bg-surface px-2 py-1.5 text-ink" />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void sendEmail()} disabled={busy || !email.trim()}>Email link</Button>
              <Button variant="secondary" onClick={() => void copy()}>Copy link</Button>
            </div>

            <label className="grid gap-1">
              <span className="text-ink-2">Mobile for WhatsApp</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded border border-line bg-surface px-2 py-1.5 text-ink" />
            </label>
            <div>
              <a
                className={`inline-flex rounded border border-line px-3 py-1.5 text-ink ${phone.trim() ? "" : "pointer-events-none opacity-50"}`}
                href={phone.trim() ? whatsappUrl(phone, minted.url) : undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open WhatsApp
              </a>
            </div>

            <div className="border-t border-line pt-3">
              <Button variant="secondary" onClick={() => void revoke()} disabled={busy}>Withdraw all links for this stop</Button>
            </div>
          </>
        ) : !error ? (
          <p className="text-ink-2">Creating link...</p>
        ) : null}

        {message ? <p className="text-success">{message}</p> : null}
        {error ? <p className="text-danger">{error}</p> : null}
      </div>
    </Modal>
  );
}
```

Before writing, read `components/Button.tsx` for the real variant names and `app/tokens.css` / existing pages for the text colour token names (`text-ink-2`, `text-success`, `text-danger`, `bg-surface`, `border-line`). Use the names that exist; avoid `text-ink-3` (recorded light-mode contrast failure). Read `components/Modal.tsx` props: if it needs `size` or another required prop, pass it.

- [ ] **Step 2: Button in `app/jobs/StopCard.tsx`**

Import the dialog and add `const [trackingOpen, setTrackingOpen] = useState(false);`. In the stop header actions (near the existing POD controls), for `stop.type === "delivery" && stop.pod_status !== "delivered"`:

```tsx
<Button variant="secondary" onClick={() => setTrackingOpen(true)}>Send tracking link</Button>
<SendTrackingLinkDialog open={trackingOpen} onClose={() => setTrackingOpen(false)} tenantId={tenantId} stopId={stop.id} />
```

`tenantId` is already a `StopCard` prop (the stop's own tenant, which is what the route must receive). Match the button style of the neighbouring controls in that file rather than introducing a new one if they are not `Button` components.

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/jobs/SendTrackingLinkDialog.tsx app/jobs/StopCard.tsx
git commit -m "feat(jobs): send a customer tracking link from a delivery stop

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 22: Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README**

- Page inventory, Driver portal: update `/driver/jobs/[jobId]` to say POD saves (photos, scans, completion) go through the offline queue, the stop shows "Delivered, waiting to send", the phone's time is used when trusted (`pod_time_untrusted` otherwise), and that opening the app with no signal is still not supported (no service worker).
- Page inventory, Driver and partner portals: add `/track/[token]` [OK, pending SQL]: public tracking page, fixed light palette, ETA window, live map only when next, never driver or vehicle; `tracking_01` unapplied.
- Page inventory, `/jobs`: mention "Send tracking link" per delivery stop and the "Time not trusted" tag.
- Integrations, TomTom: live ETA for tracking links, traffic-aware, cached 2 minutes per stop in `stop_eta_cache`.
- Roadmap, Competitive gaps: remove "customer ETA and live-tracking links" and "an offline queue for driver POD saves" from the candidates list and record them as built 2026-10-07 with SQL `tracking_01`/`tracking_02` unapplied.

- [ ] **Step 2: CLAUDE.md**

- In "Deliberately NOT tokenised", add `/track/[token]` to the list of customer/driver-facing pages with a fixed light palette.
- In the tenancy section after the POD paragraph, add one paragraph: tracking links are random `trk_` tokens stored hashed in `stop_tracking_links` (server-only, like `pod_share_links`), minted by `app/api/tracking-links/**` after `authorizeOfficeTenant`; the public payload is built only by `buildTrackingPayload` in `lib/tracking/publicPayload.ts`, which never includes driver, vehicle, reference or other stops, and shows position only while the stop is next and the fix is under 10 minutes old.
- In the walkaround paragraph, add: offline POD items carry `shiftClientId` and `recordedAt`; the stop and POD routes judge the gate at the recorded time when it is trusted (`queuedJobGate`, `lib/pod/recordedTime.ts`), and VOR is not re-checked for a closed vehicle period because `vehicles.vor` has no history.
- In the directory map `docs/sql/` entry, add `tracking_01..02 (tracking links, ETA cache, pod_flags, 2026-10-07; not applied)`.

No em-dashes anywhere.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: offline POD saves and customer tracking links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 23: Final verification

- [ ] **Step 1:** `npm test` (expect all pass) and `npm run typecheck` (expect clean). Paste the summary lines into the handoff.
- [ ] **Step 2:** `npm run build` (expect success; it catches server/client import mistakes typecheck misses, such as `node:crypto` reaching a client bundle through `lib/tracking/links.ts`).
- [ ] **Step 3:** `git grep -n "—" -- $(git diff --name-only main...HEAD)` returns nothing.
- [ ] **Step 4:** Write `docs/handoffs/2026-10-07-offline-pod-tracking-links.md`: what was built, SQL to apply (`tracking_01`, `tracking_02`, and the `document_delivery_log` constraint check), dependencies (`shifts_01..05` after S-1; stop contacts migration), manual checks never run (signed-in phone pass offline and back online; a real TomTom live ETA; a real tracking email; the public page on a phone), and the follow-ups recorded in the spec.
