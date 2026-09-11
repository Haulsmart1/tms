# v2 period billing: in-product UI and public pricing

Date: 2026-09-11
Status: approved, not yet implemented
Supersedes nothing. Extends `2026-09-10-period-billing-design.md`, which built the v2 engine
with no user interface at all.

## Why

v2 period billing shipped, merged and deployed on 2026-09-10. It has never moved money, and it
is invisible: `/settings/billing` and `/super-admin/billing` both read `platform_charges`, which
v2 never writes. A company on `v2_period` sees nothing about their bill anywhere in the product.

Two consequences, and the second is the one that sets the shape of this work.

1. A v2 customer cannot see what they are being charged.
2. **There is no way to observe the v2 path except by hand-writing SQL.** The open question from
   the 2026-09-10 handoff, why switching a test company to v2 and adding a vehicle produced no
   charge, is unanswered for exactly this reason. All four early exits in the activation path
   return `ok: true` with no charge, which looks identical to success in the UI.

So the page is designed as an instrument first and a bill second. The dry run is run against
this page, not against the handoff's diagnostic query.

## Decisions taken before design

Recorded because each one closed off work that would otherwise look obviously in scope.

| Decision | Choice |
|---|---|
| First audience | The operator running the dry run, then customers |
| Surfaces | `/settings/billing` only. `/super-admin/billing` gets a copy fix, not a v2 view |
| Test role | Admin of the test company, not super-admin |
| Actions on the page | Card management only. Cancellation stays API-only |
| Projection source | A server route sharing the close job's code path |
| Public pricing | v2 becomes the advertised price, and the signup default |

No live customers exist in the database or on the site as of 2026-09-11, which is why steps 7
and 8 below are acceptable at all. That fact is load-bearing. If it stops being true before this
ships, step 8 must be reconsidered.

## Architecture

### 1. One invoice implementation, not two

`computePeriodInvoice` in `lib/billing/periodServer.ts` claims the period, then does four things
that write nothing:

```
fetchCompanyVehicleIds -> fetchCompanyLicences -> collectPeriodVehicles -> assembleInvoice
```

Those four move out into a new export:

```ts
export async function previewPeriodInvoice(
  admin: SupabaseClient,
  args: {
    companyId: string;
    periodStartISO: string;
    periodEndISO: string;
    settings: CompanyBillingSettings;
  }
): Promise<{ invoice: AssembledInvoice; vehicleCount: number }>
```

`computePeriodInvoice` calls it immediately after its claim and carries on writing exactly as it
does today. The preview route calls the same function.

**The guarantee is structural, not test enforced.** The figure on screen cannot diverge from the
figure the close job produces, because there is no second implementation that could drift. This
is the entire reason for choosing a server route over computing in the browser: a browser-side
projection would have to reproduce how the close job decides which vehicles count and over what
coverage window, and any drift would make the page confidently display a number the close job
will never produce. That is precisely the class of bug the dry run exists to catch, so the
instrument would have been lying about the thing it was built to measure.

The extraction adds no decisions and no new branches. Existing coverage in `close.test.ts` and
`invoice.test.ts` is the regression gate, along with the full 1141-test run.

### 2. `GET /api/billing/preview`

Modelled on `app/api/billing/cancel/route.ts`: `runtime = "nodejs"`,
`dynamic = "force-dynamic"`, `requireCompanyAdmin()` for auth and company resolution.

| Situation | Status | Body |
|---|---|---|
| Not a v2 company | 409 | `{ error: "This account is not on period billing." }` |
| No open period | 200 | `{ ok: true, period: null }` |
| Open period | 200 | `{ ok: true, period, lines, netPence, vatPence, grossPence, vehicleCount, discountPercent }` |
| `billing_06` unapplied | 200 | `{ ok: true, unavailable: "migration" }` |

Two of those need justifying.

**No open period is a success, not an error.** It is the state the test company is in right now,
and it is a legitimate steady state for any v2 company that has not yet activated a vehicle for
billing. Returning 404 or an error would put a red banner on a page describing a situation where
nothing is wrong, and would train the reader to ignore the banner that matters.

