# Weekly tiered pricing, billed every 4 weeks

Date: 2026-09-04
Status: approved, ready for implementation planning

## Problem

The platform charges a flat `NET_PENCE_PER_VEHICLE = 1000` per vehicle per calendar month
(`lib/billing/money.ts:3`), on a calendar-monthly cycle anchored to a day of the month
(`lib/billing/schedule.ts`). Two things are wrong with that.

**The rate is per week, not per month.** The intended price is GBP 10 per vehicle per *week*,
collected every 4 weeks. One vehicle is GBP 40 net + GBP 8 VAT = GBP 48 per cycle. The current
code bills GBP 10 + VAT per month, roughly a quarter of the intended revenue.

**There is no volume discount.** The commercial model gives larger fleets a lower rate per
vehicle. The rule as originally described, "every 10 vehicles takes GBP 2 per week off", cannot
run forever: extended linearly it reaches GBP 0 per vehicle at 50 vehicles. The rate schedule
has to stop stepping down and settle on a floor.

A third, smaller problem sits alongside these: the price is duplicated. Two pages
(`app/settings/licences/page.tsx`, `app/super-admin/billing/page.tsx`) declare their own local
`PRICE_PER_LICENSED_VEHICLE` constant rather than importing from `lib/billing/money.ts`. A price
change applied to the shared module alone would leave those two pages quoting the old figure.

## Decisions

Two commercial choices were settled before design, and everything below follows from them.

**Graduated tiers, not all-units.** Each vehicle is priced by the band its position falls in.
The 11th vehicle costs GBP 8 per week; the first ten still cost GBP 10 each. The alternative,
all-units pricing (the whole fleet re-priced at the band rate once a threshold is crossed), was
rejected because it creates revenue cliffs: 19 vehicles at GBP 8 is GBP 152 per week, but 20
vehicles at GBP 6 is only GBP 120 per week, so a customer's bill would *fall* when they added a
vehicle. Graduated pricing is monotonic by construction.

The consequence to be aware of when writing customer-facing copy: under graduated pricing,
GBP 5 is the *marginal* rate paid on the 51st vehicle onward, not the blended rate a 50-vehicle
fleet pays. A 50-vehicle fleet pays GBP 360 per week, a blended GBP 7.20 per vehicle. Copy must
not promise "GBP 5 per vehicle at 50 vehicles".

**4-weekly cycles, 13 per year.** A calendar month averages 4.333 weeks. Billing 4 weeks per
calendar month would collect 48 weeks of revenue a year instead of 52, giving away close to a
month per customer annually. Billing 4.333 weeks per calendar month is exact but produces
GBP 52.00 per vehicle per month rather than the round GBP 48. Charging every 28 days is exact,
keeps the round GBP 48 figure, and is a small change to the scheduler.

## Rate schedule

| Band | Rate per vehicle per week | Cumulative weekly net at band ceiling |
| --- | --- | --- |
| Vehicles 1 to 10 | GBP 10 | GBP 100 |
| Vehicles 11 to 20 | GBP 8 | GBP 180 |
| Vehicles 21 to 50 | GBP 6 | GBP 360 |
| Vehicles 51 and above | GBP 5 | GBP 410 at 60 vehicles |

Worked cycle totals (weekly net x 4, plus 20% VAT):

| Vehicles | Weekly net | Cycle net | VAT | Cycle gross | Blended per vehicle per week |
| --- | --- | --- | --- | --- | --- |
| 1 | GBP 10 | GBP 40 | GBP 8 | GBP 48 | GBP 10.00 |
| 10 | GBP 100 | GBP 400 | GBP 80 | GBP 480 | GBP 10.00 |
| 25 | GBP 210 | GBP 840 | GBP 168 | GBP 1008 | GBP 8.40 |
| 50 | GBP 360 | GBP 1440 | GBP 288 | GBP 1728 | GBP 7.20 |
| 60 | GBP 410 | GBP 1640 | GBP 328 | GBP 1968 | GBP 6.83 |

Every band rate is a whole number of pounds and the cycle is exactly 4 weeks, so every net total
is a whole number of pounds and 20% VAT lands on an exact penny. No rounding drift is possible
at any vehicle count. The existing `Math.round` on the VAT calculation stays anyway, as
protection against a future non-integer rate.

