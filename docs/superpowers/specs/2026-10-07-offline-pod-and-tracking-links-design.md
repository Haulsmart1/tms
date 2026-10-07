# Offline POD saves and customer tracking links

Date: 2026-10-07. Branch: `ethan/offline-pod-tracking-links`.

Two features from the README's competitive-gap list, designed together because they share the driver app
and the share-link pattern:

1. **Offline POD saves.** A driver with no signal can complete a delivery (photos, recipient, notes, barcode
   scans) and carry on; the save is sent when signal returns.
2. **Customer tracking links.** The office sends the delivery contact a link (email or WhatsApp) to a public
   page showing an ETA, and a live map once the van is heading to that stop.

## Decisions taken

| Question | Decision |
|---|---|
| How far does offline go? | Queue only. No service worker: the job page must have been opened with signal. Queued items survive a killed tab in IndexedDB and send the next time a `/driver` page opens with signal. |
| Channel for tracking links | Email (Microsoft Graph, existing sender) and WhatsApp (`wa.me` click-to-send, existing pattern). No SMS vendor, so no sub-processor change. |
| Trigger | Office sends manually, per delivery stop. No automatic sending. |
| What the public page shows | ETA always; map only when this stop is next; position hidden when older than 10 minutes. Never the driver's name, the registration or other stops. |
| ETA method | Planned ETA shifted by observed lateness; once this stop is next, a live TomTom route from the van's latest position, cached about 2 minutes per stop. |

## Part 1: Offline POD saves

### Today

`app/driver/jobs/[jobId]/page.tsx` uploads each photo the moment it is taken (`uploadEvidenceViaSignedUrl`:
upload-url route, direct storage upload, evidence record route) and "Complete delivery" posts to
`.../stops/[stopId]/complete`. Barcode scans post to `.../scans`. Every step needs signal. `complete` is
already idempotent (a delivered stop is never overwritten); the evidence record route is not (a retry after a
lost answer inserts a second row).

The offline queue already exists for shift events: `lib/offline/queue.ts` (pure, strictly ordered, backoff,
5xx set-aside), `lib/offline/driverSync.ts` (outcome rules, per-driver ownership), `lib/offline/idbStore.ts`
(IndexedDB with memory fallback) and the runner `app/driver/driverQueue.ts`.

### Change

- **One queue.** POD items join the same queue as shift events, as three new `DriverQueuePayload` kinds:
  - `pod_photo`: `{ ownerId, clientId, jobId, stopId, shiftClientId, recordedAt, blob, mimeType, filename }`
  - `pod_scan`: `{ ownerId, clientId, jobId, stopId, jobItemId, serialNumber, scanFormat }` (no shift or time:
    the scans route has no gate and records its own time)
  - `pod_complete`: `{ ownerId, clientId, jobId, stopId, shiftClientId, recordedAt, recipientName, podNotes }`

  Sharing the queue keeps strict order across kinds: a shift's start check always reaches the server before a
  POD that depends on it, and a stop's photos and scans always reach it before the stop's completion.
- **The page enqueues instead of sending.** Taking a photo, scanning an item and tapping Complete each write a
  queue item with a fresh phone-generated `clientId` (UUID) and `recordedAt` (phone clock, ISO). The stop
  shows "Delivered, waiting to send" immediately, from a local projection of pending items, the same way the
  shift panel projects pending events. Client-side completion validation (recipient name, at least one photo,
  all serials scanned) runs against queued plus already-sent items before enqueueing, so the driver is told at
  the doorstep, not hours later.
- **`shiftClientId`** is the client id of the start check of the shift that was open on the phone when the
  item was queued (the existing rule: every event in a shift is named by it). Subcontractor drivers, who are
  not gated, send `null`.
- **Sending a photo** is the existing three steps, made repeatable without a schema change. When the
  upload-url request carries a `clientId`, the server derives the storage path from it
  (`<tenant>/<job>/<stop>/photos/q-<clientId>-<filename>`, still inside the `isPodEvidencePathFor` rule).
  The upload is signed WITHOUT upsert, so an object can never be replaced once the record route has checked
  it (an upsert token would let a recorded POD photo be swapped for unchecked bytes, even after delivery).
  A retry after a lost answer finds the object already there: the upload-url route answers `token: null`
  when a `pod_evidence` row already holds that path or storage reports the object exists, and the queue
  runner treats a storage "already exists" answer the same way. Either way it goes straight to the record
  route, which verifies whatever object is stored, and `recordEvidenceRow` is idempotent on
  `storage_path`. No duplicate photo, no orphaned object, no overwrite. A `clientId` that is present but
  not a UUID is refused with 400 rather than silently falling back to a random path.