**The migration guard is narrow on purpose.** Only PostgREST codes `42P01` (no such table) and
`42703` (no such column) map to `unavailable`. Any other error is real and propagates. This
mirrors `closeDuePeriods`, which takes the same narrow catch for the same reason: a deploy that
lands ahead of `billing_06` must not break billing for every v1 company. Catching more broadly
would hide genuine faults behind a reassuring message.

No `lib/auth/publicRoutes.ts` change. The route is authenticated, and `proxy.ts` answering 401
to an anonymous caller is correct behaviour.

### 3. Page structure

`/settings/billing` is 515 lines and every line of its body assumes v1. It splits:

```
app/settings/billing/
  page.tsx                 shell: role gates, company_billing, model fork   (~120 lines)
  V1Billing.tsx            today's body, moved essentially intact
  V2Billing.tsx            new
  PaymentMethodCard.tsx    shared, unchanged
  NextInvoiceCard.tsx      v1 only, unchanged
```

The shell owns `TenantGate`, the page frame, the three role gates, and one query:
`company_billing` with `select("*")`. Nothing else loads until the model is known.

**The model read is deliberately fail-closed and deliberately not explicit.**

```ts
const isV2 = billing?.billing_model === "v2_period";
```

`billing_model` is a `billing_06` column. The current page uses `select("*")`, so on a deploy
where `billing_06` has not been applied the field comes back `undefined` rather than erroring.
Switching to an explicit `select("billing_model, ...")` would turn that into a 42703 that fails
the entire billing page for **every v1 company**. So the shell keeps `select("*")`, and anything
that is not the exact string `v2_period`, `undefined` included, is v1.

`PageFrame` currently hardcodes the v1 pricing sentence in its header. That becomes a
`description` prop supplied by each body, and it is **withheld rather than defaulted** until
`company_billing` resolves. A v2 admin briefly seeing "£10 per active licensed vehicle per week"
before being corrected is worse than a brief blank: the first is a wrong price, the second is
obviously a loading state.

Why not an inline branch in one file: the file passes 700 lines, both pricing models have to be
held in the reader's head at once, and the two models would share state variables meaning
different things in each. That is how the `money.ts` versus `rateCard.ts` confusion CLAUDE.md
already warns about gets recreated in the UI layer.

Why not a separate route: it puts a billing implementation detail in the URL, and every existing
bookmark and nav link still points at `/settings/billing`.

### 4. What `V2Billing` shows

Four stat tiles: period dates, day N of 28, vehicles counted, projected total.

**Current period card**, the instrument. Every projected line as the close job would write it:
VRN, coverage dates, billable days, amount. Then the volume discount line, then the minimum
adjustment, then net, VAT and gross.

Where a pricing rule is doing the work, the card says so in words rather than leaving the reader
to infer it from arithmetic. "The £129 minimum exceeds your 1 vehicle at £64.50, so the minimum
applies", or the discount band that actually priced the fleet, taken from
`fleetDiscountBand` rather than from the fleet size, because those differ wherever the cap fires.

**No open period is a designed screen, not an empty table.** It is what the dry run will hit
first. It states that no period is open, therefore no vehicle has yet been activated for
billing, and lists the four causes from the handoff:

- the licence was not marked active for billing
- the vehicle was already billable through another licence
- the company is not actually on `v2_period`
- a period was already open, so activation correctly joined it free

This is the diagnostic replacing the handoff's SQL. The page tells you the answer instead of you
querying for it.

Below that: `PaymentMethodCard` unchanged, then `period_charges` history (date, minimum or
balance, attempt, amount, status, `failure_code`, receipt link), then closed periods expandable
to their stored `period_invoice_lines`.

**Projected and stored lines are visually distinct and labelled as "would" versus "did".**
Confusing a projection with a settled invoice is how somebody argues a charge with a customer
and turns out to be wrong.

### 5. Degradation

Three independent regions, settings, preview and history, each withholding only what it cannot
vouch for. This is the pattern `V1Billing` already uses and the comment explaining it stays with
the code it describes.

A failed preview renders `-` and a banner. **Never `£0.00`.** A confident zero on a billing page
is a lie with financial consequences, and the existing v1 page already takes this care with its
licence count.

