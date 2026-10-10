# Driver PWA recovery and local implementation — 9 October 2026

## State recovered

Work resumed in `C:\Users\StuartDargue\tms-production-current`, branch
`stu-development`, starting at `0bf41dc` (saved planning dates and driver job
order). Recent history also included the 8 October security patches and the
offline POD/customer tracking merge.

The entire starting diff consisted of seven staged SevenDay recovery files:

- `app/planning/SevenDayPlanEditor.tsx`
- `lib/planning/sevenDayPlanEditor.ts` and its test
- `lib/planning/sevenDayPlanner.ts` and its test
- `lib/planning/sevenDayPresentation.ts` and its test

All seven were preserved byte for byte, with unchanged staged blob hashes,
and excluded from Driver PWA commits. Neither the other worktree nor
`fix/seven-day-planning` was edited or committed.

Existing committed functionality survived: the IndexedDB mutation queue,
owner-scoped shift/walkaround/POD replay, photo/scan/completion handling,
shift projection, memory-only warnings, customer tracking, and Bob's saved
route order/date fixes. Existing tests included `idbStore`, `queue`,
`driverSync`, `offlinePod`, shift projection/actions and driver dashboard
date/order regressions.

No PWA manifest, service worker, durable route/job/shift read cache, or new
PWA tests were present in the starting tree. The accessible session records
did not contain a separate original PWA implementation. No resumable test
execution was found. Windows denied full process-command inspection, so this
is a statement about available evidence, not a claim that no earlier code
ever existed elsewhere.

## Implementation

The driver dashboard, complete job details and shift state now survive
offline reloads in a separate `tms-driver-snapshots` IndexedDB database,
keyed by Supabase account ID and exact read URL. Existing mutation queue
storage is unchanged. Reads prefer fresh server data and fall back only for
connection/server failures, with a 48-hour maximum snapshot age and a visible
save time. Access-denied/not-found responses invalidate affected snapshots.
Dashboard denial removes that owner's read snapshots, without deleting
another account's data or any queued mutations.

Fresh routes replace the entire cached route. Removed job details are pruned;
an older prefetch cannot recreate a job after a newer route removed it.
Snapshot transactions finish before reporting a durable write, and older
responses cannot overwrite newer snapshots. Cached dashboards use the current
operator day instead of reusing yesterday's `todayJobs` subset.

Accepted shift events are projected and committed before their queue rows are
deleted. Server reads overlapping an acceptance retain its projection. A
crash between projection commit and queue deletion cannot project that event
twice. QR credentials are stripped before accepted events are retained.

Account changes invalidate in-flight reads and remount driver forms. The root
auth observer also invalidates remembered driver identity when signing out or
switching accounts from an office page. Offline remembered identity is used
only after a failed session read; a clean signed-out session cannot use it.
This is local display recovery, not authorization for server writes: existing
API authorization, RLS, walkaround gates and owner checks remain authoritative.

The driver-scoped install manifest, PNG icons, Apple metadata, install prompt
and production-only service worker enable offline reopening. Only driver HTML
documents and immutable Next static assets are cached. API requests, mutations,
auth, RSC requests and office pages are excluded. Driver links use document
navigation so offline transitions do not depend on uncached RSC payloads.
Assigned job details and HTML are prepared in the background, with bounded
concurrency and cache sizes. An unprepared page shows an explicit offline
fallback. Login redirects remain authoritative. Worker updates do not force a
reload while a driver is entering work.

## Files

- `lib/offline/driverCache.ts`: network-first snapshot rules, expiry, denial,
  account race checks and crash-safe projection filtering.
- `lib/offline/snapshotStore.ts`: actual IndexedDB transactions, route pruning,
  response ordering and durable accepted shift projections.
- `lib/offline/driverCache.test.ts`, `driverWorker.test.ts`: 30 new regressions.
- `app/driver/driverIdentity.ts`, `DriverSessionBoundary.tsx`: account-bound reads,
  offline messages, route preparation and account-switch form isolation.
- `app/components/TenantProvider.tsx`: observe auth events on every app route.
- `app/driver/dashboard/page.tsx`, `jobs/[jobId]/page.tsx`, `useDriverShift.ts`:
  durable reads and refresh on reconnect/focus.
- `app/driver/driverQueue.ts`: retain accepted shift projections before deletion.
- `app/driver/layout.tsx`, `DriverPwa.tsx`: install metadata, registration and UI.
- `app/driver/dashboard/ShiftPanel.tsx`, `BlockingPanel.tsx`,
  `walkaround/page.tsx`, `ResultStep.tsx`, `StepFrame.tsx`: offline-capable links.
