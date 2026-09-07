# Mid-cycle Vehicle Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge a company pro-rata the moment a vehicle gains an active licence mid-cycle, so vehicles cannot run free between 4-weekly charges and cannot be hidden by deactivating licences before the charge date.

**Architecture:** Billing stops being a live snapshot and becomes a paid-coverage set. A new `vehicle_cycle_coverage` table records which vehicles a given cycle has been paid for. The cron writes coverage for everything it counted; a new `POST /api/licences/activate` route charges pro-rata and writes coverage for a single vehicle. Client write grants on `vehicle_licences.active` are revoked so the route cannot be bypassed. All decision logic is pure and lives in `lib/billing/`, which is the only tree vitest covers.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript, Supabase service-role client, Square Payments SDK v45, vitest, zod.

**Spec:** `docs/superpowers/specs/2026-09-07-mid-cycle-vehicle-billing-design.md`

---

## Corrections to the spec, applied in this plan

Three things the spec got slightly wrong, discovered while writing exact code. The plan is correct; the spec is the older document.

1. **The current cycle is `next_charge_on - 28`, not `next_charge_on`.** The cron charges *on* `next_charge_on` for the 28 days that follow, then advances `next_charge_on` by 28. So at any point mid-cycle, the cycle that has been paid for is identified by `next_charge_on - CYCLE_DAYS`. Filing add-on coverage under `next_charge_on` would put it in the *next* cycle, so the cron would then charge for the same vehicle again, and every add-on would be billed twice.
2. **Activating a second licence on a vehicle that already has one is free.** Such a vehicle is already in the billable count, and the only way it got there was by being paid for. Charging again would bill a company twice for one vehicle.
3. **The spec's "rounding at half a penny" test is unwritable.** The divisor is 7, so the fraction is always `k/7` and can never be exactly half a penny. The rounding test uses a real `k/7` case instead.

4. **`status === "active"` does not mean the subscription is healthy** (found by the Task 4 review). When a cycle charge fails but dunning has retries left, `applyChargeOutcome` in `lib/billing/run.ts` leaves `status: "active"` and `next_charge_on` unchanged in the past, setting only `retry_at`. A company mid-dunning therefore looked healthy to `selectAddonAction`, fell through to the `days <= 0` branch, and could add vehicles free for the whole dunning window; if dunning then exhausted, that cycle was never charged and the vehicles rode free for a full cycle on a card that was already failing. `AddonBillingRow` now carries `retry_at`, a non-null value blocks with reason `dunning`, and the status gate fails closed on any value outside the union.

5. **`revoke update (active)` would have been a complete no-op** (found by the Task 6 implementer). Postgres stores table-level privileges in `pg_class.relacl` and column-level ones in `pg_attribute.attacl`, and permits a write when EITHER allows it, so a column-level revoke cannot subtract from a table-level grant. Supabase's default bootstrap grants `authenticated` table-level UPDATE across `public`, and `rls_05_revoke_grants.sql` never revoked it for `vehicle_licences`. The original STEP 2 would have applied without error, looked correct in review, and left the exploit entirely open. It is now a full table-level revoke followed by generated per-column grants on every column except `active`. This was the single most important correction in the whole implementation: without it every other task here is decoration.

---

## File Structure

**New files:**

| File | Responsibility |
| --- | --- |
| `lib/billing/prorata.ts` | Pure pro-rata arithmetic: marginal band rate, add-on amounts. |
| `lib/billing/prorata.test.ts` | Tests for the above. |
| `lib/billing/addon.ts` | Pure decision function: charge, free, or blocked. |
| `lib/billing/addon.test.ts` | Tests for the above. |
| `lib/billing/addonServer.ts` | Server orchestration for one add-on charge: Square call, audit row, coverage row. |
| `app/api/licences/activate/route.ts` | The only path by which `vehicle_licences.active` may be written. |
| `docs/sql/billing_03_mid_cycle_charges.sql` | Tables, RLS, backfill, grant revokes. |

**Modified files:**

| File | Change |
| --- | --- |
| `lib/billing/schedule.ts` | Add `daysBetween`. |
| `lib/billing/schedule.test.ts` | Test `daysBetween`. |
| `lib/billing/money.ts` | Add `addonIdempotencyKey`. |
| `lib/billing/money.test.ts` | Test `addonIdempotencyKey`. |
| `lib/billing/vehicleCount.ts` | Add `billableVehicleIds`; `countBillableVehicles` becomes a wrapper over it. |
| `lib/billing/vehicleCount.test.ts` | Test `billableVehicleIds`. |
| `lib/billing/server.ts` | `fetchBillableVehicleCount` becomes `fetchBillableVehicles` returning a `Set`; `runChargeCycle` writes coverage rows. |
| `app/settings/licences/page.tsx` | `createLicence` and `toggleLicence` post to the new route. |
| `app/settings/billing/page.tsx` | Merge add-on charges into the charge history. |
| `README.md` | Document the new route, tables and migration. |
| `CLAUDE.md` | Note that `vehicle_licences.active` is server-only. |

---

### Task 1: `daysBetween` calendar helper

**Files:**
- Modify: `lib/billing/schedule.ts`
- Test: `lib/billing/schedule.test.ts`

The spec put `remainingDays` in `prorata.ts`. It belongs in `schedule.ts` instead: that file already owns every other date calculation (`addDays`, `computeNextChargeOn`, `nextRetryOn`) and already has the `parseISO` helper this needs. A second date parser in `prorata.ts` would be a duplicate of logic that already exists three lines away.

- [ ] **Step 1: Write the failing test**

Append to `lib/billing/schedule.test.ts`:

```ts
describe("daysBetween", () => {
  it("counts whole days forward", () => {
    expect(daysBetween("2026-09-07", "2026-09-14")).toBe(7);
  });

  it("returns zero for the same date", () => {
    expect(daysBetween("2026-09-07", "2026-09-07")).toBe(0);
  });

  it("returns a negative number when the target is in the past", () => {
    expect(daysBetween("2026-09-07", "2026-09-05")).toBe(-2);
  });

  it("counts across a month boundary", () => {
    expect(daysBetween("2026-09-25", "2026-10-02")).toBe(7);
  });

  // British Summer Time ends on 2026-10-25. Both dates are parsed as UTC
  // midnight, so the 23-hour local day must not round to 0 days.
  it("is unaffected by the BST to GMT transition", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("spans a full cycle", () => {
    expect(daysBetween("2026-09-07", computeNextChargeOn("2026-09-07"))).toBe(
      CYCLE_DAYS
    );
  });
});
```

Add `daysBetween` and `CYCLE_DAYS` to the existing import at the top of the file if they are not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/schedule.test.ts`
Expected: FAIL, `daysBetween is not a function` or a TypeScript import error.

- [ ] **Step 3: Write the implementation**

In `lib/billing/schedule.ts`, immediately after the existing `addDays` function:

```ts
// Whole days from one calendar date to another, negative when `toISO` is in
// the past. Both dates are parsed as UTC midnight, so this never sees a
// 23- or 25-hour day at a BST transition, which is exactly why billing dates
// are plain YYYY-MM-DD strings and not timestamps.
export function daysBetween(fromISO: string, toISO: string): number {
  const from = parseISO(fromISO);
  const to = parseISO(toISO);
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((toMs - fromMs) / 86_400_000);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/schedule.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/schedule.ts lib/billing/schedule.test.ts
git commit -m "Add daysBetween to the billing calendar helpers"
```

---

### Task 2: Pro-rata arithmetic

**Files:**
- Create: `lib/billing/prorata.ts`
- Test: `lib/billing/prorata.test.ts`

Pricing is graduated: the Nth vehicle costs whatever band N falls in. So the cost of one more vehicle is the difference between the whole-fleet weekly price at N+1 and at N, which is derived from `weeklyNetPence` rather than by re-walking `PRICE_TIERS`. Re-walking would be a second copy of the pricing rules that could silently diverge from the one the cron uses.

- [ ] **Step 1: Write the failing test**

Create `lib/billing/prorata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeAddonAmounts, marginalWeeklyPence } from "./prorata";
import { computeChargeAmounts, VAT_RATE } from "./money";
import { CYCLE_DAYS } from "./schedule";