No `filterByTenant` anywhere on this page. Billing is company-wide by nature, the charge spans
every tenant under the company, and RLS scopes it to the admin's own company. Same documented
choice as v1.

### 6. One source for every pricing string

Six surfaces display pricing. Five hardcode what the sixth computes, which is why they can
disagree:

| Surface | Today |
|---|---|
| `components/landing/PricingCard.tsx` | £10/vehicle/week plus four graduated bands, from `PRICE_TIERS` |
| `app/page.tsx` meta description | "From £10 per vehicle per week, billed every 4 weeks" |
| `app/page.tsx` JSON-LD | `price: "10"`, indexed by search engines |
| `app/settings/licences/page.tsx` | header copy, plus a "Billing Rule £10" stat tile |
| `app/super-admin/billing/page.tsx` | "£10 per licensed vehicle per week" |
| `app/settings/billing/page.tsx` | the header sentence, see section 3 |

New module `lib/billing/pricingCopy.ts` derives every public pricing string from `rateCard.ts`:
the from-price, the per-vehicle rate, the band rows, the arrears sentence. All six read it. It
lives in `lib/`, so vitest covers it, and the six cannot drift again.

`money.ts` and `PRICE_TIERS` **stay**. v1 is still a supported billing model and any company on
it still bills through them. Deleting them is not part of this work.

#### The honest pricing table

v2 is not a reshape of v1. It is a substantial increase, computed from the real rate card:

| Fleet | v1 per 28 days | v2 per 28 days | Band | Ratio |
|---|---|---|---|---|
| 1 | £40.00 | £129.00 | floor | 3.23x |
| 2 | £80.00 | £129.00 | 0% | 1.61x |
| 3 | £120.00 | £193.50 | 0% | 1.61x |
| 5 | £200.00 | £322.50 | 0% | 1.61x |
| 9 | £360.00 | £580.50 | 0% | 1.61x |
| 10 | £400.00 | £580.50 | 10% | 1.45x |
| 15 | £560.00 | £822.38 | 15% | 1.47x |
| 18 | £656.00 | £986.85 | 15% | 1.50x |
| 19 | £688.00 | £1,032.00 | 20% | 1.50x |
| 20 | £720.00 | £1,032.00 | 20% | 1.43x |
| 30 | £960.00 | £1,509.30 | 22% | 1.57x |
| 50 | £1,440.00 | £2,515.50 | 22% | 1.75x |

Small operators are hit hardest. A one-vehicle operator pays more than triple, because the £129
floor is doing all the work. That is what a floor is for, and it is a deliberate commercial
choice, recorded here so nobody rediscovers it as a surprise.

Two cap effects the public copy must not misrepresent:

- **The tenth vehicle is free.** 9 and 10 vehicles both cost £580.50.
- **19 and 20 cost the same**, £1,032.00, because 19 is priced by pretending to be 20.

The public band table therefore reads as "10+ vehicles: 10% off your whole fleet" and states
plainly that a fleet just under a threshold pays the threshold price. That fails toward the
customer and is better said than discovered.

> **Defect found while writing this spec.** The doc comment on `fleetPeriodPence` in
> `lib/billing/rateCard.ts` states "18, 19 and 20 vehicles all cost GBP 1032.00". This is wrong.
> 18 vehicles cost £986.85, priced in the 15% band, because `18 x 6450 x 0.85 = 98685` beats the
> 20-band's `103200`. Only 19 and 20 tie. The code is correct; the comment is not, and it is
> exactly the sentence someone would quote to a customer. Fix the comment as part of this work.

The JSON-LD `price` becomes `129`, the lowest amount anyone actually pays, described as a 28-day
period billed in arrears. Leaving it at `10` would keep an incorrect price in Google's index.

## Flagged: steps 7 and 8 change what a real customer experiences

Everything above is safe to ship before the dry run. The following two are not, and are flagged
at the user's request.

### 7. Card route v2 signup branch

`app/api/billing/card/route.ts` has **zero** v2 awareness. On a company with no `company_billing`
row it calls `runChargeCycle`, which writes `platform_charges` and charges at v1 prices
immediately, then inserts the row with `next_charge_on` set and no `billing_model`, so the row
takes the column default of `v1_immediate`.