## Design

### Pricing core: `lib/billing/money.ts`

`NET_PENCE_PER_VEHICLE` is removed and replaced by a tier table and a cycle-length constant.
All amounts stay integer pence, as today.

```ts
export const WEEKS_PER_CYCLE = 4;
export const VAT_RATE = 20; // percent, unchanged

// Graduated bands: the Nth vehicle is priced by the band N falls in.
// upToVehicle is the inclusive last vehicle position in the band;
// null means the band has no ceiling and must be last.
export const PRICE_TIERS = [
  { upToVehicle: 10,   weeklyPence: 1000 },
  { upToVehicle: 20,   weeklyPence:  800 },
  { upToVehicle: 50,   weeklyPence:  600 },
  { upToVehicle: null, weeklyPence:  500 },
] as const;
```

Three exported functions.

`weeklyNetPence(vehicleCount: number): number` walks the bands, adding
`vehiclesInThisBand * weeklyPence` for each, and returns the weekly net in pence. It keeps the
existing non-negative-integer guard, throwing on bad input exactly as `computeChargeAmounts`
does today.

`computeChargeAmounts(vehicleCount: number): ChargeAmounts` keeps its current signature so no
caller has to change shape. Internally `netPence` becomes
`weeklyNetPence(vehicleCount) * WEEKS_PER_CYCLE`; VAT and gross are derived as they are now.
The returned `ChargeAmounts` type gains two fields:

- `weeklyNetPence: number`, the whole-fleet weekly net, for "GBP 210 per week" copy.
- `blendedWeeklyPence: number`, `weeklyNetPence / vehicleCount` rounded to the nearest penny,
  for "works out at GBP 8.40 per vehicle per week" copy. Zero when `vehicleCount` is zero.

`tierBreakdown(vehicleCount: number): TierLine[]` returns one entry per band the fleet actually
reaches, each `{ fromVehicle, toVehicle, vehiclesInBand, weeklyPence, weeklyNetPence }`. This
exists so the invoice card and the licences page can render real line items instead of a single
multiplication. It returns an empty array for a zero-vehicle fleet.

`formatPence`, `chargeIdempotencyKey` and `classifyPaymentResult` are untouched.

### Cycle scheduling: `lib/billing/schedule.ts`

`computeNextChargeOn(cycleDate: string, anchorDay: number)` becomes
`computeNextChargeOn(cycleDate: string)`, implemented as `addDays(cycleDate, 28)`. The
calendar-month arithmetic and the `daysInMonth` helper that supports it are deleted, along with
the anchor-day clamping logic that handles a 31st-of-the-month anchor bouncing through February.

`nextRetryOn` is unchanged. Dunning attempts fall on days 1, 3, 5 and 7 from the cycle date,
comfortably inside a 28-day cycle, so shortening the cycle from up to 31 days to exactly 28
cannot cause a retry to collide with the next cycle.

`anchor_day` is threaded through more of the codebase than the scheduler, and every site goes
in the same change:

- `lib/billing/run.ts:78` calls `computeNextChargeOn` and drops the argument; `:10` and `:70`
  drop `anchor_day` from `CompanyBillingRow` and the `Pick`.
- `app/api/billing/card/route.ts` derives an anchor day from the cycle date at `:146` and `:194`
  and writes `anchor_day` into `company_billing` at `:152`, `:235` and `:307`. All five go, and
  the two `computeNextChargeOn` calls at `:147` and `:230` lose their second argument.
- `app/api/billing/run/route.ts:58` stops reading `anchor_day` off the raw row.
- `lib/billing/run.test.ts:9` and `:83` drop it from their fixtures. The `:83` case exercises a
  31 anchor rolling into a short month, a scenario that stops existing; it is deleted rather
  than adapted.

### Database: `docs/sql/billing_02_four_weekly.sql`

`company_billing.anchor_day` becomes meaningless once cycles are a fixed 28 days. A new numbered
migration, following the manual-application convention of the `rls_*` series, drops it:

```sql
alter table public.company_billing drop column if exists anchor_day;
```

