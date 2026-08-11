# Console redesign: refactor candidates flagged during spec work

Surfaced while scoping `docs/superpowers/specs/2026-08-11-console-design-system-phase1-2-design.md`
(Phase 1: Dashboard & Jobs, Phase 2: Operations). None of these are fixed by that spec —
it deliberately preserves existing behavior, visual-only rebuild. This list is the input for
the intensive code review Ethan flagged as the next step after Phase 1/2, not a review
itself: locations are from reading the files while writing the spec, not from an adversarial
pass, so treat line numbers as approximate and re-verify during the review rather than as
findings to act on directly.

## Live, currently-broken bug (found during execution, 2026-08-11 — not a "candidate", confirmed)

- **`app/invoices/page.tsx` and `app/stats/page.tsx` query a column that does not exist.**
  Both reference `invoices.total_amount`. The real column, confirmed by querying the live
  database directly with the service-role key (bypasses RLS, so not a permissions artifact):
  `select total` succeeds, `select total_amount` fails with Postgres error `42703 — column
  invoices.total_amount does not exist`. This means both pages currently 400 on every load in
  production for any tenant that reaches them. Found by accident: the Console redesign's new
  `/dashboard` page was initially built (and briefly, incorrectly, "fixed") to also use
  `total_amount`, on the mistaken theory that these two already-shipped pages were reliable
  evidence of the real column name — they were not; they carry the same bug. `/dashboard` was
  corrected to use `total` and verified live. **`/invoices` and `/stats` were NOT touched or
  fixed** — out of scope for this redesign, and not exercised by any of its automated
  verification (typecheck/build don't catch this, since Supabase's browser client here isn't
  typed against a generated schema). Given "nobody is using this app/codebase in production
  yet" (per earlier session memory), this has likely gone unnoticed rather than being a recent
  regression. Recommend fixing both files' `total_amount` → `total` as a priority item,
  independent of any redesign work — this blocks real usage of two live pages entirely.

## Business-logic duplication / drift risk

- **Delivered-stop cascade logic exists twice, independently.** `app/jobs/page.tsx`
  (`saveJob`/`savePod`, ~294-528) and `app/pod/page.tsx` (`savePod`, ~168-229) each
  separately check "are all delivery stops for this job now delivered?" and flip
  `jobs.status` to `"completed"`. Same rule, two implementations, no shared function. A future
  change to the rule (e.g. adding a partial-delivery state) has to be made twice and will
  drift if only one is updated.
- **Two unrelated POD-photo capture mechanisms coexist.** `app/jobs/page.tsx`'s inline
  "mark delivered" form takes a raw pasted URL text field; `app/pod/page.tsx` does a real
  file upload to Supabase Storage. Both write to the same `job_stops.pod_photo_url` column.
  Worth deciding whether the jobs-page paste field should be removed, restricted, or kept
  as a deliberate "link to an external doc" affordance distinct from an upload.

## Functional gaps (not bugs — missing/incomplete features)

- **VAT is hardcoded to `0`** on every invoice (`app/invoices/page.tsx` `createInvoice`,
  ~line 155). No VAT calculation exists anywhere in the invoicing flow.
- **Invoice numbers are generated client-side** (`buildInvoiceNumber()`,
  `app/invoices/page.tsx` ~19-26: `INV-YYYYMMDD-` + 3 random digits) with no database
  uniqueness constraint — collision is possible, just improbable at current volume.
- **Subcontractors have no edit or delete**, only create + toggle-active
  (`app/subcontractors/page.tsx`) — contrast with customers, which has full edit.
- **Customers can be deleted with no reference check** (`app/customers/page.tsx`
  `deleteCustomer`) even if jobs or invoices point at that customer — unlike jobs, which
  restrict delete to `status === "planned"` specifically to avoid this class of problem.
- **Orphaned storage files on POD re-upload** (`app/pod/page.tsx` `uploadFile`): re-uploading
  a field doesn't delete the previous object, it just leaves it in the bucket. Storage-cost
  nit today, but grows unbounded.

## Consistency / style debt

- **Write paths don't uniformly re-check tenant scoping.** Inserts everywhere gate on
  `writeTenantId` before writing; updates and deletes (customers, subcontractors, invoice
  status) filter only by `.eq("id", ...)` and rely entirely on RLS. This matches the app's
  stated security model (RLS is the enforced boundary, not the client — see the README's
  multi-tenant section), so it may not need a code change at all — but it's worth an explicit
  decision recorded somewhere, since right now it just reads as an inconsistency rather than
  an intentional pattern.
- **Success-message asymmetry on toggle actions.** `toggleCustomer`
  (`app/customers/page.tsx`) and `toggleSubcontractor` (`app/subcontractors/page.tsx`) set an
  error message on failure but no confirmation on success, unlike every create/save path in
  the same files.
- **`AppHeader`'s (and, after Phase 1, `AppShell`'s) route-exemption is a hardcoded pathname
  array.** This is the same shape of bug that caused the original login-page nav leak
  (commit `91fa6b0`) — every new public route has to remember to add itself. Phase 1 keeps
  this shape (just adds the `no-tenant` status check as a backstop); inverting it to an
  allowlist-of-authenticated-routes model would remove the failure mode at the root instead
  of relying on a second guard to catch it. Worth doing once there's a stable list of public
  routes to allowlist against.

## Already being addressed, listed for cross-reference only (not open items)

- Tracking page silently swallowing fetch errors — fixed as part of Phase 2 (adds the
  standard loading/error/empty table states, which requires actually capturing the error).
- `/dashboard` having zero tenant/auth gating — fixed as part of Phase 1 (new data layer is
  wrapped in `TenantGate`).

## Separate, pre-existing, already tracked elsewhere (not duplicated here)

These were flagged in earlier security work and are independent of the redesign — listed so
this doc doesn't read as the complete backlog:
- `app/settings/company/page.tsx` logs the full Supabase session (access + refresh tokens)
  plus PII to the console.
- `app/login/page.tsx` `signInWithOtp` has no `shouldCreateUser: false`.
- `job-files` storage bucket still has 4 permissive, non-tenant-scoped policies (deferred
  pending a decision on its ownership).
- `public.roles` grants INSERT/UPDATE/DELETE to `authenticated` (currently inert, RLS-blocked,
  but ungranting would remove the dependency on RLS alone) and carries a duplicate role row.
- `middleware.ts` session-refresh/auth-gate is still on the roadmap, not built.