describe("marginalWeeklyPence", () => {
  it("prices the first vehicle in the first band", () => {
    expect(marginalWeeklyPence(0)).toBe(1000);
  });

  it("prices the last vehicle of a band at that band's rate", () => {
    expect(marginalWeeklyPence(9)).toBe(1000);
    expect(marginalWeeklyPence(19)).toBe(800);
    expect(marginalWeeklyPence(49)).toBe(600);
  });

  it("steps down at each band boundary", () => {
    expect(marginalWeeklyPence(10)).toBe(800);
    expect(marginalWeeklyPence(20)).toBe(600);
    expect(marginalWeeklyPence(50)).toBe(500);
  });

  it("stays on the final band above the last ceiling", () => {
    expect(marginalWeeklyPence(200)).toBe(500);
  });

  // Mirrors the monotonicity assertion in money.test.ts: the bill must never
  // fall when a vehicle is added, so the marginal cost is never zero or less.
  it("is always positive", () => {
    for (let n = 0; n <= 120; n += 1) {
      expect(marginalWeeklyPence(n)).toBeGreaterThan(0);
    }
  });

  it("rejects a non-integer or negative baseline", () => {
    expect(() => marginalWeeklyPence(-1)).toThrow();
    expect(() => marginalWeeklyPence(1.5)).toThrow();
  });
});