- **Scans** need nothing new: the scans route already answers 200 `duplicate: true` for a serial already
  verified on the job. **Complete** is already idempotent.

### Server rules for a queued item

Applied by the upload-url, evidence record and complete routes whenever the body carries any of
`clientId`, `shiftClientId` or `recordedAt` (`parseQueuedMeta`); a body with none of them (an older page
still open) behaves exactly as today. A `clientId` that is present but not a UUID answers 400. The scans
route is unchanged (scans are idempotent and that route has no walkaround gate today). A queued photo
already recorded at its derived path short-circuits before the gate, so a retry of a saved photo is never
refused because the shift has since closed.

- **Recorded time acceptance** (`lib/pod/recordedTime.ts`, pure). `recordedAt` is accepted when it parses,
  carries an explicit offset, is not more than 2 minutes in the future of server time, is not older than
  72 hours, is not earlier than the job's `created_at` (for every driver, subcontractors included), and
  (for a gated driver) falls inside the named shift: at or after `started_at`, and at or before `ended_at` when the shift
  has ended. Otherwise the server uses its own receive time and the stop gets the `pod_time_untrusted` flag.
  The accepted time is what lands in `delivered_at` and `pod_updated_at`.
- **Walkaround gate judged at the recorded time** (`jobGateDecisionAt` in `lib/walkaround/jobGate.ts`, pure,
  loaded by `queuedJobGate` in `lib/walkaround/server.ts`). For a direct driver: load the shift by
  `shiftClientId` (this driver, this tenant); if it does not exist, fall back to today's open-shift rule at
  server time with the time untrusted (a phone whose shift record never synced is still gated); find the `shift_vehicle_periods`
  row whose `[started_at, ended_at)` contains the accepted time; refuse with the existing messages if there
  is none or its check is not `pass`/`minor`. VOR: when that period is still open, the vehicle's current
  `vor` applies (as today); when it has closed, VOR is not re-checked, because `vehicles.vor` has no history.
  This is a known limit, recorded here and in the code. If the accepted time is the server receive time
  (untrusted clock), the gate falls back to today's open-shift rule.
  Still fails closed: a lookup error refuses.
- **Everything else unchanged**: job must be workable, a delivered stop is not overwritten, serials must be
  scanned before the final delivery, the evidence must be at this job's and stop's path.

### Stop flag

`job_stops.pod_flags text[] not null default '{}'` (new column). Only `pod_time_untrusted` is written in this
change: a queued completion sets the column to `['pod_time_untrusted']` when the time was not trusted and
`[]` when it was. When the column is missing (PostgREST answers PGRST204, Postgres 42703) the update is
retried without it. `/jobs` shows a small "Time not trusted" tag on a stop carrying it, once `pod_flags` is added to the
`/jobs` stop select; that select lists columns explicitly, so the column is added only after
`tracking_02` is applied (a comment in `app/jobs/page.tsx` marks the spot).

### Driver-facing failure handling

- Refusals use the existing behaviour: the item is removed from the queue and listed under "Not sent, tell
  the office" with the server's message. Photos and scans queued for a stop whose completion was refused stay
  as they are (they were sent first, so they are already saved or already refused).
- A photo or scan refused because the stop is already delivered (the office completed it) is set aside with
  the server's message, like any refusal.
- A refused photo does not hold back its stop's queued completion. Most refusal reasons also refuse the
  completion on the server, and the server's evidence-count check means a stop can never complete with no
  evidence. Dropping the completion would lose a real delivery's recipient and time. The job page lists
  the refused photo against its stop so the office can follow up.
- A gate lookup failure (database blip, shift tables missing) answers 503, not 409: the queue retries it
  with backoff and sets it aside only after repeated server failures, so a blip never deletes a queued POD.
  Genuine gate refusals stay 409 and are final.
- A storage upload error is read by its HTTP status: no status (network) or 408/425/429/5xx retry; any
  other 4xx (too large, unsupported type) is a final refusal with a message to tell the office. A
  permanent storage error can therefore never block the queue.
- The driver dashboard's existing queue panel (`ShiftPanel`) already counts every pending item and lists
  refusals, so POD items appear there with no change. The job page shows its own per-stop state and any
  refusal for its stops.
- IndexedDB refused: memory fallback (existing) plus a banner "Keep this page open until it sends".
- Shared phone: existing ownership rule, unchanged.