Flipping only the column default would therefore produce an incoherent row: marked `v2_period`,
with a v1 charge already taken against it and a v1 next-charge date on it.

v2 bills in **arrears**. A new v2 company must be charged nothing when they save a card. The
period opens when their first vehicle is activated, through `openPeriodAndChargeMinimum`, not at
signup. So the route needs a branch on the new-company path:

- save the card to Square exactly as now
- insert `company_billing` with `billing_model: 'v2_period'`, `status: 'active'`,
  `next_charge_on: null`
- take no money
- respond `{ ok: true, firstCharge: false, model: 'v2_period' }`

The replacement-card and dunning paths are untouched. Existing v1 companies still run through
them unchanged.

### 8. The default switch, last commit

Which model a *new* company gets cannot be read from a row that does not exist yet, so it comes
from one constant in `lib/billing/rateCard.ts`:

```ts
export const NEW_COMPANY_BILLING_MODEL = "v1_immediate"; // step 8 flips this
```

One line, reviewable, reversible.

**This is the last commit, and it is gated on the dry run.** Steps 1 to 7 ship first; the dry run
is performed against the new page; only once a v2 activation has actually charged does this
constant flip. Without that ordering, the first v2 charge in the system's history would be a real
customer's rather than a test, on a path that has never once moved money.

## Testing

vitest covers `lib/**/*.test.ts` only. Nothing under `app/` runs through it, so anything worth
asserting goes in `lib/`, which is the repo's existing discipline and the reason `periodServer.ts`
is deliberately thin.

| Module | Covers |
|---|---|
| `lib/billing/periodView.ts` | day-of-period counter, which pricing rule is binding, the sentence explaining it, projected versus actual labelling |
| `lib/billing/pricingCopy.ts` | from-price, per-vehicle rate, band rows, arrears sentence, all derived from `rateCard.ts` |

`V2Billing.tsx` stays dumb rendering over `periodView`'s output. Both new modules get colocated
`*.test.ts` files.

One boundary is named here because it is among the first cases the dry run will produce and it
reads two ways. At exactly 2 vehicles the fleet price is £129.00, which **equals** the minimum
rather than falling below it. `periodView` reports the minimum as binding only when it strictly
exceeds the fleet price, so 2 vehicles gets no minimum-adjustment sentence and no adjustment
line, while 1 vehicle gets both.

`pricingCopy.test.ts` asserts the derived strings against `rateCard.ts` constants rather than
against literals, so a future reprice fails the test that describes the price instead of
silently shipping stale copy.

Existing 1141 tests are the regression gate on the `computePeriodInvoice` extraction and the
`page.tsx` split.

Playwright specs in `tests/` are a separate npm project and are out of scope.

## Out of scope, deliberately

- **A v2 view in `/super-admin/billing`.** It gets its incorrect pricing sentence fixed and
  nothing else. The dry run is performed as a company admin, so the super-admin console is not
  on the critical path. Note that `/settings/billing` bounces super-admins by design, because a
  super-admin's RLS scope returns every company's rows and `maybeSingle()` would error.
- **Cancellation UI.** `POST /api/billing/cancel` exists and works. A button that refunds money
  does not belong on a page neither the author nor the operator has tested yet.
- **Service-level suspension.** Still not built, as recorded in the 2026-09-10 handoff. A
  `past_due` v2 company keeps full use of the platform.
- **v1 cancellation.** Still refuses outright rather than pretending.
- **Removing v1.** Every existing company is on it.

## Order of work

1. Extract `previewPeriodInvoice`, `computePeriodInvoice` calls it
2. `GET /api/billing/preview`
3. Split `page.tsx` into shell plus `V1Billing` and `V2Billing`
4. `lib/billing/periodView.ts` and tests
5. `lib/billing/pricingCopy.ts` and tests
6. Rewrite the six pricing surfaces, and fix the `rateCard.ts` comment defect
7. Card route v2 signup branch **(flagged)**
8. Flip `NEW_COMPANY_BILLING_MODEL` **(flagged, gated on a successful dry run)**

Steps 1 and 2 are independent of 3 to 6 and can be built in either order. Step 7 depends on 6
only in that the advertised price should be correct before a signup can pay it.
