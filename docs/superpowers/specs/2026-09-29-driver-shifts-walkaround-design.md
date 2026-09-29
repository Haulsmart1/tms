# Driver shifts and DVSA walkaround checks: design

Date: 2026-09-29
Branch: `ethan/driver-shifts-walkaround`
Status: approved in brainstorming, 2026-09-29

## Summary

Own-fleet drivers start and end shifts in the driver web app. A shift cannot start until the driver has
submitted a DVSA-style daily walkaround check on the vehicle they are about to drive. Defects found on the
check feed `/maintenance`; a defect classed dangerous takes the vehicle off the road (VOR) automatically.
The driver may object to a VOR, an admin decides the objection, and the admin's approval records that the
operator accepts responsibility. Office staff see shifts, checks, defects and objections on `/dashboard`, a
new `/shifts` page and a new tab in `/maintenance`. Every driver event works offline and syncs later.

There are no live drivers today, so the feature is always on: no per-company switch.

## Decisions taken in brainstorming

| Topic | Decision |
|---|---|
| Who starts shifts | The driver, on their phone. Office staff can also start, end or correct a shift for a driver, with a reason. |
| Defect severity | Decided by a defect catalogue, never by the driver. Each catalogue defect is `minor` or `dangerous`. Dangerous means automatic VOR. |
| Driver judgement | The driver may escalate a minor defect to dangerous, never downgrade. A free-text "Other" defect is minor unless the driver marks it dangerous, and goes to the office for review. |
| Catalogue ownership | A locked DVSA-based baseline for every company. Companies add their own items (tail-lift, fridge, cameras, telematics, crane) with their own severities. Companies cannot remove or downgrade a baseline item. |
| Objection | Driver taps "Object to this" (in-app request, recorded) then "Call transport manager" (phone dialler). Only an admin can approve or reject. Approval requires accepting a versioned liability notice. |
| Shift contents | Start and end, breaks, odometer at start and end, an end-of-shift defect question, vehicle swaps with a fresh walkaround. |
| Vehicle selection | The assigned vehicle is pre-selected; the driver confirms by scanning the cab QR code or typing the registration. A different vehicle needs a reason and flags the office. |
| Dashboard | Four new tiles plus "Needs attention" items; tiles click through to a per-vehicle "Fleet today" table on `/shifts`. |
| Offline | Full offline queue on the phone. Occurrence time is stored separately from receipt time. |
| Architecture | New dedicated tables, read-only from the browser, written only by server routes. |

## Honest limits (the UI and docs must say these, and nothing more)

- **Shift hours are recorded hours, not a legal hours calculation.** Tachograph data stays the legal record for
  driving time. No Working Time Directive, daily rest or weekly rest verdict is computed. Warnings are factual
  ("on duty over 13h"), never "infringement".
- **A QR scan shows the driver was probably at the truck; it does not prove it.** A revocable QR token defeats
  old and copied stickers once reissued, but not a driver holding a photo of the current sticker.
- **A queued start or swap check keeps the scanned QR payload on the phone until it is sent.** It sits in the
  phone's IndexedDB with the rest of the queued event, because offline that is the only record of the scan and
  the server confirms the vehicle from it when the event arrives. The token is printed on the cab anyway, so
  holding it adds little. The stored item is deleted as soon as it is sent or refused, and the copy the page
  keeps in memory to show what was sent has the payload removed.
- **The catalogue is DVSA-based, not DVSA-endorsed.** The baseline follows the DVSA guide to maintaining
  roadworthiness daily walkaround items for HGVs and trailers. The app never claims DVSA approval.
- **The liability wording is not written in this repo.** The Terms clause "an override is the operator's
  decision and responsibility" must be added to the source Terms document in `docs/TMS POLICIES/` and go
  through the outstanding solicitor review. The app shows a short in-product notice at approval time and
  stores which version was accepted; that notice is product copy, not a policy page.

## Scope

In scope: own-fleet drivers (`requireDriverSession` with `portalType === "direct_driver"`).