### Out of scope

Opening the app with no signal (service worker / PWA). Offline collection-stop PODs (the driver app only
completes delivery stops today). Offline for console users.

## Part 2: Customer tracking links

### Data

Migration `docs/sql/tracking_01_links_and_eta_cache.sql`:

- `stop_tracking_links`: `id`, `tenant_id`, `job_id`, `stop_id` (FK `job_stops`, cascade), `token_hash`
  (SHA-256 hex, format check), `created_by`, `sent_to_email`, `created_at`, `expires_at`, `revoked_at`,
  `revoked_by`, `last_viewed_at`. Same shape and access model as `pod_share_links`: RLS on, no policies,
  every client grant revoked; read and written only by server routes on the service role.
- `stop_eta_cache`: `stop_id` (PK, FK cascade), `tenant_id`, `eta` timestamptz, `computed_at`,
  `from_position_at`. Same access model.

Migration `docs/sql/tracking_02_pod_flags.sql`:

- `job_stops.pod_flags text[] not null default '{}'`. (No `client_id` columns: photo retries are made
  idempotent by the derived storage path, and scans already are.)

Both added to `docs/sql/prodfix_00_APPLY_ORDER.md`. Both are additive: the app degrades without them (link
creation answers "Tracking links are unavailable"; when `pod_flags` is missing, the complete route retries
the update without the flag and logs a warning, so a missing column never blocks a delivery).

### Token and lifetime

`lib/tracking/links.ts`, pure apart from `node:crypto`, mirroring `lib/pod/shareLinks.ts`: `trk_` + 32 random
bytes base64url, format regex, SHA-256 hash. `expires_at` at creation is UTC midnight at the end of the stop's
planned date plus 2 days (at most an hour longer than London midnight in summer), never less than 24
hours from now, or 7 days from creation when there is no planned date. Separately, the public
route treats a link as ended when the stop was delivered more than 24 hours ago or the job is cancelled.

### Office side

- Routes, shaped exactly like the POD share routes: body carries `{ tenantId, stopId }`, the caller is
  authorized with `authorizeOfficeTenant` (profiles-based, drivers refused), every query filters by that
  tenant, and the stop must be a delivery stop of a job in that tenant that is not cancelled.
  - `POST /api/tracking-links`: mints a link, returns `{ url, expiresAt, contactName, contactEmail,
    contactPhone }`. The URL is built with `publicAppOrigin()`.
  - `POST /api/tracking-links/email` `{ tenantId, stopId, to }`: mints a link and emails it via Microsoft
    Graph (`sendLoggedDocumentEmail`). Recipient restricted like POD email: the stop's `contact_email`, an
    address stored on the job's customer, or the caller's own address (`checkPodRecipient`, with the stop
    contact added to the allowed list). Rate limited per user and per tenant with the existing
    `documentEmailPerUser` / `documentEmailPerTenant` rules. Logged with document type `tracking_link` and
    share reference `tracking_share:<token hash>`; `assertOpaqueShareReference` learns to refuse `trk_`
    tokens and `/track/` URLs.
  - `POST /api/tracking-links/revoke`: revokes every live link for the stop.
- `SendTrackingLinkDialog`, opened from a "Send tracking link" button on each delivery stop in `/jobs`
  (`app/jobs/StopCard.tsx`) that is not yet delivered. Prefilled from `contact_email` / `contact_phone`
  (empty when the stop-contacts migration is unapplied). Actions: Email, WhatsApp (opens
  `wa.me/<digits>?text=...`), Copy link, Revoke all. Design-system styled. Not added to the planning job
  dialog in this change: that dialog is itself a Modal, and nesting a second one is the focus-trap problem
  recorded for that dialog; its "Open in Jobs" link reaches the button.

### Public page

- `app/track/[token]/page.tsx`: fixed light palette, no console shell, deliberately not tokenised (added to
  the excluded list in `CLAUDE.md`), `noindex`. Client component polls the JSON route every 60 seconds and
  renders a TomTom map only when the payload carries a position.
- `GET /api/public/track/[token]`: rate limited per IP with `checkRateLimit` (new `RATE_LIMITS` rule).
  Unknown, malformed, expired, revoked and ended tokens all get the same 404 body. Updates `last_viewed_at`.
- Both paths added to `lib/auth/publicRoutes.ts` (one-segment token patterns) and
  `lib/auth/routeClassification.test.ts`.

