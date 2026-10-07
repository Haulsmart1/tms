# Handoff: offline POD saves and customer tracking links (2026-10-07)

Branch `ethan/offline-pod-tracking-links`, merged to `main`. Spec:
`docs/superpowers/specs/2026-10-07-offline-pod-and-tracking-links-design.md` (source of truth, revised after
each review). Plan: `docs/superpowers/plans/2026-10-07-offline-pod-and-tracking-links.md`.

Built task by task with a fresh implementer per group, each group reviewed twice (spec compliance, then code
quality), plus a final whole-branch review: merge-ready, no critical or important findings open.
Verified at merge: `npm test` 2693 passing, `npm run typecheck` clean, `npm run build` clean.

## What was built

**Offline POD (driver app).** Photos, barcode scans and the delivery completion on `/driver/jobs/[jobId]`
go through the existing ordered IndexedDB queue (`app/driver/driverQueue.ts`) as `pod_photo`, `pod_scan`,
`pod_complete`. The stop shows "Delivered, waiting to send" straight away; doorstep checks run on the phone
(`lib/driver/offlinePod.ts`) and again on the server. Queued requests carry `clientId`, `shiftClientId` and
`recordedAt`; the routes judge the walkaround gate at the recorded time (`queuedJobGate`), never earlier
than the job's `created_at`. An untrusted phone time falls back to server time and flags the stop
`pod_time_untrusted`. Queued photo paths derive from `clientId` and are never upserted, so retries can
neither duplicate nor overwrite a checked photo. Gate lookup failures answer 503 (retried); real refusals
stay 409 (final).

**Customer tracking links.** "Send tracking link" on each undelivered delivery stop in `/jobs` (email,
WhatsApp, copy, withdraw). Public page `/track/[token]`: ETA window from the plan shifted by lateness, a
live TomTom ETA and map only while the stop is next and the fix is under 10 minutes old. Never shows the
driver, vehicle, reference or other stops; every doubtful case (including a failed itinerary lookup)
resolves to "not next".

## To make it live (in order)

1. Apply `docs/sql/tracking_01_links_and_eta_cache.sql`. **Read the result of its final select**: if
   `document_delivery_log.document_type` has a CHECK constraint or enum without `tracking_link`, widen it
   by hand or emailing a link fails (before anything is sent).
2. Apply `docs/sql/tracking_02_pod_flags.sql`, then add `pod_flags` to the `job_stops` select in
   `app/jobs/page.tsx` (comment marks the spot). Until then the "Time not trusted" tag never shows.
3. Offline POD for own-fleet drivers still needs `shifts_01..05`, which need S-1 from the 2026-10-07
   security scan fixed first. Until then the gate fails closed as before; queued items retry 5 times
   (503) and are then set aside with a message, not silently lost.
4. Prefilled recipients need `20260929093000_job_stop_contacts.sql` (dialog works without it, fields empty).
5. `TOMTOM_API_KEY` and `NEXT_PUBLIC_TOMTOM_MAP_KEY` must be set for the live ETA and map; without them the
   page shows the planned window only.

## Never run (manual checks outstanding)

- Signed-in phone pass, offline and back online: photo + scan + complete in airplane mode; duplicate
  scans; no-open-shift refusal; a refusal after the office completed the stop; queue paused (signed out);
  signal dropping right after the completion sends; two fast camera reads.
- A real tracking email (Graph) and the `tracking_share:<hash>` delivery-log row.
- `/track/<token>` in each state on a phone, signed in and out (no sidebar, light palette, noindex); a real
  TomTom live ETA filling `stop_eta_cache`; revoke turning the page into "This tracking link has ended."
- Whether `telematics_positions.recorded_at` is really written as UTC (code assumes it; if local, fixes
  read an hour old in summer).

## Follow-ups recorded, not done

- `/pod/share/[token]` and `/quotation/share/[token]` show the console sidebar to a signed-in user, despite
  comments saying they sit outside the shell (`lib/nav/shouldShowShell.ts` has no exception for them).
  Needs a decision; `/track/` was given one.
- The non-queued gate path (`loadJobGateInput` in `lib/walkaround/server.ts`) looks up `walkaround_checks`
  and `vehicles` by id only, and a missing vehicle row reads as "not VOR". The queued path was hardened
  (tenant/fleet pinned, missing vehicle throws); the old path could get the same treatment.
- Known limit by design: VOR is not re-checked for a closed vehicle period (`vehicles.vor` has no history).
- A phone with a wrong clock is gated by the open-shift rule at server time, so it can be refused after
  its shift ends.
- Every open of the tracking dialog mints a live link (unsent ones expire on their own); minting lazily is
  an option.
- `components/Modal.tsx` has no focus trap; the tracking dialog is its first multi-field user.
- No cleanup for `stop_eta_cache` rows (one per stop, removed with the stop).
- Service worker / PWA (opening the app with no signal) was explicitly out of scope.