The column is `not null` today, so any code path that inserts a `company_billing` row must stop
supplying it in the same change, or inserts will fail against the pre-migration schema. The
implementation plan must sequence the code change and the migration together and call out that
the migration is applied by hand in the Supabase SQL editor, like every other file in
`docs/sql/`.

Dropping rather than keeping the column is safe because there are no live customers. No
`platform_charges` rows need backfilling: historical charges keep whatever amounts they were
written with, which is correct, since they record what was actually taken.

### User-facing surfaces

Seven places state the price or the cadence. All move to "per week, billed every 4 weeks", and
the two pages carrying duplicate constants start importing from `lib/billing/money.ts`.

| File | Change |
| --- | --- |
| `app/page.tsx:26` | Page metadata description: weekly rate and 4-weekly billing |
| `app/page.tsx:81` | Landing pricing card: full tier table (see below) |
| `app/settings/billing/page.tsx:102` | Subscription blurb: weekly rate, charged every 4 weeks |
| `app/settings/billing/NextInvoiceCard.tsx:63` | Replace `N x GBP 10` with `tierBreakdown` line items |
| `app/settings/licences/page.tsx:245,276,301` | Delete local `PRICE_PER_LICENSED_VEHICLE`, import shared module, show tiered total |
| `app/super-admin/billing/page.tsx:137,147` | Delete local `PRICE_PER_LICENSED_VEHICLE`, import shared module |
| `app/settings/page.tsx:26` | Settings card description |
| `README.md`, `CLAUDE.md` | Header line "GBP 10/vehicle/month" |

The landing page shows the **full tier table publicly**, all four bands with their rates, plus
the billing cadence. It must be worded so that GBP 5 reads as the rate on additional vehicles
past 50, not as the price a 50-vehicle fleet pays per vehicle.

`NextInvoiceCard` currently renders `Vehicles x GBP 10.00` when the count is unknown and
`N vehicles x GBP 10.00` when it is known. Both become tier line items driven by
`tierBreakdown`, with the unknown-count case falling back to a rate summary rather than a
multiplication. A single-band fleet (10 or fewer vehicles, the common case) renders as one line,
so the card does not get visually heavier for small customers.

Both settings pages are on the design system. Any new table or list markup follows the
`ds font-sans bg-canvas text-ink` conventions and uses tokens from `app/tokens.css`, with no
Tailwind `dark:` variants, per the project's inverted theme default.

## Testing

`lib/billing/money.test.ts` is rewritten. It currently asserts the flat 1000-pence rate and must
not simply be patched.

- Band boundaries at 0, 1, 9, 10, 11, 20, 21, 50, 51 and 60 vehicles, against the worked table
  above.
- The GBP 48 single-vehicle gross as a named regression anchor, since it is the figure the
  commercial model was specified in.
- A monotonicity property test: for every count from 0 to 200, `grossPence(n + 1)` is strictly
  greater than `grossPence(n)`. This is the guard against anyone later converting the bands to
  all-units pricing and reintroducing the revenue cliff.
- VAT exactness: for the same range, `netPence` is a whole number of pounds and
  `vatPence * 5 === netPence`.
- The existing non-negative-integer input guard still throws for -1 and 1.5.
- `tierBreakdown` returns the expected band count at 0, 5, 15, 35 and 75 vehicles, and its
  `weeklyNetPence` values sum to `weeklyNetPence(count)`.

`lib/billing/schedule.test.ts` gains 28-day-cycle cases: a plain advance, an advance crossing a
month end, an advance crossing a year end, and an advance across the February of a leap year.
Any existing anchor-day test cases are deleted with the feature.

Both files run under the existing `npm test` (vitest, `lib/**/*.test.ts` only, TZ pinned to
Europe/London). `npm run typecheck` is the gate before commit, and will surface every caller of
the removed `NET_PENCE_PER_VEHICLE` and the changed `computeNextChargeOn` signature.

## Out of scope

- Proration when a fleet changes size mid-cycle. Vehicle count is read at charge time and the
  whole cycle is billed at that count, which is the behaviour today.
- Per-company custom or negotiated rates. The tier table is global.
- Annual prepayment or any discount other than the volume bands.
- Migrating existing `platform_charges` history to the new rates.