Out of scope (listed so nobody assumes they exist):
- Walkarounds for subcontractor drivers. A subcontractor runs under its own O-licence.
- GPS proximity check between phone and vehicle.
- Mechanic or transport-manager sign-off on rectification (second-person repair sign-off).
- Offline POD saves (the queue is built so they can reuse it later).
- Working Time Directive or rest calculations.
- Payroll export beyond CSV.
- The Terms clause itself.

## Data model

All tables carry `tenant_id` and have RLS enabled with one `tenant_read` SELECT policy using
`can_access_tenant(tenant_id)`. Client INSERT, UPDATE and DELETE are revoked, as `prodfix_95` (on the unmerged `ethan/ledger-readonly`) does for the
accounts ledger. Writes happen only in route handlers using the service-role client after authorization.
Migrations live in `docs/sql/shifts_01..` and are applied by hand, recorded in `prodfix_00_APPLY_ORDER.md`.

### `defect_catalogue_items`

| Column | Notes |
|---|---|
| `id` uuid pk | |
| `company_id` uuid null | null = locked baseline; set = that company's addition |
| `code` text | stable key, e.g. `brakes.air_leak`; unique per (`company_id`, `code`) with baseline codes reserved |
| `category` text | e.g. `tyres_wheels`, `brakes_air`, `lights`, `tail_lift` |
| `item_label` text | the thing checked, e.g. "Brakes and air system" |
| `defect_label` text | the defect, e.g. "Audible air leak" |
| `guidance` text | "what to look for" text shown to the driver |
| `severity` text | `minor` or `dangerous` |
| `applies_to` text | `vehicle`, `trailer` or `both` |
| `sort_order` int | |
| `retired_at` timestamptz null | retired items are not offered and are refused on submit |

Baseline rows are seeded by the migration. A trigger refuses any insert, update or delete touching a row
with `company_id is null` unless the session setting `app.walkaround_seed` is `on` (set only inside the seed
migration), so no company admin can edit the baseline even through a bug in a service-role route. Company rows are written by `app/api/settings/walkaround/**` (admin only).

### `driver_shifts`

`id`, `tenant_id`, `driver_id`, `client_id` (uuid generated on the phone, unique per tenant),
`started_at` (occurrence time, set from the first passing walkaround), `ended_at` null,
`start_received_at`, `end_received_at`, `ended_by` (`driver` | `office`),
`end_defect_answer` (`none` | `reported` | null), `flags` text[] (e.g. `late_sync`, `out_of_order`,
`assigned_vehicle_mismatch`, `open_over_16h`), `created_by_user_id`, `created_at`.

One open shift per driver: partial unique index on `(driver_id) where ended_at is null`.

### `shift_breaks`

`id`, `tenant_id`, `shift_id`, `client_id`, `started_at`, `ended_at` null, received times. Breaks may not
overlap each other or fall outside the shift (checked in `lib/shifts/hours.ts` and in the route).

### `shift_vehicle_periods`

`id`, `tenant_id`, `shift_id`, `vehicle_id`, `walkaround_check_id`, `started_at`, `ended_at` null,
`start_odometer` int, `end_odometer` int null. A swap closes the open period and opens a new one, and the
new one needs its own passing (or minor) walkaround. `vehicle_id` writes go through the existing `LIC01`
and `LIC02` trigger path (see Server rules).

### `walkaround_checks`

`id`, `tenant_id`, `driver_id`, `shift_id` null (null only for an abandoned or dangerous-result check that
did not start a shift), `vehicle_id`, `client_id`, `performed_at`, `received_at`, `odometer`,
`vehicle_confirmation` (`qr` | `registration`), `vehicle_mismatch_reason` null, `result`
(`pass` | `minor` | `dangerous`), `checklist_snapshot` jsonb (the exact catalogue rows shown, including
company rows), `declaration_accepted` bool, `flags` text[].

### `walkaround_defects`

`id`, `tenant_id`, `check_id`, `vehicle_id`, `catalogue_item_id` null (null for "Other"),
`catalogue_severity` (`minor` | `dangerous` | null), `final_severity` (`minor` | `dangerous`),
`escalated_by_driver` bool, `severity_source` (`baseline` | `company` | `driver`), `note`,
`photo_paths` text[], `maintenance_record_id`, `rectified_at` null, `client_id`, `created_at`. The phase
lives on the check, not the defect (see Clarifications below).