Payload (built by a pure `buildTrackingPayload` in `lib/tracking/publicPayload.ts`; it is the only place
that decides what leaves the server):

```
{
  operator: { name },                   // loadPodBranding carrierName; no logo in this change
  state: "scheduled" | "en_route_earlier" | "next" | "delivered" ,
  etaWindow: { from, to } | null,       // ISO, shown in Europe/London
  etaLive: string | null,               // ISO, only when state = "next"
  stopsBefore: number | null,           // only when an itinerary exists
  position: { lat, lng, at } | null,    // only when state = "next" and fresher than 10 minutes
  destination: { lat, lng } | null,     // only when state = "next"
  deliveredAt: string | null
}
```

Never included: driver name or id, vehicle registration or id, other stops' addresses or positions,
recipient name, job reference, customer name.

### ETA logic

`lib/tracking/eta.ts`, pure:

- **Order and "next".** From `planning_route_visit_stops` for the job's vehicle and planning date, ordered by
  `service_sequence_number`. "Next" means this is the first stop in that order that is not completed.
  `stopsBefore` is the count of incomplete delivery stops ahead of it. When an itinerary exists for the van
  but this stop is not in it, the stop is never "next" (the van has other planned drops). Without any
  itinerary, a stop is "next" only when its planned date is today (London), it is the job's single
  remaining incomplete stop and the job has a vehicle; `stopsBefore` is null. "Next" is what reveals the
  driver's position, so every doubtful case resolves to not next.
- **Baseline.** `jobs.delivery_eta` when the job has exactly one delivery stop; otherwise none.
- **Lateness.** From the most recent completed DELIVERY stop earlier in today's itinerary whose job has a
  `delivery_eta` and a single delivery stop (a collection is not comparable to a delivery ETA): `delivered_at - delivery_eta`, clamped to [-2h, +6h]. Zero when
  there is none.
- **Window** (state `scheduled` / `en_route_earlier`): baseline + lateness, plus and minus 30 minutes, rounded
  outward to 15 minutes. No baseline: `etaWindow` null and the page says "Out for delivery today" (or
  "Scheduled for <date>" before the planned date).
- **Live** (state `next`): when the vehicle's newest `telematics_positions` row is fresher than 10 minutes,
  `shouldRefreshEta(cache, position, now)` decides whether to call TomTom: no cache, cache older than 2
  minutes, or the cache was computed from an older position. The route calls TomTom routing with
  `routeUrl` / `parseRoute` from `lib/tomtom/api.ts` (van position to `job_stops.lat/lng`), with a new
  optional `{ traffic: true }` argument to `routeUrl` so the live ETA includes traffic, stores the result in `stop_eta_cache`, and the page shows the
  arrival rounded to 5 minutes. The live ETA is shown only while the position itself is fresh enough to
  show (it implies the van's distance). TomTom error or missing key: fall back to the window, never an error.

Times are shown in Europe/London. Per-tenant timezone stays on the queued list.

## Testing

Vitest, `lib/` only:

- `lib/offline/driverSync.test.ts`: POD kinds, ordering of photo, scan and complete, ownership, outcome
  mapping, the pending-POD projection.
- `lib/pod/recordedTime.test.ts`: every acceptance boundary (future skew, 72 hours, shift start and end).
- `lib/walkaround/jobGate.test.ts`: `jobGateDecisionAt` across periods, closed period VOR not re-checked,
  open period VOR refused, missing shift refused.
- `lib/tracking/links.test.ts`, `eta.test.ts`, `publicPayload.test.ts`. The payload test asserts, for every
  state, that no forbidden field is present.
- `lib/auth/routeClassification.test.ts`, `publicRoutes` tests, `lib/accounts/publicLinks.test.ts` (new
  link builder must use `publicAppOrigin()`).

`npm run typecheck` and `npm test` green before merge. The signed-in phone pass and a real TomTom call are
manual and listed as outstanding in the handoff.

## Rollout and dependencies

- Apply `tracking_01` and `tracking_02` (order between them does not matter).
- Offline POD for own-fleet drivers depends on `shifts_01..05`; the 2026-10-07 security scan says S-1 (the
  walkaround rectification bypass) must be fixed before that SQL is applied. Until then the gate fails closed
  exactly as it does today, now with the refusal shown in the "Not sent" list.
- Prefilled recipients depend on the unapplied stop-contacts migration (`20260929093000_job_stop_contacts`).
- README page inventory and integrations, and `CLAUDE.md` (new public page, new server-only tables,
  offline POD queue) updated on this branch.
