# Period billing: arrears, prorated, per vehicle per period

Date: 2026-09-10
Status: approved (Ethan, 2026-09-10)

## Problem

Platform billing today charges in ADVANCE and charges at the moment of the click. The cron
takes a 4-weekly payment on `company_billing.next_charge_on` for the 28 days that follow, and
`/api/licences/activate` takes a pro-rata payment the instant a vehicle is added mid-cycle.

That second half is where the complexity lives. Because adding a vehicle has to move money
synchronously, the code has to survive Square refusing a replayed idempotency key on a request
body that is not naturally stable (the amount moves with the days remaining and with the
baseline fleet size). `billing_05` records payment intent first for exactly this reason, and
`vehicle_cycle_coverage` exists to stop a customer being billed twice for a vehicle they have
already paid for in the running cycle. Roughly a thousand lines of code and migration header
exist to make a mid-cycle charge safe.

The brief is to stop charging mid-period. Licences are billed for time active, in arrears,
when the period closes. Adding a vehicle becomes an insert.

## Decisions

Each of these was a real fork. They are recorded here because none of them is recoverable from
the code.

### Billing stays at COMPANY grain

The original brief keyed every table on `tenant_id`. All existing platform billing is keyed on
`company_id`: one card, one Square customer, one cycle per company. A company owns many
tenants, so tenant grain would mean a separate card and a separate cycle per depot.

Company grain it is. Vehicles still resolve through tenants exactly as
`lib/billing/vehicleCount.ts` does it, and for the same reason recorded there: there is no
`vehicles.company_id` column and nothing may look for one.

`invoice_lines` carries `tenant_id` anyway, for reporting only. A multi-depot operator gets one
bill that can still be broken down by depot.

### Arrears, and `vehicle_cycle_coverage` is retired for v2

Periods close, then invoice. Coverage was a prepayment concept: it recorded what a payment had
already bought so a later mid-cycle addition would not be billed twice. With no mid-cycle
charges there is nothing to double-bill, so v2 writes no coverage rows. The table stays for v1
companies and for history.

### Periods are a fixed 28 days, anchored at FIRST VEHICLE ACTIVATION

Not calendar months. `billing_02` deleted `company_billing.anchor_day` on revenue grounds: four
weeks billed per calendar month collects 48 weeks a year, thirteen 28-day cycles collect 52.
Reintroducing a monthly anchor would reverse that.

Anchoring at first vehicle activation rather than at signup solves three things at once. The
gap between creating an account and adding a first vehicle is simply not a billing period, so
there are no zero-pound invoices and no question about whether to bill a dormant account. The
minimum is collected at that moment, which proves the card with a real settled payment. And
period one starts when the customer starts, which is what they expect.

Dormant accounts (no vehicle ever activated) get no billing period, no invoice, and an
onboarding email instead.

### The minimum is collected UP FRONT, once per period, at activation

This is a deliberate, scoped exception to "nothing is ever charged mid-period".

Exactly one charge, at the start of the relationship, for `PERIOD_MINIMUM_PENCE`, which is an
amount the customer owes for that period regardless of what they do next. It is not a
proration charge and it does not reintroduce any of the machinery arrears exists to remove:
no per-addition charges, no coverage rows, no unstable request body, no replay problem. The
body is a fixed amount keyed on `(company_id, period_id)`.

It buys two things. The card is proven with a settled payment rather than the AVS/CVV
verification `square.cards.create` already performs at card storage, and credit exposure drops
by the floor.

Reactivation after suspension is treated as first activation, so the floor is taken again
before service resumes. A company that has already failed to pay once re-proves the card.

### Pricing: whole-fleet discounts, capped so the total never falls

The v1 rate card (`lib/billing/money.ts`) is GRADUATED per-week bands. v2 replaces it with
whole-fleet discounts per period:

| Fleet | Discount |
|---|---|
| 1 to 9 | 0% |
| 10 to 19 | 10% |
| 20 to 29 | 20% |
| 30 or more | 22% |

Applied naively this is not monotonic. At £64.50 a vehicle, 19 vehicles at 10% off is £1,102.95
while 20 vehicles at 20% off is £1,032.00, so the bill FALLS by £70.95 when the customer adds
their 20th vehicle, and a 20-vehicle fleet costs the same as an 18-vehicle one. This is the
exact failure `lib/billing/money.ts` warns about and `money.test.ts` asserts against.

The fix is a threshold cap. The price for a fleet of N is the cheapest of pretending to be any
band's threshold:

```
price(N) = min over bands B of ( max(N, threshold_B) x rate x (100 - discount_B) / 100 )
```

Every term is non-decreasing in N, so their minimum is too, and monotonicity is provable rather
than spot-checked. `rateCard.test.ts` asserts it across 0 to 200 vehicles.