### `defect_objections`

`id`, `tenant_id`, `defect_id`, `driver_id`, `client_id`, `reason`, `status`
(`pending` | `approved` | `rejected`), `raised_at`, `decided_by_user_id`, `decided_at`, `decision_note`,
`liability_notice_version`, `liability_accepted` bool.

### `shift_corrections`

`id`, `tenant_id`, `shift_id`, `corrected_by_user_id`, `corrected_at`, `field`, `old_value`, `new_value`,
`reason` (required). The driver's original values are never deleted; corrections are applied on top and
the history is shown.

### Other schema changes

- `vehicles`: `walkaround_qr_token_hash` text null (the QR carries vehicle id plus a random token; only the
  hash is stored, same approach as `pod_share_links`).
- New table `walkaround_settings` (`company_id` pk, `on_call_phone` text null, `updated_by_user_id`,
  `updated_at`), same read-only-from-browser rule. Not `company_profiles`: that table is keyed by company id
  in a column named `tenant_id` and is client-writable, so a server-only setting does not belong there.
- Storage: private bucket `walkaround-photos`, path `<tenant_id>/<check_id>/<defect_client_id>/<file>`,
  tenant-scoped exactly like `pod-files` (`lib/pod/evidencePath.ts` rule), served by short-lived signed URLs.
  Restrictive `storage.objects` policies (prodfix_83 style) block every client role from the bucket.
- `vehicles.walkaround_qr_token_hash` is server-only: a trigger refuses any client change (errcode `WLK05`).
- Trigger on `vehicles`: refuses `vor = false` (errcode `WLK01`) while the vehicle has any
  `walkaround_defects` row with `final_severity = 'dangerous'`, `rectified_at is null` and no approved
  objection. Database-level backstop in the style of `LIC01`.

## Clarifications decided while planning

1. `phase` lives on `walkaround_checks` (`start` | `swap` | `end_of_shift`), not on defects. End-of-shift
   defects are recorded as an `end_of_shift` check whose snapshot holds only the reported items.
2. The QR payload is short: `TMSW1:<16-char Crockford base32 token>`. The server finds the vehicle by the
   token's SHA-256 hash within the driver's tenant.
3. Rectification is a database trigger: when a `maintenance_records` row linked to a defect becomes
   `completed`, the defect's `rectified_at` is set. `/maintenance` needs no new write path for this.