- `public/driver/manifest.webmanifest`, `sw.js`, `offline.html`,
  `icon-192.png`, `icon-512.png`: driver PWA assets.
- `tests/driver-pwa-browser.mjs`: dependency-free headless Edge/CDP recovery
  checks with a local auth fixture and intercepted driver API data.

## Validation

PowerShell blocks `npm.ps1` here; commands use `npm.cmd` without changing policy.

- Targeted: `npm.cmd test -- lib/offline lib/driver lib/shifts lib/walkaround
  --reporter=dot --maxWorkers=4`: **46 files / 440 tests passed**.
- Full suite: `npm.cmd test -- --reporter=dot --maxWorkers=4`:
  **242 files / 2,866 tests passed**, in 28.60 seconds. An earlier full
  run passed 242 files / 2,865 tests before the final crash-projection regression
  was added. Default-concurrency and one earlier targeted run encountered an
  unrelated 15-second Square SDK import timeout; no test was weakened.
- Workspace `npm.cmd run typecheck`: **blocked by 22 pre-existing errors in
  the preserved SevenDay files**, referring to obsolete `routeDays` and
  `remainingTaskIds` fields. Final run had no Driver PWA errors. An intermediate
  accepted-event type mismatch was fixed before final validation.
- Workspace `npm.cmd run build`: **blocked by Google Fonts network downloads**
  for IBM Plex Sans and IBM Plex Mono.
- Isolated source snapshot: archive of baseline HEAD plus only Driver PWA
  changes, with the seven unrelated staged files absent. Final
  `npm.cmd run typecheck` **passed**. The final **production Webpack build passed**,
  including TypeScript and all 56 generated static pages. Google Fonts responses
  were mocked only in this temporary validation copy; Supabase URL/key were
  local dummy values. No application compiler/type checks were bypassed.
- Headless Edge against that production build: **all recovery checks passed**:
  exact first four jobs of Bob's 25-job fixture, SW control, 25 durable job
  snapshots, offline dashboard reload/save time, offline queued break/reload,
  offline prepared job/stops, reconnect replay, fresh empty route/pruning, real
  IndexedDB acceptance/read-race checks, account switching and signed-out
  reopening. Early harness retries addressed canceled CDP requests, a build
  running concurrently with the browser, and waiting for session initialization.
  Final browser execution used stable build output and completed successfully.
- `git diff --check`: passed. Original staged entries and working-file SHA-256
  hashes were verified unchanged.

The temporary validation snapshot is under
`C:\Users\StuartDargue\AppData\Local\Temp\tms-driver-pwa-validation-af1766bf`.
The browser harness creates isolated profiles under ignored `.next/`, uses
ports 4319/4320/9226, and closes its own servers/browser after execution.

## Limits and device verification

Reopening requires one successful online preparation first. The driver snapshot
expiry is 48 hours; browser storage eviction/clearing can still remove saved
data. Signed-out users cannot recover another user's work from the shared shell.
Queued writes retain their existing independent persistence/retry policy.

Verify home-screen installation and airplane-mode cold reopening on actual
iOS Safari and Android Chrome, plus camera scanning, GPS permissions and POD
photo capture on those devices. Headless Edge covered local fixture data; it
did not verify a live tenant or production route.

No push, deployment, production SQL or production-data operation was performed.

## Local commit checkpoints and repository restriction

The session filesystem protects the original repository's `.git` directory.
`git add` failed with `Unable to create .../.git/index.lock: Permission denied`.
No original Git metadata permissions were changed, and no original index or
branch ref was written.

To retain reviewable local commits, a separate bare checkpoint repository was
initialized at:

`C:\Users\StuartDargue\AppData\Local\Temp\tms-driver-pwa-validation-af1766bf\driver-pwa-checkpoints.git`

It fetched only the local `stu-development` baseline. Its own index stages only
the Driver PWA paths from the current working files. The implementation commit
is `1a39796505bcbebaca83ad644c672a5a8a70942d`, followed by a documentation
commit, on its local `driver-pwa-checkpoint` branch. Commit identity is
`Codex <codex@local.invalid>`, configured only in that checkpoint repository.

Both commits are exported to `driver-pwa-local.bundle` in the original working
directory. The bundle excludes existing history and declares `0bf41dc` as its
prerequisite. It can be verified/read using ordinary Git, and imported into a
local repository when Git metadata writes are available. This is an artifact
for review/import, not a push or an automatic update of `stu-development`.

Consequently, the original branch still points to `0bf41dc`, its seven original
SevenDay additions remain staged, and the validated Driver PWA files remain
uncommitted there. The two checkpoint commits and bundle preserve the completed
work despite that restriction; attaching them to the original branch remains
blocked by its read-only Git metadata.