describe("computeAddonAmounts", () => {
  it("charges nothing for zero days", () => {
    const amounts = computeAddonAmounts(0, 0);
    expect(amounts.netPence).toBe(0);
    expect(amounts.grossPence).toBe(0);
  });

  it("charges one week for seven days", () => {
    expect(computeAddonAmounts(0, 7).netPence).toBe(1000);
  });

  // The cross-check that matters: a vehicle added for a whole cycle must cost
  // exactly what the cycle charge would have cost for it. If these two ever
  // diverge, the add-on price and the invoice price disagree.
  it("charges a full cycle the same as the cycle charge for that vehicle", () => {
    const addon = computeAddonAmounts(0, CYCLE_DAYS);
    expect(addon.netPence).toBe(computeChargeAmounts(1).netPence);
    expect(addon.grossPence).toBe(computeChargeAmounts(1).grossPence);
  });

  it("charges the marginal band rate, not the first band rate", () => {
    // The 21st vehicle sits in the GBP 6 band.
    expect(computeAddonAmounts(20, CYCLE_DAYS).netPence).toBe(600 * 4);
  });

  it("rounds a part week to the nearest penny", () => {
    // 1000 * 27 / 7 = 3857.14...
    expect(computeAddonAmounts(0, 27).netPence).toBe(3857);
    // 800 * 3 / 7 = 342.857...
    expect(computeAddonAmounts(10, 3).netPence).toBe(343);
  });

  it("applies VAT at the standard rate", () => {
    const amounts = computeAddonAmounts(0, 7);
    expect(amounts.vatRate).toBe(VAT_RATE);
    expect(amounts.vatPence).toBe(200);
    expect(amounts.grossPence).toBe(1200);
  });

  it("reports the inputs it priced", () => {
    const amounts = computeAddonAmounts(4, 10);
    expect(amounts.baselineCount).toBe(4);
    expect(amounts.days).toBe(10);
    expect(amounts.marginalWeeklyPence).toBe(1000);
  });

  it("rejects a day count outside a single cycle", () => {
    expect(() => computeAddonAmounts(0, -1)).toThrow();
    expect(() => computeAddonAmounts(0, CYCLE_DAYS + 1)).toThrow();
    expect(() => computeAddonAmounts(0, 1.5)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/prorata.test.ts`
Expected: FAIL, cannot resolve `./prorata`.

- [ ] **Step 3: Write the implementation**

Create `lib/billing/prorata.ts`:

```ts
// Pro-rata pricing for a vehicle added part way through a billing cycle.
// Integer pence throughout, like money.ts. Nothing here touches the network
// or the DB.

import { VAT_RATE, weeklyNetPence } from "./money";
import { CYCLE_DAYS } from "./schedule";

// The cost of ONE more vehicle on top of a fleet of `baselineCount`.
//
// Bands are graduated, so this is NOT simply the rate of the band the new
// vehicle lands in read off PRICE_TIERS: it is the difference between the
// whole-fleet weekly price before and after. Deriving it from weeklyNetPence
// rather than walking PRICE_TIERS a second time is the same discipline that
// weeklyNetPence itself follows over tierBreakdown, and for the same reason:
// two copies of the pricing rules would eventually disagree, and the customer
// would be quoted one number and charged another.
export function marginalWeeklyPence(baselineCount: number): number {
  if (!Number.isInteger(baselineCount) || baselineCount < 0) {
    throw new Error(
      `baselineCount must be a non-negative integer, got ${baselineCount}`
    );
  }
  return weeklyNetPence(baselineCount + 1) - weeklyNetPence(baselineCount);
}

export type AddonAmounts = {
  /** Fleet size the new vehicle was priced on top of. */
  baselineCount: number;
  /** Weekly cost of this one extra vehicle, before VAT. */
  marginalWeeklyPence: number;
  /** Days of the current cycle this charge covers. */
  days: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  vatRate: number;
};

// Pro-rate the marginal weekly rate over the days left in the cycle. Never
// more than one cycle: a longer span would mean the caller computed the cycle
// boundary wrongly, and silently charging for it would overbill.
export function computeAddonAmounts(
  baselineCount: number,
  days: number
): AddonAmounts {
  if (!Number.isInteger(days) || days < 0 || days > CYCLE_DAYS) {
    throw new Error(
      `days must be an integer between 0 and ${CYCLE_DAYS}, got ${days}`
    );
  }
  const marginal = marginalWeeklyPence(baselineCount);
  const netPence = Math.round((marginal * days) / 7);
  const vatPence = Math.round((netPence * VAT_RATE) / 100);
  return {
    baselineCount,
    marginalWeeklyPence: marginal,
    days,
    netPence,
    vatPence,
    grossPence: netPence + vatPence,
    vatRate: VAT_RATE,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/prorata.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/prorata.ts lib/billing/prorata.test.ts
git commit -m "Add pro-rata pricing for mid-cycle vehicle additions"
```

---

### Task 3: Add-on idempotency key

**Files:**
- Modify: `lib/billing/money.ts`
- Test: `lib/billing/money.test.ts`

Square's `idempotency_key` allows at most 45 characters, which is why the existing `chargeIdempotencyKey` is compacted. The add-on key needs company, cycle, vehicle and attempt, which does not fit at full UUID width, so ids are truncated to 14 hex characters (56 bits) each.

The attempt number is essential and is not decoration: without it, a customer whose card is declined, who then fixes the card and tries again, would replay the same key and Square would hand back the original declined payment forever.

- [ ] **Step 1: Write the failing test**

Append to `lib/billing/money.test.ts`:

```ts
describe("addonIdempotencyKey", () => {
  const COMPANY = "3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6071";
  const VEHICLE = "8e7d6c5b-4a39-2817-0f6e-5d4c3b2a1908";

  it("fits inside Square's 45 character limit", () => {
    expect(
      addonIdempotencyKey(COMPANY, "2026-09-07", VEHICLE, 1).length
    ).toBeLessThanOrEqual(45);
    // Even a pathological attempt count must still fit.
    expect(
      addonIdempotencyKey(COMPANY, "2026-09-07", VEHICLE, 999).length
    ).toBeLessThanOrEqual(45);
  });

  it("is stable for the same inputs", () => {
    expect(addonIdempotencyKey(COMPANY, "2026-09-07", VEHICLE, 1)).toBe(
      addonIdempotencyKey(COMPANY, "2026-09-07", VEHICLE, 1)
    );
  });

  it("differs across vehicles, cycles and attempts", () => {
    const base = addonIdempotencyKey(COMPANY, "2026-09-07", VEHICLE, 1);
    expect(addonIdempotencyKey(COMPANY, "2026-10-05", VEHICLE, 1)).not.toBe(base);
    expect(
      addonIdempotencyKey(COMPANY, "2026-09-07", "11112222-3333-4444-5555-666677778888", 1)
    ).not.toBe(base);
    expect(addonIdempotencyKey(COMPANY, "2026-09-07", VEHICLE, 2)).not.toBe(base);
  });

  it("never collides with a cycle charge key", () => {
    expect(addonIdempotencyKey(COMPANY, "2026-09-07", VEHICLE, 1)).not.toBe(
      chargeIdempotencyKey(COMPANY, "2026-09-07", 1)
    );
  });
});
```

Add `addonIdempotencyKey` to the existing import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/money.test.ts`
Expected: FAIL, `addonIdempotencyKey is not a function`.

- [ ] **Step 3: Write the implementation**

In `lib/billing/money.ts`, directly after `chargeIdempotencyKey`:

```ts
// Idempotency key for a single mid-cycle vehicle add-on. Square allows 45
// characters, and company + cycle + vehicle + attempt does not fit at full
// UUID width, so the two ids are truncated to 14 hex characters (56 bits
// each). Truncation is safe here because the key only has to be unique within
// one Square account, not globally.
//
// The attempt number is load-bearing, not decoration. It gives two properties
// at once:
//
//   * A request that crashes after the Square call but before the audit row
//     is written recomputes the SAME attempt on retry, so it replays the same
//     key and Square deduplicates rather than charging twice.
//   * A customer who is declined, replaces their card and tries again gets a
//     NEW attempt and therefore a new key, so Square takes a real second
//     payment. Without the attempt in the key, that retry would be stuck
//     replaying the original decline forever.
//
// The `a` prefix keeps add-on keys in a different namespace from
// chargeIdempotencyKey, so a cycle charge and an add-on can never collide.
export function addonIdempotencyKey(
  companyId: string,
  cycleDate: string,
  vehicleId: string,
  attempt: number
): string {
  const compactCompany = companyId.replace(/-/g, "").slice(0, 14);
  const compactVehicle = vehicleId.replace(/-/g, "").slice(0, 14);
  const compactDate = cycleDate.replace(/-/g, "");
  return `a_${compactCompany}_${compactDate}_${compactVehicle}_${attempt}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/money.test.ts`
Expected: PASS. The longest key is `a_` + 14 + `_` + 8 + `_` + 14 + `_` + 3 = 44 characters.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/money.ts lib/billing/money.test.ts
git commit -m "Add an idempotency key for mid-cycle add-on charges"
```

---

### Task 4: The add-on decision function

**Files:**
- Create: `lib/billing/addon.ts`
- Test: `lib/billing/addon.test.ts`

This is the pure core: given the company's billing row, today's date and whether the vehicle is already covered, decide whether to charge, allow free, or block.

**The cycle date rule.** The cron charges *on* `next_charge_on` for the 28 days that follow, then advances `next_charge_on` by 28. So mid-cycle, the cycle that has already been paid for is `next_charge_on - CYCLE_DAYS`. That is the `cycle_date` a coverage row must carry. Using `next_charge_on` would file coverage against the *next* cycle, and the cron would then charge for the vehicle a second time.

- [ ] **Step 1: Write the failing test**

Create `lib/billing/addon.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectAddonAction } from "./addon";
import type { AddonBillingRow } from "./addon";

const TODAY = "2026-09-07";

// Charged on 2026-08-24, so the current cycle runs 2026-08-24 to 2026-09-21.
const ACTIVE: AddonBillingRow = {
  status: "active",
  next_charge_on: "2026-09-21",
};

function select(
  overrides: {
    billingRow?: AddonBillingRow | null;
    todayISO?: string;
    alreadyCovered?: boolean;
  } = {}
) {
  return selectAddonAction({
    billingRow: overrides.billingRow === undefined ? ACTIVE : overrides.billingRow,
    todayISO: overrides.todayISO ?? TODAY,
    alreadyCovered: overrides.alreadyCovered ?? false,
  });
}

describe("selectAddonAction", () => {
  it("charges for the days left in the current cycle", () => {
    expect(select()).toEqual({
      kind: "charge",
      cycleDate: "2026-08-24",
      days: 14,
    });
  });

  it("dates the charge to the cycle already paid for, not the next one", () => {
    const action = select();
    if (action.kind !== "charge") throw new Error("expected a charge");
    // 2026-09-21 is when the NEXT charge lands; the cycle being topped up
    // started 28 days earlier.
    expect(action.cycleDate).toBe("2026-08-24");
  });

  it("charges nearly a full cycle the day after a charge", () => {
    // Only "today" moves here. cycleDate is derived from next_charge_on
    // alone, so it stays 2026-08-24 no matter how far into the cycle we
    // are: anchoring the subtraction to today instead would be the
    // double-billing bug the cycle date rule exists to prevent.
    const action = select({ todayISO: "2026-08-25" });
    expect(action).toEqual({ kind: "charge", cycleDate: "2026-08-24", days: 27 });
  });

  it("is free when the vehicle is already covered for this cycle", () => {
    expect(select({ alreadyCovered: true })).toEqual({
      kind: "free",
      reason: "already_covered",
    });
  });

  // Coverage is only ever written by a real payment, so honouring it even for
  // a past_due company cannot be exploited: they paid for this vehicle in
  // this cycle already.
  it("honours existing coverage even when the company is past due", () => {
    expect(
      select({
        billingRow: { status: "past_due", next_charge_on: "2026-09-21" },
        alreadyCovered: true,
      })
    ).toEqual({ kind: "free", reason: "already_covered" });
  });

  it("is free when the company has no subscription at all", () => {
    expect(select({ billingRow: null })).toEqual({
      kind: "free",
      reason: "no_subscription",
    });
  });

  it("blocks a past due company", () => {
    expect(
      select({ billingRow: { status: "past_due", next_charge_on: "2026-09-21" } })
    ).toEqual({ kind: "blocked", reason: "past_due" });
  });

  it("blocks a canceled company", () => {
    expect(
      select({ billingRow: { status: "canceled", next_charge_on: "2026-09-21" } })
    ).toEqual({ kind: "blocked", reason: "canceled" });
  });

  // Between a cycle falling due and the cron running, next_charge_on is in
  // the past. The imminent cron run counts live vehicles, so it will pick
  // this one up at full price; recording coverage here would make it free for
  // a whole cycle.
  it("is free on the charge date, leaving the vehicle to the cron", () => {
    expect(select({ todayISO: "2026-09-21" })).toEqual({
      kind: "free",
      reason: "cycle_due",
    });
  });

  it("is free while a due charge has not yet run", () => {
    expect(select({ todayISO: "2026-09-23" })).toEqual({
      kind: "free",
      reason: "cycle_due",
    });
  });

  it("charges for one day on the last day of a cycle", () => {
    const action = select({ todayISO: "2026-09-20" });
    expect(action).toEqual({ kind: "charge", cycleDate: "2026-08-24", days: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/addon.test.ts`
Expected: FAIL, cannot resolve `./addon`.

- [ ] **Step 3: Write the implementation**

Create `lib/billing/addon.ts`:

```ts
// Pure decision core for a mid-cycle vehicle addition. The route loads rows,
// calls selectAddonAction, performs the Square charge, then writes coverage.
// Nothing here touches the network or the DB.

import { addDays, CYCLE_DAYS, daysBetween } from "./schedule";

export type AddonBillingRow = {
  status: "active" | "past_due" | "canceled";
  next_charge_on: string;
};

export type AddonAction =
  | { kind: "free"; reason: "already_covered" | "no_subscription" | "cycle_due" }
  | { kind: "blocked"; reason: "past_due" | "canceled" }
  | { kind: "charge"; cycleDate: string; days: number };

// The cycle a mid-cycle addition belongs to.
//
// The cron charges ON next_charge_on for the CYCLE_DAYS that follow, and only
// then advances next_charge_on by CYCLE_DAYS. So at any point between charges,
// the cycle that has been PAID FOR started CYCLE_DAYS before next_charge_on.
// Coverage rows must carry that date, not next_charge_on: filing them against
// next_charge_on would put them in the cycle the cron is about to charge, the
// cron would not see them as covered, and every add-on would be billed twice.
export function currentCycleDate(nextChargeOn: string): string {
  return addDays(nextChargeOn, -CYCLE_DAYS);
}

export function selectAddonAction(args: {
  billingRow: AddonBillingRow | null;
  todayISO: string;
  alreadyCovered: boolean;
}): AddonAction {
  // Checked before the status gate on purpose. Coverage is only ever written
  // by a payment that actually succeeded, so honouring it is not exploitable,
  // and blocking a past_due company from re-activating a vehicle it has
  // already paid for this cycle would be taking money for nothing.
  if (args.alreadyCovered) {
    return { kind: "free", reason: "already_covered" };
  }

  // No row means no subscription, so there is no cycle to pro-rate against.
  // The first 4-weekly charge after a card is added picks up the whole fleet.
  if (!args.billingRow) {
    return { kind: "free", reason: "no_subscription" };
  }

  // A dead or ended subscription must not be able to grow. Same reasoning as
  // blocking on decline: otherwise a company with a dead card adds unlimited
  // vehicles and the debt simply accrues.
  if (args.billingRow.status === "canceled") {
    return { kind: "blocked", reason: "canceled" };
  }
  if (args.billingRow.status === "past_due") {
    return { kind: "blocked", reason: "past_due" };
  }

  const days = daysBetween(args.todayISO, args.billingRow.next_charge_on);

  // The cycle charge is due or overdue and has not run yet. The imminent cron
  // run counts live vehicles, so it will bill this one at full price. Writing
  // coverage here would hand over a free cycle instead.
  if (days <= 0) {
    return { kind: "free", reason: "cycle_due" };
  }

  return {
    kind: "charge",
    cycleDate: currentCycleDate(args.billingRow.next_charge_on),
    days,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/addon.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/addon.ts lib/billing/addon.test.ts
git commit -m "Add the mid-cycle vehicle addition decision function"
```

---

### Task 5: Billable vehicle ids

**Files:**
- Modify: `lib/billing/vehicleCount.ts`
- Test: `lib/billing/vehicleCount.test.ts`

The cron needs the actual vehicle ids so it can write a coverage row per vehicle. `countBillableVehicles` becomes a one-line wrapper over the new id function rather than a second implementation, which is the rule that file's header comment already lays down: the cron and `/super-admin/billing` must agree on what a billable vehicle is, and there is one implementation.

- [ ] **Step 1: Write the failing test**

Append to `lib/billing/vehicleCount.test.ts`:

```ts
describe("billableVehicleIds", () => {
  it("returns the ids of actively licensed vehicles across the company's tenants", () => {
    const ids = billableVehicleIds({
      companyId: COMPANY,
      companyTenantIds: [TENANT_A, TENANT_B],
      vehicles: [
        { id: "v1", tenant_id: TENANT_A },
        { id: "v2", tenant_id: TENANT_B },
        { id: "v3", tenant_id: "other-tenant" },
        { id: "v4", tenant_id: TENANT_A },
      ],
      licences: [
        { vehicle_id: "v1", active: true },
        { vehicle_id: "v2", active: true },
        { vehicle_id: "v3", active: true },
        { vehicle_id: "v4", active: false },
      ],
    });
    expect(ids).toEqual(new Set(["v1", "v2"]));
  });

  it("returns an empty set when nothing is licensed", () => {
    expect(
      billableVehicleIds({
        companyId: COMPANY,
        companyTenantIds: [TENANT_A],
        vehicles: [{ id: "v1", tenant_id: TENANT_A }],
        licences: [{ vehicle_id: "v1", active: false }],
      })
    ).toEqual(new Set());
  });

  // The count must never be a second implementation of the rule.
  it("agrees with countBillableVehicles", () => {
    const args = {
      companyId: COMPANY,
      companyTenantIds: [TENANT_A],
      vehicles: [
        { id: "v1", tenant_id: TENANT_A },
        { id: "v2", tenant_id: COMPANY },
      ],
      licences: [
        { vehicle_id: "v1", active: true },
        { vehicle_id: "v2", active: true },
      ],
    };
    expect(billableVehicleIds(args).size).toBe(countBillableVehicles(args));
  });
});
```

Add `billableVehicleIds` to the existing import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/vehicleCount.test.ts`
Expected: FAIL, `billableVehicleIds is not a function`.

- [ ] **Step 3: Write the implementation**

In `lib/billing/vehicleCount.ts`, replace the body of `countBillableVehicles` with a wrapper and add the new function above it:

```ts
export function billableVehicleIds(args: {
  companyId: string;
  companyTenantIds: readonly string[];
  vehicles: readonly VehicleRow[];
  licences: readonly LicenceRow[];
}): Set<string> {
  const tenantIds = new Set(args.companyTenantIds);

  const companyVehicleIds = new Set(
    args.vehicles
      .filter(
        (v) =>
          v.tenant_id != null &&
          (tenantIds.has(v.tenant_id) || v.tenant_id === args.companyId)
      )
      .map((v) => v.id)
  );

  return new Set(
    args.licences
      .filter((l) => l.active && companyVehicleIds.has(l.vehicle_id))
      .map((l) => l.vehicle_id)
  );
}

// A thin wrapper on purpose. The cron needs the ids (to write coverage rows)
// and /super-admin/billing needs the count; deriving one from the other keeps
// a single definition of "billable", which is what this file exists to
// guarantee.
export function countBillableVehicles(args: {
  companyId: string;
  companyTenantIds: readonly string[];
  vehicles: readonly VehicleRow[];
  licences: readonly LicenceRow[];
}): number {
  return billableVehicleIds(args).size;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/vehicleCount.test.ts`
Expected: PASS, including all the pre-existing `countBillableVehicles` tests.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/vehicleCount.ts lib/billing/vehicleCount.test.ts
git commit -m "Expose billable vehicle ids alongside the count"
```

---

### Task 6: The database migration

**Files:**
- Create: `docs/sql/billing_03_mid_cycle_charges.sql`

There is no automated migration runner in this project. Files under `docs/sql/` are applied by hand in the Supabase SQL editor, in order, and must be safe to re-run. This one is split into two parts either side of the deploy, following the pattern set by `billing_02_four_weekly.sql`.

- [ ] **Step 1: Write the migration**

Create `docs/sql/billing_03_mid_cycle_charges.sql`:

```sql
-- billing_03: mid-cycle vehicle charges and paid-cycle coverage.
-- Apply manually in the Supabase SQL editor, like the rls_* and billing_*
-- series. Both steps are safe to re-run.
--
-- ORDER MATTERS. This touches live payment code.
--
--   1. Run STEP 1 (everything down to the STEP 2 banner) BEFORE deploying.
--   2. Deploy the code.
--   3. Soak, then run STEP 2.
--
-- Never run STEP 2 first. It revokes the browser's ability to write
-- vehicle_licences, and until the new code is live the licences page writes
-- that table directly: running it early breaks licence creation outright.
--
-- ROLLBACK. Between the deploy and STEP 2 the code reverts cleanly, because
-- everything in STEP 1 is additive and the old code never reads it. After
-- STEP 2, reverting the code breaks licence creation (the browser has no
-- insert grant), so a revert must re-grant first:
--
--   grant insert on public.vehicle_licences to authenticated;
--   grant update (active) on public.vehicle_licences to authenticated;

-- ===========================================================================
-- STEP 1: run BEFORE deploying the code.
-- ===========================================================================

-- One row per vehicle per cycle that has actually been paid for. This is what
-- makes billing a paid-coverage set rather than a snapshot taken on charge
-- day, and it is what stops a company deactivating its licences the night
-- before next_charge_on and reactivating them the morning after.
--
-- cycle_date is the date the cycle STARTED (the date the cron charged), not
-- the date the next charge lands. See currentCycleDate in lib/billing/addon.ts.
create table if not exists public.vehicle_cycle_coverage (
  company_id uuid not null references public.companies(id) on delete cascade,
  cycle_date date not null,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, cycle_date, vehicle_id)
);

create index if not exists vehicle_cycle_coverage_company_cycle_idx
  on public.vehicle_cycle_coverage (company_id, cycle_date);

-- Audit trail for mid-cycle add-on charges. Deliberately NOT folded into
-- platform_charges: that table is unique on (company_id, cycle_date, attempt),
-- which cannot hold several add-ons inside one cycle.
create table if not exists public.vehicle_addon_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  cycle_date date not null,
  attempt int not null check (attempt >= 1),
  covers_days int not null check (covers_days between 0 and 28),
  baseline_count int not null check (baseline_count >= 0),
  net_pence bigint not null,
  vat_pence bigint not null,
  gross_pence bigint not null,
  vat_rate numeric not null default 20.0,
  currency text not null default 'GBP',
  square_payment_id text,
  receipt_url text,
  status text not null check (status in ('succeeded', 'failed')),
  failure_code text,
  created_at timestamptz not null default now(),
  unique (company_id, cycle_date, vehicle_id, attempt)
);

create index if not exists vehicle_addon_charges_company_created_idx
  on public.vehicle_addon_charges (company_id, created_at desc);

alter table public.vehicle_cycle_coverage enable row level security;
alter table public.vehicle_addon_charges enable row level security;

-- Read policies mirror billing_01: company admins see their own company's
-- rows, super_admin sees all.
drop policy if exists vehicle_cycle_coverage_select on public.vehicle_cycle_coverage;
create policy vehicle_cycle_coverage_select on public.vehicle_cycle_coverage
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

drop policy if exists vehicle_addon_charges_select on public.vehicle_addon_charges;
create policy vehicle_addon_charges_select on public.vehicle_addon_charges
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

-- No INSERT/UPDATE/DELETE policies on purpose. All writes come from server
-- routes on the service role, which bypasses RLS. Belt and braces: revoke the
-- table grants too, matching billing_01 and rls_05_revoke_grants.sql.
revoke insert, update, delete on public.vehicle_cycle_coverage from authenticated, anon;
revoke insert, update, delete on public.vehicle_addon_charges from authenticated, anon;

-- Backfill coverage for every subscribed company's CURRENT cycle from the
-- live billable set.
--
-- Without this, every existing company's vehicles look uncovered on the day
-- the code deploys, and the first licence toggle after deploy charges the
-- customer again for a vehicle they have already paid for in this cycle.
--
-- The join mirrors countBillableVehicles exactly: a vehicle is the company's
-- when its tenant belongs to the company, OR when its tenant_id IS the
-- company id (rows written before tenants existed). There is no
-- vehicles.company_id column; do not add one to this query.
insert into public.vehicle_cycle_coverage (company_id, cycle_date, vehicle_id)
select distinct
  cb.company_id,
  cb.next_charge_on - 28,
  v.id
from public.company_billing cb
join public.vehicles v
  on v.tenant_id = cb.company_id
  or v.tenant_id in (
    select t.id from public.tenants t where t.company_id = cb.company_id
  )
where cb.status <> 'canceled'
  and exists (
    select 1
    from public.vehicle_licences vl
    where vl.vehicle_id = v.id
      and vl.active is true
  )
on conflict do nothing;

-- ===========================================================================
-- STEP 2: run AFTER the code is deployed and has soaked.
-- ===========================================================================
--
-- This is the actual enforcement. A server route alone would be bypassable
-- with a raw supabase-js call from devtools using the user's own token, which
-- is exactly the hole being closed.
--
-- `active` is the only column on this table that costs money, so ordinary
-- edits (expiry date, notes, licence type) must keep working straight from
-- the browser. Precedent for a column-level guard:
-- docs/sql/profiles_privileged_columns_guard.sql.
--
-- This has to be a full revoke followed by per-column grants, NOT a bare
-- `revoke update (active)`. Postgres holds table-level and column-level
-- privileges separately and allows a write when EITHER of them permits it, so
-- a column-level revoke against a role that still holds the table-level UPDATE
-- grant (which is exactly what Supabase's default grants give authenticated)
-- takes nothing away and leaves the exploit wide open.
--
-- DELETE is deliberately left alone. Removing a licence never creates
-- billable state, and coverage means a delete-then-reinsert inside one cycle
-- is free anyway.
revoke insert on public.vehicle_licences from authenticated, anon;
revoke update on public.vehicle_licences from authenticated, anon;

-- Generated rather than typed out, so this stays correct as the table gains
-- columns and a re-run does not leave a new column unwritable.
do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'vehicle_licences'
    and column_name <> 'active';

  if cols is not null then
    execute format('grant update (%s) on public.vehicle_licences to authenticated', cols);
  end if;
end $$;
```

- [ ] **Step 2: Verify the backfill query parses**

There is no local Postgres, so this is a read-through rather than an execution. Confirm by eye that:
- `get_my_role()` and `get_my_company_id()` are used exactly as `billing_01_platform_billing.sql` uses them;
- the backfill's tenant matching is character-for-character the same rule as `billableVehicleIds` in `lib/billing/vehicleCount.ts`;
- the backfill files coverage under `next_charge_on - 28`, matching `currentCycleDate` in `lib/billing/addon.ts`.

Note that `docs/sql/schema_rls_dump.sql` is **not** a schema dump despite the name: it is a
`select jsonb_pretty(...)` introspection query you run in the SQL editor to produce one. Do not
try to grep table definitions out of it; there are none.

The foreign keys assume `vehicles.id` and `companies.id` are `uuid`. `companies.id` is certain
(`billing_01` already declares a `uuid` reference to it and is applied in production).
`vehicles.id` should be confirmed in the SQL editor before applying:

```sql
select data_type from information_schema.columns
where table_name = 'vehicles' and column_name = 'id';
```

A mismatch fails loudly at apply time and creates nothing, so it is safe to find out this way.

- [ ] **Step 3: Commit**

```bash
git add docs/sql/billing_03_mid_cycle_charges.sql
git commit -m "Add the mid-cycle billing migration"
```

---

### Task 7: The cron writes coverage rows

**Files:**
- Modify: `lib/billing/server.ts`

`fetchBillableVehicleCount` becomes `fetchBillableVehicles` and returns the id set. `runChargeCycle` then writes one coverage row per counted vehicle after a successful charge. Without this the cron would never populate coverage, and every vehicle would look uncovered forever.

- [ ] **Step 1: Rename the fetch function to return ids**

In `lib/billing/server.ts`, change the signature and the final return of `fetchBillableVehicleCount`:

```ts
export async function fetchBillableVehicles(
  admin: SupabaseClient,
  companyId: string
): Promise<Set<string>> {
```

Change the early return for an empty fleet from `return 0;` to:

```ts
  if (vehicleIds.length === 0) {
    return new Set();
  }
```

And change the final `return countBillableVehicles({...})` to:

```ts
  return billableVehicleIds({
    companyId,
    companyTenantIds: tenantIds,
    vehicles,
    licences,
  });
```

Update the import at the top of the file:

```ts
import { billableVehicleIds } from "./vehicleCount";
```

- [ ] **Step 2: Update `runChargeCycle` to use the set and write coverage**

In `runChargeCycle`, replace:

```ts
  const vehicleCount = await fetchBillableVehicleCount(admin, args.companyId);
  const amounts = computeChargeAmounts(vehicleCount);
```

with:

```ts
  const vehicleIds = await fetchBillableVehicles(admin, args.companyId);
  const vehicleCount = vehicleIds.size;
  const amounts = computeChargeAmounts(vehicleCount);
```

Then, immediately after the `platform_charges` insert and its `23505` handling, and before the final `return`, add:

```ts
  // Record which vehicles this cycle has now paid for. Written only on
  // success: a failed charge covers nothing, and the retry will recount.
  //
  // Upsert with ignoreDuplicates so a crashed-and-rerun cycle is idempotent,
  // and so a vehicle already covered by a mid-cycle add-on charge is left
  // alone rather than erroring the whole run.
  //
  // A failure here is logged, not thrown: the card has already been charged
  // and the audit row written, so throwing would leave the caller believing
  // the cycle did not happen and retrying a charge that already succeeded.
  // Missing coverage is self-correcting, because the next cycle rewrites it.
  if (succeeded && vehicleCount > 0) {
    const { error: coverageError } = await admin
      .from("vehicle_cycle_coverage")
      .upsert(
        [...vehicleIds].map((vehicleId) => ({
          company_id: args.companyId,
          cycle_date: args.cycleDate,
          vehicle_id: vehicleId,
        })),
        { onConflict: "company_id,cycle_date,vehicle_id", ignoreDuplicates: true }
      );
    if (coverageError) {
      console.error(
        `billing: coverage write failed for company ${args.companyId} cycle ${args.cycleDate}:`,
        coverageError.message
      );
    }
  }
```

- [ ] **Step 3: Find and fix every remaining caller**

Run: `grep -rn "fetchBillableVehicleCount" --include=*.ts --include=*.tsx app lib`
Expected: no results. If any remain, change them to `fetchBillableVehicles(...)` and read `.size`.

- [ ] **Step 4: Verify types and tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/server.ts
git commit -m "Record paid-cycle coverage when the cron charges a company"
```

---

### Task 8: Add-on charge orchestration

**Files:**
- Create: `lib/billing/addonServer.ts`

The server-side twin of `runChargeCycle`, for a single vehicle. It deliberately mirrors that function's structure, including the prior-success check, the `IDEMPOTENCY_KEY_REUSED` handling and the indeterminate-status guard, because those three behaviours are what keep a crash from double-charging a customer.

- [ ] **Step 1: Write the implementation**

Create `lib/billing/addonServer.ts`:

```ts
// Server-only orchestration for ONE mid-cycle vehicle add-on charge.
// Deliberately mirrors runChargeCycle in ./server.ts: the prior-success
// check, the IDEMPOTENCY_KEY_REUSED handling and the indeterminate-status
// guard are what stop a crash or a retry from charging a customer twice, and
// they must not diverge between the two paths.

import type { SupabaseClient } from "@supabase/supabase-js";
import { SquareError } from "square";
import { getSquare, getSquareLocationId } from "../payments/square";
import { addonIdempotencyKey, classifyPaymentResult } from "./money";
import { computeAddonAmounts } from "./prorata";

export type AddonChargeResult = {
  companyId: string;
  vehicleId: string;
  cycleDate: string;
  attempt: number;
  days: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  succeeded: boolean;
  failureCode: string | null;
  squarePaymentId: string | null;
  receiptUrl: string | null;
  alreadyPaid: boolean;
};

function extractSquareFailureCode(error: unknown): string {
  if (error instanceof SquareError) {
    return error.errors[0]?.code ?? error.message.slice(0, 120);
  }
  const maybe = error as { message?: string };
  return maybe?.message ? maybe.message.slice(0, 120) : "UNKNOWN";
}

// Charges the card for one vehicle's share of the rest of the cycle, records
// the audit row, and writes the coverage row that makes the vehicle legal for
// this cycle.
//
// Throws PAYMENT_INDETERMINATE when Square's answer is not terminal. The
// caller must translate that into "try again shortly" and must NOT activate
// the licence: recording a success would be a lie, and recording a failure
// would let a later-completing payment charge the customer twice.
export async function chargeVehicleAddon(
  admin: SupabaseClient,
  args: {
    companyId: string;
    vehicleId: string;
    cycleDate: string;
    days: number;
    baselineCount: number;
    squareCustomerId: string;
    squareCardId: string;
  }
): Promise<AddonChargeResult> {
  // Has this vehicle already been paid for in this cycle by an earlier
  // attempt that crashed before writing coverage? Same guard as
  // runChargeCycle's prior-success check, and for the same reason.
  const { data: priorRows, error: priorError } = await admin
    .from("vehicle_addon_charges")
    .select("attempt, covers_days, net_pence, vat_pence, gross_pence, square_payment_id, receipt_url")
    .eq("company_id", args.companyId)
    .eq("cycle_date", args.cycleDate)
    .eq("vehicle_id", args.vehicleId)
    .eq("status", "succeeded")
    .order("attempt", { ascending: false })
    .limit(1);

  if (priorError) {
    throw new Error(`Unable to check for a prior charge: ${priorError.message}`);
  }

  const prior = priorRows?.[0];
  if (prior) {
    await writeCoverage(admin, args.companyId, args.cycleDate, args.vehicleId);
    return {
      companyId: args.companyId,
      vehicleId: args.vehicleId,
      cycleDate: args.cycleDate,
      attempt: Number(prior.attempt),
      days: Number(prior.covers_days),
      netPence: Number(prior.net_pence),
      vatPence: Number(prior.vat_pence),
      grossPence: Number(prior.gross_pence),
      succeeded: true,
      failureCode: null,
      squarePaymentId: prior.square_payment_id ?? null,
      receiptUrl: prior.receipt_url ?? null,
      alreadyPaid: true,
    };
  }

  // Attempt number comes from the audit trail, never hardcoded. A declined
  // attempt has already spent its idempotency key, so reusing it for a retry
  // under a different card would send a new request body under the same key,
  // which Square rejects as IDEMPOTENCY_KEY_REUSED. Failed attempts count for
  // exactly that reason. Same derivation as the first-time charge in
  // app/api/billing/card/route.ts.
  const { data: attemptRows, error: attemptError } = await admin
    .from("vehicle_addon_charges")
    .select("attempt")
    .eq("company_id", args.companyId)
    .eq("cycle_date", args.cycleDate)
    .eq("vehicle_id", args.vehicleId)
    .order("attempt", { ascending: false })
    .limit(1);

  if (attemptError) {
    throw new Error(attemptError.message);
  }

  const attempt = Number(attemptRows?.[0]?.attempt ?? 0) + 1;
  const amounts = computeAddonAmounts(args.baselineCount, args.days);

  let succeeded = true;
  let failureCode: string | null = null;
  let squarePaymentId: string | null = null;
  let receiptUrl: string | null = null;

  if (amounts.grossPence > 0) {
    let payment: { id?: string; receiptUrl?: string; status?: string } | undefined;
    let callThrew = false;

    try {
      const square = getSquare();
      const response = await square.payments.create({
        idempotencyKey: addonIdempotencyKey(
          args.companyId,
          args.cycleDate,
          args.vehicleId,
          attempt
        ),
        sourceId: args.squareCardId,
        customerId: args.squareCustomerId,
        locationId: getSquareLocationId(),
        amountMoney: {
          amount: BigInt(amounts.grossPence),
          currency: "GBP",
        },
        note: `TMS Wizzard vehicle added mid-cycle ${args.cycleDate}: ${args.days} days`,
      });
      payment = response.payment;
    } catch (error) {
      if (
        error instanceof SquareError &&
        error.errors[0]?.code === "IDEMPOTENCY_KEY_REUSED"
      ) {
        throw new Error(
          `PAYMENT_INDETERMINATE: idempotency key already used for company ${args.companyId} vehicle ${args.vehicleId} cycle ${args.cycleDate} attempt ${attempt}; a payment exists with unknown outcome, try again later`
        );
      }
      callThrew = true;
      succeeded = false;
      failureCode = extractSquareFailureCode(error);
    }

    // Outside the try/catch on purpose: the catch only sees network and SDK
    // failures. A call that succeeded but returned a non-terminal status must
    // throw HERE, before the audit insert, so nothing is recorded.
    if (!callThrew) {
      squarePaymentId = payment?.id ?? null;
      receiptUrl = payment?.receiptUrl ?? null;

      const classification = classifyPaymentResult(payment);
      if (classification.kind === "indeterminate") {
        throw new Error(
          "PAYMENT_INDETERMINATE: payment " +
            (squarePaymentId ?? "unknown") +
            " has status " +
            classification.status +
            "; no outcome recorded, try again shortly"
        );
      }

      succeeded = classification.kind === "succeeded";
      failureCode =
        classification.kind === "failed" ? classification.failureCode : null;
    }
  }

  const { error: insertError } = await admin.from("vehicle_addon_charges").insert({
    company_id: args.companyId,
    vehicle_id: args.vehicleId,
    cycle_date: args.cycleDate,
    attempt,
    covers_days: amounts.days,
    baseline_count: amounts.baselineCount,
    net_pence: amounts.netPence,
    vat_pence: amounts.vatPence,
    gross_pence: amounts.grossPence,
    vat_rate: amounts.vatRate,
    currency: "GBP",
    square_payment_id: squarePaymentId,
    receipt_url: receiptUrl,
    status: succeeded ? "succeeded" : "failed",
    failure_code: failureCode,
  });

  // 23505 = unique_violation. A rerun after a crash reuses the same
  // idempotency key, so Square returns the SAME payment and the recomputed
  // outcome matches the row already recorded: already-recorded, not an error.
  if (insertError && insertError.code !== "23505") {
    throw new Error(
      `Charge recorded at Square but vehicle_addon_charges insert failed: ${insertError.message}`
    );
  }

  if (succeeded) {
    await writeCoverage(admin, args.companyId, args.cycleDate, args.vehicleId);
  }

  return {
    companyId: args.companyId,
    vehicleId: args.vehicleId,
    cycleDate: args.cycleDate,
    attempt,
    days: amounts.days,
    netPence: amounts.netPence,
    vatPence: amounts.vatPence,
    grossPence: amounts.grossPence,
    succeeded,
    failureCode,
    squarePaymentId,
    receiptUrl,
    alreadyPaid: false,
  };
}

// Coverage is what makes the vehicle legal for this cycle, so a failure here
// must be loud: silently skipping it would leave the customer charged for a
// vehicle the next add would charge them for all over again.
export async function writeCoverage(
  admin: SupabaseClient,
  companyId: string,
  cycleDate: string,
  vehicleId: string
): Promise<void> {
  const { error } = await admin
    .from("vehicle_cycle_coverage")
    .upsert(
      { company_id: companyId, cycle_date: cycleDate, vehicle_id: vehicleId },
      { onConflict: "company_id,cycle_date,vehicle_id", ignoreDuplicates: true }
    );
  if (error) {
    throw new Error(`Coverage could not be recorded: ${error.message}`);
  }
}
```

- [ ] **Step 2: Verify types**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/billing/addonServer.ts
git commit -m "Add server orchestration for a mid-cycle add-on charge"
```

---

### Task 9: The licence activation route

**Files:**
- Create: `app/api/licences/activate/route.ts`

The only path by which `vehicle_licences.active` may be written once STEP 2 of the migration has run. It handles deactivation as well as activation, because the column-level revoke blocks the browser from writing `active` in either direction.

**Ordering rule: charge first, write the licence last.** A decline must leave no active licence behind, because the entire scheme rests on "active licence implies paid for this cycle". If the charge succeeds and the licence write then fails, the company has paid for a vehicle that is not active; the coverage row is already written, so their retry is free. That is the safe direction to fail in.

- [ ] **Step 1: Write the implementation**

Create `app/api/licences/activate/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/accounts/server";
import {
  fetchBillableVehicles,
  requireCompanyAdmin,
} from "../../../../lib/billing/server";
import { chargeVehicleAddon } from "../../../../lib/billing/addonServer";
import { currentCycleDate, selectAddonAction } from "../../../../lib/billing/addon";
import type { AddonBillingRow } from "../../../../lib/billing/addon";
import { londonDateISO } from "../../../../lib/billing/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  action: z.literal("create"),
  tenantId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  licenceType: z.string().min(1),
  issueDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  active: z.boolean(),
  notes: z.string().nullable(),
});

const SetActiveSchema = z.object({
  action: z.literal("setActive"),
  licenceId: z.string().uuid(),
  active: z.boolean(),
});

const BodySchema = z.discriminatedUnion("action", [CreateSchema, SetActiveSchema]);

// Every blocked reason needs its own line here. A missing key would render
// `undefined` to a customer who has just been refused a charge, which is the
// worst moment for a blank error.
const BLOCKED_MESSAGE: Record<
  "past_due" | "canceled" | "dunning" | "inactive_subscription",
  string
> = {
  past_due:
    "Your subscription is past due, so vehicles cannot be added. Update your payment card on the billing page and try again.",
  canceled:
    "Your subscription has been canceled, so vehicles cannot be added. Contact support to reactivate it.",
  dunning:
    "A payment on your account has failed and is being retried, so vehicles cannot be added until it clears. Update your payment card on the billing page.",
  inactive_subscription:
    "Your subscription is not active, so vehicles cannot be added. Contact support.",
};

// Every tenant under the caller's company, plus the company id itself.
// Vehicles keyed straight to a company id predate tenants; this mirrors
// billableVehicleIds and fetchBillableVehicles exactly. There is no
// vehicles.company_id column, so do not filter on one.
async function companyTenantScope(
  admin: Awaited<ReturnType<typeof requireCompanyAdmin>>["admin"],
  companyId: string
): Promise<string[]> {
  const { data, error } = await admin
    .from("tenants")
    .select("id")
    .eq("company_id", companyId);
  if (error) {
    throw new Error(error.message);
  }
  return [...(data ?? []).map((t) => t.id as string), companyId];
}

export async function POST(request: NextRequest) {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const { admin, companyId } = await requireCompanyAdmin();
    const scope = await companyTenantScope(admin, companyId);

    // Resolve which vehicle this touches, and prove it belongs to the
    // caller's company. requireCompanyAdmin authenticates the caller but says
    // nothing about the vehicle, so without this an admin of company A could
    // activate a licence on company B's vehicle and charge A's card for it.
    let vehicleId: string;
    if (body.action === "create") {
      if (!scope.includes(body.tenantId)) {
        return NextResponse.json(
          { error: "That tenant does not belong to your company." },
          { status: 403 }
        );
      }
      vehicleId = body.vehicleId;
    } else {
      const { data: licence, error: licenceError } = await admin
        .from("vehicle_licences")
        .select("id, vehicle_id")
        .eq("id", body.licenceId)
        .maybeSingle();
      if (licenceError) {
        throw new Error(licenceError.message);
      }
      if (!licence) {
        return NextResponse.json({ error: "Licence not found." }, { status: 404 });
      }
      vehicleId = licence.vehicle_id as string;
    }

    const { data: vehicle, error: vehicleError } = await admin
      .from("vehicles")
      .select("id, tenant_id")
      .eq("id", vehicleId)
      .maybeSingle();
    if (vehicleError) {
      throw new Error(vehicleError.message);
    }
    if (!vehicle || !scope.includes(vehicle.tenant_id as string)) {
      return NextResponse.json(
        { error: "That vehicle does not belong to your company." },
        { status: 403 }
      );
    }

    // Deactivating, or creating an already-inactive licence, costs nothing.
    // Removals get no refund and no credit: the vehicle simply stops being
    // counted at the next cycle charge.
    const wantsActive = body.active;
    if (!wantsActive) {
      return await writeLicence(admin, body, companyId, {
        charged: false,
        reason: "inactive",
      });
    }

    const billableIds = await fetchBillableVehicles(admin, companyId);

    // The vehicle is already billable, so it already has an active licence,
    // so it has already been paid for. A second licence on the same vehicle
    // adds nothing to the bill and must not be charged for.
    if (billableIds.has(vehicleId)) {
      return await writeLicence(admin, body, companyId, {
        charged: false,
        reason: "already_billable",
      });
    }

    const { data: billingRaw, error: billingError } = await admin
      .from("company_billing")
      // retry_at is load-bearing, not incidental: a company mid-dunning has
      // status "active" with next_charge_on in the past, so without it the
      // decision function cannot tell a healthy subscription from a failing
      // card and would let vehicles be added free.
      .select("status, next_charge_on, retry_at, square_customer_id, square_card_id")
      .eq("company_id", companyId)
      .maybeSingle();
    if (billingError) {
      throw new Error(billingError.message);
    }

    const billingRow: AddonBillingRow | null = billingRaw
      ? {
          status: billingRaw.status as AddonBillingRow["status"],
          next_charge_on: billingRaw.next_charge_on as string,
          retry_at: (billingRaw.retry_at as string | null) ?? null,
        }
      : null;

    const cycleDate = billingRow
      ? currentCycleDate(billingRow.next_charge_on)
      : null;

    let alreadyCovered = false;
    if (cycleDate) {
      const { data: coverage, error: coverageError } = await admin
        .from("vehicle_cycle_coverage")
        .select("vehicle_id")
        .eq("company_id", companyId)
        .eq("cycle_date", cycleDate)
        .eq("vehicle_id", vehicleId)
        .maybeSingle();
      if (coverageError) {
        throw new Error(coverageError.message);
      }
      alreadyCovered = Boolean(coverage);
    }

    const action = selectAddonAction({
      billingRow,
      todayISO: londonDateISO(new Date()),
      alreadyCovered,
    });

    if (action.kind === "blocked") {
      return NextResponse.json(
        { error: BLOCKED_MESSAGE[action.reason], reason: action.reason },
        { status: 402 }
      );
    }

    if (action.kind === "free") {
      return await writeLicence(admin, body, companyId, {
        charged: false,
        reason: action.reason,
      });
    }

    // Price the new vehicle on top of whichever fleet size is larger: the
    // live billable count, or the number of vehicles this cycle has paid for.
    // Live alone would let a company deactivate vehicles to drop into a
    // cheaper band before adding one, which is a quieter version of the very
    // exploit this feature closes. Coverage alone would misprice a company
    // that has grown since its last cycle charge.
    const { count: coveredCount, error: countError } = await admin
      .from("vehicle_cycle_coverage")
      .select("vehicle_id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("cycle_date", action.cycleDate);
    if (countError) {
      throw new Error(countError.message);
    }
    const baselineCount = Math.max(billableIds.size, coveredCount ?? 0);

    let result;
    try {
      result = await chargeVehicleAddon(admin, {
        companyId,
        vehicleId,
        cycleDate: action.cycleDate,
        days: action.days,
        baselineCount,
        squareCustomerId: billingRaw!.square_customer_id as string,
        squareCardId: billingRaw!.square_card_id as string,
      });
    } catch (chargeError) {
      if (
        chargeError instanceof Error &&
        chargeError.message.startsWith("PAYMENT_INDETERMINATE")
      ) {
        return NextResponse.json(
          {
            error:
              "A payment for this vehicle is still settling with Square. Please wait a few minutes and try again.",
          },
          { status: 409 }
        );
      }
      throw chargeError;
    }

    if (!result.succeeded) {
      return NextResponse.json(
        {
          error:
            "Your card was declined, so the vehicle was not added. Update your payment card on the billing page and try again.",
          failureCode: result.failureCode,
        },
        { status: 402 }
      );
    }

    return await writeLicence(admin, body, companyId, {
      charged: true,
      reason: "charged",
      grossPence: result.grossPence,
      days: result.days,
      receiptUrl: result.receiptUrl,
    });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

// The licence write itself, always last. See the ordering rule at the top of
// this file: nothing may make a licence active before the money is in.
async function writeLicence(
  admin: Awaited<ReturnType<typeof requireCompanyAdmin>>["admin"],
  body: z.infer<typeof BodySchema>,
  companyId: string,
  billing: {
    charged: boolean;
    reason: string;
    grossPence?: number;
    days?: number;
    receiptUrl?: string | null;
  }
) {
  if (body.action === "create") {
    const { error } = await admin.from("vehicle_licences").insert({
      tenant_id: body.tenantId,
      vehicle_id: body.vehicleId,
      licence_type: body.licenceType,
      issue_date: body.issueDate,
      expiry_date: body.expiryDate,
      active: body.active,
      notes: body.notes,
    });
    if (error) {
      throw new Error(error.message);
    }
  } else {
    const { error } = await admin
      .from("vehicle_licences")
      .update({ active: body.active })
      .eq("id", body.licenceId);
    if (error) {
      throw new Error(error.message);
    }
  }

  return NextResponse.json({ ok: true, companyId, ...billing });
}
```

- [ ] **Step 2: Verify types**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/licences/activate/route.ts
git commit -m "Add the licence activation route that charges mid-cycle additions"
```

---

### Task 10: Point the licences page at the route

**Files:**
- Modify: `app/settings/licences/page.tsx:143-215`

Once STEP 2 of the migration runs, the direct writes on this page stop working. Both write paths move to the route.

- [ ] **Step 1: Replace `createLicence`**

Replace the whole `createLicence` function with:

```tsx
    async function createLicence(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setMessage("");

        if (!vehicleId) {
            setMessage("Please select a vehicle.");
            return;
        }

        if (!licenceType.trim()) {
            setMessage("Please enter a licence type.");
            return;
        }

        if (!tenant.writeTenantId) {
            setMessage("Pick a specific tenant to create records.");
            return;
        }

        setSaving(true);

        /* Through the route, never straight to the table: an active licence
           is a billable vehicle, and billing_03 revokes the browser's grant
           on vehicle_licences.active for exactly that reason. */
        const response = await fetch("/api/licences/activate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "create",
                tenantId: tenant.writeTenantId,
                vehicleId,
                licenceType: licenceType.trim(),
                issueDate: issueDate || null,
                expiryDate: expiryDate || null,
                active,
                notes: notes.trim() || null,
            }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            setMessage(payload.error ?? "Unable to add the licence.");
            setSaving(false);
            return;
        }

        resetForm();
        setMessage(licenceAddedMessage(payload));
        setSaving(false);
        await loadData();
    }
```

- [ ] **Step 2: Replace `toggleLicence`**

Replace the whole `toggleLicence` function with:

```tsx
    async function toggleLicence(id: string, currentActive: boolean | null) {
        setMessage("");

        const nextActive = !currentActive;

        const response = await fetch("/api/licences/activate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "setActive",
                licenceId: id,
                active: nextActive,
            }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            setMessage(payload.error ?? "Unable to update the licence.");
            return;
        }

        setMessage(
            nextActive ? licenceAddedMessage(payload, "Licence activated.") : "Licence deactivated."
        );
        await loadData();
    }
```

- [ ] **Step 3: Add the message helper**

Directly above `export default function VehicleLicencesPage()`, add:

```tsx
/* A mid-cycle activation can take money, so say so rather than reporting a
   silent "Licence added." A customer who is charged without being told will
   read it as a surprise charge. */
function licenceAddedMessage(
    payload: { charged?: boolean; grossPence?: number; days?: number },
    base = "Licence added."
): string {
    if (!payload.charged || payload.grossPence == null || payload.days == null) {
        return base;
    }
    return `${base} Charged ${formatPence(payload.grossPence)} for the ${payload.days} days left in this billing cycle.`;
}
```

`formatPence` is already imported at the top of this file.

- [ ] **Step 4: Verify types and build**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/settings/licences/page.tsx
git commit -m "Route licence activation through the billing-aware API"
```

---

### Task 11: Show add-on charges in the billing history

**Files:**
- Modify: `app/settings/billing/page.tsx`

A customer who is charged mid-cycle must be able to see what for, otherwise the first support ticket is "what is this GBP 38.57 charge".

- [ ] **Step 1: Add the query**

In the `Promise.all` inside `load`, add a fourth query after the `vehicle_licences` one:

```ts
        /* Company-wide, like the platform_charges query above: RLS scopes it
           to the admin's own company. */
        supabase
          .from("vehicle_addon_charges")
          .select("*, vehicles(registration)")
          .order("created_at", { ascending: false })
          .limit(24),
```

Change the destructuring to `const [billingRes, chargesRes, licencesRes, addonRes] = await Promise.all([...])`.

Then extend the error handling. `LoadError` has one flag per region so each region withholds only what it cannot vouch for, and an add-on failure is a charge-history failure:

```ts
      const firstError =
        billingRes.error ?? chargesRes.error ?? licencesRes.error ?? addonRes.error;
```

and in the `setLoadError` object:

```ts
              charges: Boolean(chargesRes.error || addonRes.error),
```

- [ ] **Step 2: Merge the two lists**

Charge history rows are rendered from the `charges` state. Normalise add-ons into the same shape rather than adding a second list, so the history stays one chronological sequence:

```ts
      const addonCharges: ChargeRow[] = (addonRes.data ?? []).map((row: Record<string, unknown>) => ({
        ...(row as object),
        /* The history renders vehicle_count; an add-on always covers exactly
           one vehicle. The label below is what actually explains the row. */
        vehicle_count: 1,
        addon_label: `${
          (row.vehicles as { registration?: string } | null)?.registration ?? "Vehicle"
        }, ${row.covers_days} days mid-cycle`,
      })) as ChargeRow[];

      setCharges(
        [...((chargesRes.data as ChargeRow[] | null) ?? []), ...addonCharges].sort(
          (a, b) => String(b.created_at).localeCompare(String(a.created_at))
        )
      );
```

Remove the old `setCharges((chargesRes.data as ChargeRow[] | null) ?? []);` line.

- [ ] **Step 3: Widen the `ChargeRow` type**

In the `ChargeRow` type at `app/settings/billing/page.tsx:22-32`, add a final field:

```ts
  /* Present only on rows merged in from vehicle_addon_charges. A cycle charge
     leaves it undefined, which is what the Billing date column keys off. */
  addon_label?: string;
```

- [ ] **Step 4: Render the label in the Billing date column**

The history is a `DataTable` driven by `CHARGE_COLUMNS` at `app/settings/billing/page.tsx:45`. Replace the first column definition:

```tsx
  {
    header: "Billing date",
    cell: (c) => <span className="font-mono">{formatCycleDate(c.cycle_date)}</span>,
  },
```

with:

```tsx
  {
    header: "Billing date",
    cell: (c) => (
      <span className="flex flex-col">
        <span className="font-mono">{formatCycleDate(c.cycle_date)}</span>
        {/* Only add-on rows carry a label. Without it a mid-cycle charge is
            indistinguishable from a cycle charge for one vehicle, which is
            precisely the row a customer will query. */}
        {c.addon_label ? (
          <span className="text-xs text-ink-3">{c.addon_label}</span>
        ) : null}
      </span>
    ),
  },
```

- [ ] **Step 5: Verify types**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/settings/billing/page.tsx
git commit -m "Show mid-cycle add-on charges in the billing history"
```

---

### Task 12: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

`README.md` is the source of truth for the page inventory, integrations and migration list, and `CLAUDE.md` explicitly says to keep it in sync.

- [ ] **Step 1: Update `README.md`**

In the route list under the project structure section, add `api/licences/activate` alongside the existing `billing/run` and `billing/card` entries.

In the `docs/sql` line, extend the migration list to mention `billing_03_mid_cycle_charges.sql`.

In the Square integration bullet, add a sentence:

```
Adding a vehicle part way through a cycle charges the card immediately, pro-rata at the marginal band rate, through `/api/licences/activate`; `vehicle_cycle_coverage` records which vehicles each cycle has paid for, so deactivating a licence before the charge date and reactivating it after no longer avoids the bill.
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the tenancy section, after the POD storage bullet, add:

```
- `vehicle_licences.active` is **server-only**. `billing_03_mid_cycle_charges.sql` revokes the client's
  insert and `update (active)` grants, because an active licence is a billable vehicle: activation goes
  through `POST /api/licences/activate`, which charges pro-rata for the rest of the cycle first and only
  then writes the row. Other columns on that table are still client-writable. Never reintroduce a direct
  client write to `active`.
```

- [ ] **Step 3: Run the full verification gate**

Run: `npm test`
Expected: all suites pass, including the timezone-sensitive ones.

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds, and the route list includes `/api/licences/activate`.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document mid-cycle vehicle billing"
```

---

## Manual verification, after deploy

None of this is covered by vitest, because vitest only runs `lib/`. Run against the Square **sandbox**, signed in as a company admin.

Note that `.env.local` points at the LIVE Supabase, so a local run writes production data. Use a throwaway test company.

1. Apply STEP 1 of `billing_03_mid_cycle_charges.sql`, then deploy.
2. Confirm the backfill worked: `select count(*) from vehicle_cycle_coverage;` should be non-zero and match the current billable fleet across subscribed companies.
3. On `/settings/licences`, add an active licence to an unlicensed vehicle. Expect a success message naming the amount and the days covered, a new `vehicle_addon_charges` row with `status = 'succeeded'`, a new `vehicle_cycle_coverage` row, and the charge visible in `/settings/billing` history.
4. Deactivate that licence, then reactivate it. Expect **no** second charge, because coverage already exists. This is the exploit, closed.
5. Add a second licence to the same vehicle. Expect no charge.
6. Point the company at a declining sandbox card, then add a licence to another vehicle. Expect a 402, an error naming the decline, a `vehicle_addon_charges` row with `status = 'failed'`, **no** coverage row, and **no** active licence.
7. Fix the card and retry the same vehicle. Expect a successful charge at attempt 2, not a replayed decline.
8. Run STEP 2 of the migration. Repeat step 3 and confirm it still works, then confirm from devtools that
   `supabase.from("vehicle_licences").update({ active: true }).eq("id", ...)` is now refused.