Consequence worth knowing: fleets just under a threshold pay the threshold price. 18, 19 and 20
vehicles all cost £1,032.00. Vehicles 19 and 20 are effectively free. That is the intended
shape of the promise "20% off at 20 vehicles" and it is the price of keeping the curve honest.

Banded pricing was the alternative. It is monotonic for free and matches the existing code, but
a customer told "20% off at 20 vehicles" who then finds only vehicle 20 and up discounted has
been sold a different deal.

### Invoice presentation

Whole-fleet discounts do not divide evenly across per-vehicle lines, so the discount is not
folded into them. An invoice reads:

1. One line per vehicle at the full rate, prorated by `billable_days / 28`.
2. One volume discount line, band chosen by the period's line count.
3. One minimum charge adjustment line, if the result is under the floor.
4. VAT on the total.

The discount and adjustment lines carry no `vehicle_id`, so that column is nullable and the
`unique (billing_period_id, vehicle_id)` constraint from the brief becomes a partial unique
index `where vehicle_id is not null`. Rule 5 (one line per vehicle per period) is unaffected:
it only ever concerned real vehicles.

Prorating the full rate and discounting the subtotal also gives an invariant worth testing:
when every vehicle covers the whole period, the invoice total equals the rate card exactly.

### Days are Europe/London calendar days

The brief said UTC. `lib/billing/schedule.ts` deliberately uses `YYYY-MM-DD` London strings and
`vitest.config.ts` pins `TZ=Europe/London`, because billing days are UK business days and a
timestamp arithmetic model meets a 23-hour day twice a year. v2 keeps London dates. Every
period is exactly 28 days, so the proration denominator is a constant.

The partial first day rounds up: a vehicle activated at 23:00 counts that whole day.

### Failure, suspension and recovery

A failed period invoice does NOT suspend service immediately. `nextRetryOn` puts attempts on
days 1, 3, 5 and 7 from the close date, and only when that ladder is exhausted does the company
go `past_due` and lose service. A single decline is usually a fraud block or an expired card,
and cutting off a haulier's dispatch and POD capture over it would cost far more than the debt.

While suspended:

- No new billing period is opened. Exposure is capped at one period plus the dunning tail
  rather than compounding. This is a condition in `ensure_open_billing_period`.
- The outstanding invoice stands. `selectRecoveryAction` already answers "a new card was just
  stored, is there an outstanding cycle to retry now" and ports over with the amount source
  changed.
- On payment, the floor is taken again and a NEW period opens dated from that day. The
  suspended time and the six days of dunning are not billed. That is a bounded giveaway and it
  is the price of not suspending on the first decline.

Suspension means no new operational work: no job creation, no vehicle addition, no driver app,
no POD capture, no invoicing out. Read access and export stay open. An O-licence holder has
statutory retention duties (tachograph records 12 months, maintenance records 15), and locking
a suspended operator out of their own compliance records over an unpaid card would make us part
of their DVSA problem. A customer who can still see their data is also likelier to come back
and pay.

### Licence deletion becomes deactivation

`billing_03` deliberately kept the browser's DELETE grant on `vehicle_licences`, reasoning that
removing a licence can only reduce a bill under prepayment. Under arrears a delete destroys the
evidence the invoice is computed from. The grant goes, and the licences page deactivates
instead.

## Migration

Both models run side by side, routed on `company_billing.billing_model`
(`v1_immediate` default, `v2_period` opt-in per company).

The seam is `next_charge_on`. v1 is prepaid, so a company has already paid up to that date; v2
is arrears, so their first v2 period starts there. Nobody pays twice for the same days and
nobody gets a free window. Existing licences are backfilled with `activated_at` set to that
date and `grace_until` null, so no one is charged proration for time already bought.

The backfill is a one-off script in `scripts/`, not run automatically.

## Not doing

- **Grace days, included vehicles and minimum bill days.** The brief specified 14 free days per
  VRN, 2 included vehicles and a 7-day minimum. The columns exist and the logic is implemented
  and tested, but they default to 0, 0 and 1, so nobody's price moves. They are commercial
  levers to turn on per company, not launch terms. `vrn_normalised` is still computed and the
  first-licence-per-VRN rule still sets `grace_until`, so turning grace on later is a config
  change.
- **A new-customer fleet growth cap.** Speculative until someone abuses it.
- **A DB test harness.** `vitest.config.ts` covers `lib/` only. The RLS, concurrent-close and
  double-close tests from the brief are a hand-run `docs/sql/billing_06_verify.sql` in the
  style of `rls_09_verify.sql`, and are marked unrun in the PR.
- **Stripe.** `stripe` is in `package.json` but it is Stripe Connect, for operators collecting
  from their own customers. Platform billing is Square.