4. An office-started shift (driver's phone unavailable) records hours only: it has no vehicle period, so the
   job gate still blocks stop completion until the driver completes a walkaround check.

## Driver flow (`/driver/...`, fixed light palette like `/driver/jobs/[jobId]`)

1. `/driver/dashboard` shows "Start shift". Today's jobs are visible but locked until a check passes (or passes with minor defects) and has synced.
2. **Confirm vehicle.** Assigned vehicle pre-selected (active `vehicle_assignments`, else today's jobs'
   `vehicle_id`). Confirm by scanning the cab QR (existing camera barcode code in `lib/driver/cameraBarcode.ts`)
   or typing the registration. "Different vehicle" needs a reason and sets `assigned_vehicle_mismatch`.
   VOR, unlicensed and cancelled-company vehicles cannot be chosen.
3. **Walkaround.** Odometer first. Each item: OK or Defect. Defect opens that item's catalogue defects plus
   "Other", a photo (resized in the browser with `lib/driver/imageResize.ts`) and a note. Severity can be
   raised, never lowered. Baseline items first, then company items.
4. **Review, declare, submit.** "I declare this check is accurate." Queued offline.
5. **Result.**
   - Pass or minor: the shift starts at the check's `performed_at`; jobs unlock.
   - Dangerous: "Do not drive this vehicle" screen that lists **every defect causing the VOR**, each with the
     catalogue wording, the reason it is dangerous ("Classed dangerous in the baseline checklist (based on DVSA guidance)" / "Classed
     dangerous by <company> for this item" / "You marked this as dangerous"), the guidance text, and the
     driver's own photo and note. Buttons: "Object to this", "Call transport manager" (a `tel:` link to the
     company's `on_call_phone`, hidden with an explanation when none is set), "Check a different vehicle".
     No shift starts until a different vehicle passes.
6. **During the shift:** Start break / End break, Swap vehicle (end odometer, then a full walkaround on the
   new vehicle), End shift.
7. **End shift:** odometer (not asked when no vehicle is on the shift, as after an office start), then "Any new defects since your check?" A defect here follows the same severity
   rules and can VOR the vehicle before the next driver takes it.

An abandoned check leaves no open shift: a shift exists only once a check with result pass or minor has
been submitted.

## Office side

- **`/maintenance` → Walkaround checks tab.** Checks by day, filter by vehicle, driver and result. Opening a
  check shows every item, defect, photo and the declaration. Each defect's `maintenance_records` row shows in
  the existing list tagged "Walkaround". Completing that maintenance record sets the defect's `rectified_at`
  (through a server route). A vehicle leaves VOR only when every dangerous defect on it is rectified or has
  an approved objection **and** an admin returns it to service (existing admin-only rule, now also enforced
  by the `WLK01` trigger).
- **Objections.** Urgent item in "Needs attention" and on the defect. Admin approves or rejects with a note.
  Approve shows the liability notice (versioned constant in `lib/walkaround/liability.ts`) and requires a
  tick; version and tick are stored. Non-admin staff can view, not decide. The driver sees the outcome.
- **`/shifts` (new).** "Fleet today" table (one row per vehicle: driver, walkaround time, shift state,
  defects) and a history tab (shifts by driver or date: duty time, break time, time excluding breaks,
  mileage), CSV export. Office start, end and correct with a mandatory reason, writing `shift_corrections`.
- **`/settings/walkaround` (new).** Baseline read-only; company items add, edit severity, retire (admin
  only). The on-call phone number.
- **`/vehicles`.** Print QR and Reissue QR per vehicle.
- **`/dashboard`.** Tiles: On shift now, Walkarounds today (and vehicles out unchecked), Open defects
  (and how many dangerous), Objections awaiting approval. Each tile links to `/shifts` or `/maintenance`.
  "Needs attention" gains: dangerous defects, pending objections, a vehicle on a job today with no check,
  shifts open over 16h, and checks on a vehicle other than the assigned one.

New console pages (`/shifts`, `/settings/walkaround`) use the design system (`ds font-sans bg-canvas
text-ink`) and are added to `lib/nav/themeableRoutes.ts`. Every new page and route is added to
`lib/auth/routeClassification.test.ts` as protected. None is public.

## Offline sync

- The phone keeps an ordered queue in IndexedDB. Each item has a `client_id` (uuid) and its occurrence
  time. Photos are stored as blobs and uploaded after the check row exists, through server-issued signed
  upload URLs (Vercel 4.5 MB body cap), then attached by a JSON call.
- Items sync in order with backoff, reusing the approach of `lib/driver/gpsRetry.ts`. The queue logic is pure
  (`lib/offline/queue.ts`) with an IndexedDB adapter kept thin. A head item that gets five consecutive 5xx
  answers is set aside like a refusal ("The server could not save this. It has been set aside; tell the
  office.") so one bad event cannot block the queue forever.
- Break, swap and end events carry `shiftClientId`: the client id of the start check that opened the shift
  (the server returns it as `openShift.clientId`; an office-started shift has its own). The server resolves
  the shift by that id, never "whichever shift is open now".
- A visible "N items waiting to sync" indicator. Signing out with items queued warns first.
- The phone always flushes its queue before any POD save, so an offline check never blocks the first
  delivery once signal returns.

## Server rules

- **Idempotent, first.** A repeated `client_id` returns the original result and writes nothing. The route
  looks the id up before any business check, and every RPC takes the per-driver advisory lock and repeats the
  lookup before anything else, so a retry is never refused because the vehicle went VOR or a break closed
  since it was saved.
- **The server recomputes severity** from the catalogue rows in the submitted snapshot, re-validated against
  the database (a snapshot row that does not exist, belongs to another company or is retired is refused).
  The phone's claimed severity is ignored except to detect escalation; a mismatch is logged. The database
  repeats this: `walkaround_insert_defects` reads the stored severity, company and retirement of every
  catalogue defect and refuses a missing, retired, other-company or downgraded one (errcode `WLK04`), and
  the check's result must agree with its defects.
- **Occurrence-time sanity.** Future times (beyond 5 minutes of clock skew) are refused. Times more than
  72 hours old, or earlier than the previous event in the same shift, are accepted and flagged
  (`late_sync`, `out_of_order`), never silently corrected. A time before the shift start or the break start
  is refused with `SHF06` / `SHF07` rather than tripping a table constraint.
- **Auto-VOR on arrival.** A dangerous defect sets `vehicles.vor = true`, `vor_since` = the defect's
  occurrence time, `vor_reason` naming the defect. Already VOR: the defect is added, nothing else changes.
  The office sees both occurrence and receipt times.
- **Office corrections win.** Late driver events for a shift the office has corrected are attached and
  flagged, not applied over the correction, and never touch any other shift. On an ended shift a late break
  is kept (flagged `after_office_end`) only if it falls inside the shift, otherwise the shift is flagged
  `late_break_skipped`; a late end records the driver's odometer and any end-of-shift defects; a late swap
  check is recorded with its defects (so a dangerous one still takes the vehicle off the road) but opens no
  period. End-of-shift defects go on the vehicle the driver is on now; with none, `SHF05`.
- **Vehicle eligibility.** VOR vehicles are refused. The existing `LIC01` / `LIC02` trigger refusals on
  `shift_vehicle_periods.vehicle_id` (the trigger is extended to this table) are turned into a message by
  `lib/billing/unlicensedVehicle.ts`.
- **Job gate.** Stop completion and POD routes for direct drivers refuse (409, clear message) unless the
  driver has an open shift whose current vehicle period has a submitted pass or minor check and the vehicle
  is not VOR. Pure rule in `lib/walkaround/jobGate.ts`. Until the `shifts_*` SQL is applied the gate fails
  closed: apply the SQL before inviting the first driver.
- **Authorization.** Driver routes use `requireDriverSession` and refuse `portalType !== "direct_driver"`.
  Office routes use `authorizeTenant()`; objection decisions, catalogue edits and QR reissue require
  admin; shift corrections require an office caller (`lib/jobs/officeRoles.ts`).

## Units (pure logic in `lib/`, each with a colocated test)

| Module | Responsibility |
|---|---|
| `lib/walkaround/catalogue.ts` | Merge baseline and company items, validate company additions, snapshot shape |
| `lib/walkaround/baseline.ts` | The baseline catalogue data (also the source for the seed SQL) |
| `lib/walkaround/severity.ts` | Final severity per defect; escalate-only; check result |
| `lib/walkaround/vor.ts` | When a vehicle goes VOR, and whether it may return to service |
| `lib/walkaround/jobGate.ts` | Whether a driver may complete stops |
| `lib/walkaround/liability.ts` | Versioned liability notice text |
| `lib/walkaround/qrToken.ts` | QR payload encode, parse, token hash |
| `lib/shifts/hours.ts` | Duty, breaks, time excluding breaks, mileage, overlap validation, 13h and 16h flags |
| `lib/shifts/syncRules.ts` | Idempotency decision, time sanity flags, ordering, correction precedence |
| `lib/shifts/csv.ts` | Shift history CSV |
| `lib/offline/queue.ts` | Ordered queue, retry and backoff state machine (storage-agnostic) |
| `lib/dashboard/fleetReadiness.ts` | Dashboard tile counts and attention items from loaded rows |

## Testing

- Unit tests for every module above, including the UK clock-change days (vitest pins `TZ=Europe/London`).
- `routeClassification.test.ts` and `themeableRoutes.test.ts` updated for the new routes and pages.
- SQL: `shifts_01..` migrations plus `shifts_verify.sql` checking RLS enabled, grants revoked, the baseline
  write trigger and `WLK01`.
- Manual: the driver flow on a real phone, toggling airplane mode, signed in against a test company (never
  a real one: `.env.local` points at the live database).

## Rollout

1. Merge code.
2. Apply `shifts_01..` in order in the Supabase SQL editor; record in `prodfix_00_APPLY_ORDER.md`.
3. Set each company's on-call phone in `/settings/walkaround`.
4. Print QR codes from `/vehicles`.
5. Add the liability clause to the source Terms document for the solicitor review.
