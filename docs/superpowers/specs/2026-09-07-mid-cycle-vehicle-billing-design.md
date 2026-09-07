# Mid-cycle vehicle billing

Date: 2026-09-07
Status: approved, not yet implemented

## Problem

Platform billing charges each company every 4 weeks for the vehicles it owns, and the
amount comes from a single count taken at the instant of the charge
(`fetchBillableVehicleCount` in `lib/billing/server.ts`, called by `runChargeCycle`).
Between charges the fleet is invisible to billing. Two consequences:

1. A vehicle activated the day after a charge runs free for up to 27 days.
2. Worse, a company can deactivate its licences the night before `next_charge_on` and
   reactivate them the morning after, and run the entire fleet free indefinitely.
   `vehicle_licences` inserts and updates go straight from the browser to Supabase
   (`app/settings/licences/page.tsx`), so nothing server-side observes the flip.

The billable unit is a vehicle with at least one active `vehicle_licences` row, not a
row in `vehicles`. Any fix has to key off licence activation or it will disagree with
what the cron counts.

## Decisions

| Question | Decision |
| --- | --- |
| Trigger | A licence becoming active, whether by insert or by toggling `active` back to true. |
| Amount | Pro-rata to the end of the current cycle, at the marginal band rate. |
| Removals mid-cycle | No refund and no credit. The vehicle is simply not counted at the next charge. |
| Re-adding a vehicle already paid for this cycle | Free. Coverage is once per vehicle per cycle. |
| Card declined | Block the activation. The licence is not written. |
| Company with no card on file | Allow freely, no charge. |
| Pro-rata granularity | By day: `marginalWeeklyPence * remainingDays / 7`, rounded to the nearest penny. |

## The invariant

Billing stops being a live snapshot and becomes a **paid-coverage set**. A vehicle is
legitimately active only if it appears in the coverage set for the company's current
cycle. There are exactly two ways into that set:

- the 4-weekly cron charge, which covers every vehicle it counted, or
- a mid-cycle pro-rata charge, which covers one vehicle for the remainder of the cycle.

This single invariant closes both holes. The deactivate-before-charge trick stops
paying off because reactivation is free only when the vehicle was already paid for in
the current cycle, and a vehicle excluded from the cycle charge was not.

## Schema

New manual migration `docs/sql/billing_03_mid_cycle_charges.sql`, applied in the
Supabase SQL editor like the `rls_*` and `billing_*` series. Safe to re-run.

### `vehicle_cycle_coverage`

Primary key `(company_id, cycle_date, vehicle_id)`. One row per vehicle per cycle that
has been paid for. Written by the cron for every vehicle it counted, and by the add-on
route for a single vehicle.

RLS mirrors `billing_01`: company admins select their own company's rows, `super_admin`
selects all, no INSERT/UPDATE/DELETE policies, and the table grants are revoked from
`authenticated` and `anon`. All writes come from the service role.

### `vehicle_addon_charges`

Mirrors the `platform_charges` columns, with `vehicle_count` replaced by `vehicle_id`,
plus `covers_days int not null`. Unique on `(company_id, cycle_date, vehicle_id, attempt)`.

A separate table rather than reusing `platform_charges`, because that table's
`unique (company_id, cycle_date, attempt)` cannot hold several add-ons inside one cycle.

Same RLS and grant shape as `vehicle_cycle_coverage`.

### `vehicle_licences` grants

```sql
revoke insert on public.vehicle_licences from authenticated, anon;
revoke update (active) on public.vehicle_licences from authenticated, anon;
```

Column-level revoke keeps ordinary edits (expiry date, notes, licence type) working
from the browser while making `active` unwritable by a client. `active` is the only
column that costs money. Precedent for a column-level guard:
`docs/sql/profiles_privileged_columns_guard.sql`.

`delete` stays client-side. Removing a licence never creates billable state, and the
coverage set means a delete-then-reinsert inside one cycle is free anyway.

This is the part that makes the scheme actual enforcement rather than a convention: a
server route alone would be bypassable with a raw supabase-js call from devtools using
the user's own token.

## New code

### `lib/billing/prorata.ts` (pure)

- `marginalWeeklyPence(baselineCount)` returns `weeklyNetPence(n + 1) - weeklyNetPence(n)`,
  derived from `money.ts` rather than re-walking `PRICE_TIERS`, so the add-on price and
  the cycle price can never diverge.
- `remainingDays(todayISO, nextChargeOn)` returns whole days from today to the next
  charge date, and may be zero or negative.
- `computeAddonAmounts(baselineCount, remainingDays)` returns the same `ChargeAmounts`
  shape as `computeChargeAmounts`, with
  `netPence = Math.round(marginalWeeklyPence * remainingDays / 7)` and VAT applied at
  `VAT_RATE`.

**Baseline.** `baselineCount` is `max(liveBillableCount, coverageCountForCycle)`. Using
the live count alone would let a company deactivate vehicles to drop into a cheaper band
position before adding a new one, which is a smaller version of the same exploit. Using
coverage alone would misprice a company that has grown since its last cycle charge.

### `lib/billing/addon.ts` (pure)

`selectAddonAction({ billingRow, todayISO, alreadyCovered })` returns one of:

- `{ kind: "free", recordCoverage: false }` when there is no `company_billing` row.
  No subscription means no cycle to pro-rate against; the first 4-weekly charge after a
  card is added picks up the whole fleet.
- `{ kind: "free", recordCoverage: false }` when `remainingDays <= 0`. The cycle charge
  is due or overdue and has not run yet, so the imminent cron run will count this
  vehicle at full price. Recording coverage here would make it free for a whole cycle.
  Once the cron has run, `next_charge_on` has already advanced by 28 days, so this
  window is only between "cycle due" and "cron ran".
