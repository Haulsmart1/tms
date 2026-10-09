# SevenDay recovery and integration

Scope: `fix/seven-day-planning`, starting at `0bf41dc`. Initial worktree was
clean; no interrupted-session uncommitted files survived. The recovered
6 October source was inspected read-only. No other worktree was accessed.

## Root cause and architecture

SevenDay UI/editor files were absent from the newer branch. The recovered
implementation expected `PlanningDriverSchedulePreview.routeDays` and
`remainingTaskIds`, which no longer exist. Its separate planner also rejected
tasks represented by events on multiple days and mapped drops using slices of
canonical indices. Restoring that scheduler would undo the newer driver-aware
integration and its activity/weekly/fortnight state.

The new presentation projects `schedule.days`, `events`, `completedTaskIds`
and canonical task IDs into seven duty-day cards. The current scheduler is
unchanged. Stops belong to their final service-event day; activity remains
visible on every day it occurred. Completed zero-duration services use ETA or
neighbour completion days, without inventing ETAs. Remaining and beyond-horizon
work retains canonical order. The full schedule and ETA table remain visible.

The recovered range-allocation helper is adapted to that projection. Selection
can move a canonical range between day cards or the remaining bucket; precedence
guards prevent a successor preceding its predecessor. It never reorders stops.
Actual route ordering continues through the existing lane/Smart Optimize flow,
canonical itinerary persistence, Save / Apply plan and ordered driver queue.

Manual allocations are explicitly uncalculated drafts. They are stored as an
optional, validated `editorDrafts` field in existing named snapshots and local
recovery data, compatible with existing snapshots. Their identity includes
planning date, driver, time zone and canonical stop sequence. Unedited cards
always follow the latest schedule, rather than retaining stale calculations.
Allocation-only local recovery preserves the canonical itinerary; changed
lane order or driver still invalidates it. Manual allocations do not alter
published planning dates, assignments, driver ETAs or compliance claims.

## Notification audit

Recovered editor buttons used `/api/customer-notifications` and a contact-audit
page. These are absent from the current application. They also offered planned
AM/PM messaging from route-day allocation, which is not authoritative after a
manual edit. They were deliberately not restored.

Current tracking uses `/api/tracking-links`, revocation and
`/api/tracking-links/email`, with hashed expiring tokens, tenant/office checks,
recipient checks and document-email rate limits. Email reuses POD branding and
recipient policies; WhatsApp has the existing tracking sharing helper. The
current tracking/POD/offline POD code and endpoints were left unchanged. No
parallel notification system, SQL or production data changes were introduced.

## Verification and limits

Targeted development suite: 12 files / 104 tests passed, including current
driver-hours/rest and Bob's saved 25-job board → assignment → dashboard trace.
New tests cover horizon overflow, unavailable travel, activity across days,
canonical ranges, invalid stored drafts, zero-duration services and named/local
state round trips. Final full Vitest: 239 files / 2,825 tests passed.
`npm run typecheck` passed (Next route generation and TypeScript).

Production-mode `npm run build` was attempted twice, including Node system-CA
support. Both attempts failed fetching the pre-existing IBM Plex Mono/Sans
Google Fonts resources. No font configuration was changed or build check
disabled. A network-enabled production build is still required.

Current scheduler limitations remain: overlong individual travel legs are
unscheduled; the Planning advisory profile does not enforce a service-triggered
daily duty/rest window. Existing warnings remain visible. SevenDay does not
claim to remedy those constraints or calculate manual allocations.

Remaining real-world checks: authenticated browser day-card/range editing;
save/open/update/copy and local recovery with tenant/date/driver changes;
TomTom routes spanning duty periods; Bob's actual HT21 EOR route and ordering;
driver receipt after Apply plan in a non-production test environment; existing
tracking links/email/WhatsApp and offline POD against that environment. Existing
planning-date SQL prerequisites are unchanged and were not applied here.

No push, deployment, production SQL or production-data operation was performed.

Local commit was attempted from this development worktree but failed before
staging: Git could not create the worktree `index.lock` in its shared metadata
under `tms-production-current/.git/worktrees/tms-seven-day-development` (permission
denied). No local implementation commit exists; changes remain uncommitted in
the designated development directory. No permission bypass was attempted.
