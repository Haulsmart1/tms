# Driver evidence release-review candidate — 18 October 2026

Status: **DRAFT / NOT AUTHORISED FOR PRODUCTION**. This is a single review surface
against current main, not a new functional repair and not hosted acceptance.

## Exact source and exclusions

- Main baseline: `5ea260efaa1cbb9f1e6d52c0240328b725c57323`.
- Reviewed source: PR36, `34236d3216c49739eb0dcb10daffe0f13b9b0aaa`.
- Source tree: `0b1e3d109161c8c2afebc4b57acff98c738591ea`.
- This candidate retains that runtime/test tree unchanged and adds this review
  document plus a local Git-only verification script. No schema/configuration changes.
- The source is 19 commits ahead of main, with 36 changed paths. It incorporates
  PR23's integrated POD/barcode/carried-over snapshot candidate and successive
  PR25, 26, 27, 29, 30, 31, 32, 33, 34, 35 and 36 repairs.
- **EXCLUDED:** GPS PR24 (`4fb93aaaac254cedf238518356521d3c74944860`)
  and companion PR28 (`d430dc9afef6fdb856b0a16dfce6aae4af40e1bb`).
  Neither is an ancestor; no GPS or migration path differs from main.
- Existing PR8/10/11 are older auth/navigation proposals, not additional
  evidence dependencies. Main already includes the separate auth/mobile release.
  This candidate neither closes nor modifies any existing PR.

## What is included

| Area | Retention/confirmation behaviour |
| --- | --- |
| Offline storage | Wait for IndexedDB transaction commit; warn for memory-only retained evidence, including account changes. |
| POD acknowledgements | Keep photo, scan and completion payloads unless the route explicitly acknowledges persistence. |
| Server persistence | Confirm saved stop/job transitions and barcode conflict readbacks; preserve uploaded bytes after ambiguous inserts or rejected metadata. |
| Retry ownership | Check existing photo metadata/ownership before acknowledging; keep conflicting queued recipient/notes for reconciliation. |
| Storage stalls | Bound POD and walkaround SDK upload waiting to 20 seconds while retaining ordered original evidence. |
| Walkaround events | Require explicit save acknowledgement; hold repeated server failures with office-review warning. |
| Driver snapshots | Include carried-over assignments without losing older offline job details. |
| Accepted-event projection | Scope late accepted walkaround events to the queue's observed owner. |

## Verification on the exact source tree

- Full Vitest: **3,283 tests across 284 files passed**.
- `npm run typecheck`: **passed independently** on the exact source tree.
- `npm run build`: **passed with synthetic build-only public Supabase
  placeholders**, Next.js 16.4.0. A clean checkout without these values compiled
  and typechecked but failed static prerendering on the existing missing-config
  guard. The synthetic build does not demonstrate a real Supabase connection.
- Previous exact-source PR36 Vercel preview: READY,
  `dpl_9JKYNtJFfGTDGmXZuJUCUbXSw4fR`,
  <https://tms-3zxyxmal1-wizards-42eec65e.vercel.app>.
  The new review branch requires its own exact-SHA preview verification.
- Local review gate after committing metadata:
  `node scripts/verify-driver-evidence-candidate.mjs`.
  It requires the pinned commits locally and fails closed in a shallow checkout;
  it reads Git only, never database, storage, API or deployment endpoints.
- Gate negative fixtures reject ancestry containing either GPS proposal. A clean
  exact-tree fixture passes. Independent review verified runtime identity,
  exclusions and the limits below; it does not substitute for device acceptance.

All runtime tests use synthetic/mocked transports. No existing driver queue,
POD image, job record, Supabase configuration or production deployment is changed.

## Explicit limits and required release acceptance

1. **Phone/hosted acceptance is NOT complete.** An authorised isolated preview
   test must exercise offline photo/barcode/completion capture, reconnect,
   authentication expiry/account change, reload and office reconciliation with
   synthetic jobs. Verify bytes, metadata and server persistence, not just UI text.
2. **Preserve existing devices and evidence.** Do not clear browser storage,
   unregister service workers, force logout, discard queues or rewrite historical
   completion states to test the repair. Already deleted historical evidence is
   not recovered by these changes.
3. **GPS migration remains blocked.** Existing deployed GPS clients can clear
   queues on refusal and still have other explicit disposal paths. PR24/28 are not
   a durability/migration solution; old tabs and queued positions need separate
   reconciliation and a reviewed rollout plan before any GPS release.
4. The 20-second deadline bounds waiting only; it does **not cancel** the
   underlying SDK upload. Late orphan objects remain possible. Retries preserve
   non-upsert paths; cleanup/reconciliation needs a separate approved design.
5. Walkaround explicit 4xx refusal policy remains unchanged and may remove
   dependent work under the existing business rule. Held transient failures may
   need manual forced retry after office review; eventual delivery is not promised.
6. Accepted events are scoped after this queue observes an identity change.
   Auth observers are separate/deferred; this is not proof of zero render-gap
   privacy across all actual driver UI paths.
7. Obtain explicit release approval for the exact reviewed code/build only after
   acceptance. Do not merge this candidate, promote a preview, change live data,
   apply schema, activate billing or send customer communications from this review.

Estimated operational readiness remains **75%**, not a launch/acceptance claim.
