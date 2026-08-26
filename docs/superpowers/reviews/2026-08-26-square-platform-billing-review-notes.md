# Square Platform Billing, Review Ledger (2026-08-26)

Deferred items surfaced across this branch's reviews (`ethan/square-platform-billing`), recorded
here so they survive the session. None of these blocked the branch; they are follow-ups or
accepted limitations for Ethan to triage.

## Deferred / accepted limitations

1. **Duplicate Square customer on a first-time-setup race.** Two company admins submitting the
   card form at the same instant can each create a Square customer before either has written
   `company_billing` (the `customers.search` reference-id lookup only sees customers Square has
   already indexed). Harmless: only one request's `company_billing` insert wins, that row's
   `square_customer_id` and `square_card_id` are correct, and the loser's customer object sits
   unused in Square with no card ever charged against it. Not worth a distributed lock for a
   company-admin-only, one-time setup action.

2. **First charge stuck PENDING at Square wedges same-day setup, surfaced as a 409.** If Square
   returns a non-terminal status (PENDING/APPROVED) for the first-time charge, `runChargeCycle`
   throws `PAYMENT_INDETERMINATE` and the route now returns an honest 409 asking the admin to wait
   or try again tomorrow, instead of a raw 500. This self-heals the next London calendar day,
   because the cycle date changes, which changes the idempotency key
   (`chargeIdempotencyKey(companyId, cycleDate, attempt)`), so a fresh attempt is possible; it does
   not self-heal same-day just by retrying, since the key is unchanged while the prior payment is
   still settling. Rare in practice, since Square's card payments normally complete synchronously;
   manual resolution if it does not clear on its own is the Square dashboard.

   Two residual variants of the same rare family, both accepted for v1 (final re-review of
   ba88def):
   - **Settled-PENDING off-book double charge.** If the wedged first payment later settles
     COMPLETED at Square, it was never recorded in `platform_charges`, so the next-day self-heal
     charges a fresh first cycle: the customer pays twice for the overlapping first month, with
     the first payment visible only in the Square dashboard. Remedy: manual refund via the Square
     dashboard.
   - **Recovery-path indeterminate does not self-heal.** In the card-replacement branch an
     indeterminate retry returns the 409 before the CAS, so the new card is never stored, and the
     cycle date never changes mid-dunning, so the idempotency key never refreshes: the cron and
     re-replacements both keep hitting IDEMPOTENCY_KEY_REUSED until resolved manually. The 409's
     "resumes automatically tomorrow" wording is only accurate for the first-time path; softening
     or branching that message is a cheap follow-up.

3. **Verify the Vercel plan supports `maxDuration = 300` on `/api/billing/run`.** Legacy
   (non-Fluid) Hobby plans clamp function duration to 60 seconds regardless of what the route
   declares. Check the actual Vercel plan and Fluid Compute setting when `CRON_SECRET` and the
   Square env vars are added to Vercel; a clamp here would silently truncate the cron mid-loop
   over companies.

4. **No alerting when the cron summary has `failed > 0`.** `/api/billing/run` returns a JSON
   summary with succeeded/failed/skipped counts but nothing pages anyone on failures. A Teams
   webhook integration already exists elsewhere in the repo (see the lead-notification path); wiring
   the cron's failure count into it is a reasonable follow-up, not done in this branch.

5. **Accessibility gaps on the billing UI.** The card form's error/notice regions have no
   `aria-live` attributes, so a screen reader will not announce a decline or a settling-payment
   message without the user re-navigating to it. The charge-history table has no `th scope`
   attributes. Both are small, deferred fixes.

6. **`/settings/billing` vehicle-count preview can diverge from the charged count.** The preview
   counts RLS-visible active licences without the tenant-membership filter that
   `fetchBillableVehicleCount` applies server-side, so it can differ from the actual charge on
   orphaned licences (a licence whose vehicle no longer resolves to one of the company's tenants).
   It is also subject to PostgREST's 1000-row cap like any unscoped-ish query. The server-side
   charged count (`runChargeCycle` via `fetchBillableVehicleCount`) is authoritative and guarded by
   the 1000-row tripwire; the preview is display-only and not used for billing.

7. **`/super-admin/billing` unscoped fetches are subject to the 1000-row cap.** Its
   tenants/vehicles/licences reads are not chunked or capped the way `fetchBillableVehicleCount` is,
   so at large scale they could silently undercount. Display-only (super-admin overview), not used
   to compute an actual charge, so the impact is a misleading number rather than a billing error.

8. **README integrations section has no standalone Stripe Connect entry.** Square subscription
   billing was added as its own entry; Stripe Connect (used for a different purpose, customer
   payment collection) was already undocumented there before this branch and remains so. Flagged,
   not fixed, since it is out of this branch's scope.

9. **Spec drift, deliberate: `retry_count`'s non-null-only-mid-dunning description.** The design
   spec's text says `retry_count` is meaningful only while a company is mid-dunning, implying it
   resets or stops mattering once `past_due`. The implementation keeps `retry_count` at its last
   value while `status = 'past_due'` and never resets it to null, because
   `selectRecoveryAction` needs that value to compute the next attempt number
   (`retry_count + 1`) when the admin eventually replaces the card. This is a deliberate deviation
   from the literal spec text, not an oversight.

10. **Spec's "dev-only run-cron-now affordance" satisfied differently than written.** The spec
    describes a UI affordance for triggering the cron on demand during development. This branch
    instead documents an authenticated `Invoke-RestMethod` PowerShell command in the manual sandbox
    walkthrough (Task 14 of the implementation plan) as the equivalent. No UI button was built.

11. **Super-admin page omits the literal "last charge result" field.** The spec's UI section
    mentions showing the last charge result. `/super-admin/billing` shows status, card details,
    next charge date, and retry count, which together imply the last outcome, but there is no
    single labeled "last charge result" field. Not fixed in this branch.

12. **Declined first-time cards accumulate as enabled cards on the Square customer.** The
    best-effort disable-on-replace (`disableReplacedCard`) only runs in the card-replacement path,
    where an `existing` `company_billing` row already points at an old card. A first-time card that
    gets declined (no `company_billing` row is ever written) is never disabled, so a company that
    tries several declining cards before finding one that works will have multiple enabled cards on
    file at Square, only one of which `company_billing` ever references. Harmless (nothing charges
    them), but not cleaned up.

13. **Square idempotent-replay behavior should be confirmed during the sandbox walkthrough.**
    This branch assumes Square, on a genuine idempotency-key replay (same key, same request body),
    returns the cached original response rather than re-evaluating current payment state. That
    assumption is load-bearing for the crash-and-rerun safety of `runChargeCycle` (Task 7's code
    review) and should be confirmed against the real sandbox API during Task 14's manual walkthrough,
    not just inferred from documentation.

## Cross-reference

See the implementation plan (`docs/superpowers/plans/2026-08-26-square-platform-billing.md`) for
the fixes each review round produced; this file is the accepted-limitations ledger, not a plan of
further work, except where noted above (items 3 and 4 are genuine follow-ups worth doing).