- `{ kind: "free", recordCoverage: false }` when `alreadyCovered` is true. The vehicle
  was already paid for in this cycle.
- `{ kind: "blocked", reason }` when status is `past_due` or `canceled`. Consistent with
  blocking on decline: a company with a dead card must not be able to add vehicles.
- `{ kind: "charge", cycleDate, remainingDays }` otherwise.

`cycleDate` is the row's `next_charge_on`, which is the cycle the coverage row belongs
to and is what the cron will use as its `cycle_date`.

### `lib/billing/money.ts` addition

`addonIdempotencyKey(companyId, cycleDate, vehicleId, attempt)`: first 14 hex characters
of the company id, the compact date, the first 14 hex characters of the vehicle id, and
the attempt number, joined by underscores. At most 42 characters for attempts below
1000, inside Square's 45 character limit.

`attempt` is `1 + the number of existing vehicle_addon_charges rows for
(company, cycle, vehicle)`. This gives two properties at once:

- A request that crashes after the Square call and before the audit insert is retried
  with the same attempt number, so it replays the same key and Square deduplicates
  rather than double-charging.
- A customer who is declined, fixes their card and tries again gets attempt 2 and a
  fresh key, so Square takes a real second payment instead of replaying the decline.
  Without the attempt in the key, the retry would be permanently stuck on the declined
  payment.

If Square answers `IDEMPOTENCY_KEY_REUSED` (a payment exists under this key with a
different body, for example because the band moved between attempts), the route treats
it as indeterminate and blocks the activation, matching how `runChargeCycle` already
handles that case.

### `POST /api/licences/activate`

Service role. Handles both activation and deactivation, since `revoke update (active)`
blocks the browser from writing the column in either direction.

1. `requireCompanyAdmin()` from `lib/billing/server.ts` resolves the caller's company.
2. Verify the vehicle belongs to that company, using the same tenant rule as
   `countBillableVehicles`. Reject otherwise.
3. Load `company_billing`, compute the live billable set and the coverage set for the
   cycle, call `selectAddonAction`.
4. On `charge`: `computeAddonAmounts`, call Square, insert the `vehicle_addon_charges`
   audit row, insert the `vehicle_cycle_coverage` row.
5. On success or `free`: insert the licence, or update `active` to true.

**Order matters: charge first, write the licence last.** A decline must leave no active
licence behind, because the whole scheme rests on "active licence implies paid for this
cycle".

If the Square charge succeeds but the licence write then fails, the company has paid for
a vehicle that is not active. The coverage row is already written, so the retry is free
and the customer is not charged twice. This is the safe direction to fail in.

### Changes to existing billing code

`countBillableVehicles` returns the billable vehicle id set instead of a number, and
`fetchBillableVehicleCount` becomes `fetchBillableVehicles`, returning the ids. Counts
become `ids.size`. The cron needs the ids to write coverage rows, and deriving count and
coverage from one function keeps the two from ever disagreeing, which is the discipline
`vehicleCount.ts` already documents in its header comment.

`runChargeCycle` writes a `vehicle_cycle_coverage` row for every counted vehicle after a
successful charge, in the same step that inserts the `platform_charges` row.

## Call sites

- `app/settings/licences/page.tsx`: `createLicence` and `toggleLicence` post to
  `/api/licences/activate` and surface its error text.
- A decline renders the reason plus a link to `/settings/billing`.
- `/settings/billing` charge history merges `vehicle_addon_charges` into the existing
  `platform_charges` list, sorted by `created_at`, so a customer can see what a
  mid-cycle charge was for. Add-on lines name the vehicle registration and the days
  covered.

## Testing

All decision logic is pure and lives in `lib/`, which is the only tree vitest covers.

- `lib/billing/prorata.test.ts`: marginal rate at every band boundary (10, 20, 50) and
  inside bands; marginal rate is always positive, mirroring the monotonicity assertion
  already in `money.test.ts`; day counts of 0, 1, 7, 27 and 28; rounding at half a penny.
- `lib/billing/addon.test.ts`: every branch of `selectAddonAction`, including the
  `remainingDays <= 0` window and the `past_due` and `canceled` blocks.
- `lib/billing/money.test.ts`: `addonIdempotencyKey` length is at most 45, stable for the
  same inputs, and distinct across vehicles, cycles and attempts.
- `lib/billing/vehicleCount.test.ts`: updated for the id-set return.

The route itself is not covered by vitest and is verified by a signed-in manual pass.

## Rollout order

This touches live payment code. The header of `billing_02_four_weekly.sql` is the
precedent for the split.

1. **Before deploy:** create `vehicle_cycle_coverage` and `vehicle_addon_charges`, and
   backfill coverage for every company's current cycle from the live billable set.
   Without the backfill, every existing company's vehicles look uncovered and the first
   licence toggle after deploy charges for a vehicle already paid for.
2. **Deploy the code.**
3. **After a soak:** revoke the `vehicle_licences` grants. Revoking before the deploy
   would break the licences page outright, since the browser still writes the table
   directly until the new code is live.

Rollback: reverting the code after step 3 breaks licence creation, because the browser
has no insert grant, so a revert requires re-granting first. Between steps 2 and 3 the
code reverts cleanly, since the new tables are additive and unread by the old code.

## Out of scope

- Refunds and credits for mid-cycle removals.
- Arrears: a declined add-on is blocked, not deferred to the next invoice.
- Self-serve signup, which is separate future work already noted in the README roadmap.
- Locking down `vehicles` writes. An unlicensed vehicle is not billable, so creating one
  costs nothing.
