# Weekly Tiered Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move platform billing from a flat GBP 10 per vehicle per calendar month to GBP 10 per vehicle per week on graduated volume bands (10/8/6/5), collected every 28 days.

**Architecture:** All pricing maths moves into a tier table in `lib/billing/money.ts` behind three pure functions (`weeklyNetPence`, `computeChargeAmounts`, `tierBreakdown`). The scheduler in `lib/billing/schedule.ts` drops calendar-month anchor arithmetic for a fixed 28-day advance, which retires the `company_billing.anchor_day` column across the run core, two API routes and a SQL migration. Seven UI surfaces then read the shared module instead of restating the price.

**Tech Stack:** TypeScript, Next.js 16 App Router, React 19, Supabase (Postgres), vitest. Tests live beside the module as `lib/**/*.test.ts`; only `lib/` is covered by vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-weekly-tiered-pricing-design.md`

**Branch:** `ethan/weekly-tiered-pricing` (already created, spec already committed)

---

## Background the engineer needs

Read these before starting.

- **Money is always integer pence.** Never floats, never pounds, until the moment it is formatted by `formatPence`. Every band rate here is a whole number of pounds and the cycle is exactly 4 weeks, so every total is a whole number of pounds and 20% VAT is always an exact penny. If you ever see a fractional penny, something is wrong.
- **Graduated tiers, not all-units.** The Nth vehicle is priced by the band N falls in. A fleet of 25 pays 10 vehicles at GBP 10, 10 at GBP 8, and 5 at GBP 6. It does **not** pay 25 vehicles at GBP 6. Getting this backwards creates a bill that falls when a customer adds a vehicle. Task 1 includes a monotonicity test specifically to catch that.
- **The word "monthly" is now wrong everywhere.** Cycles are 28 days, 13 per year. Copy says "every 4 weeks" or "4-weekly", never "monthly" or "per month".
- **Two styling systems coexist.** Pages with `className="ds ... font-sans bg-canvas text-ink"` on the root are design-system pages using tokens from `app/tokens.css`. Pages using `style={{ ... }}` inline objects are legacy. `app/super-admin/billing/page.tsx` is legacy; the rest of the pages in this plan are design system. Match whichever file you are in. Never use Tailwind `dark:` variants anywhere in this codebase.
- **Verification gates.** `npm test` runs vitest over `lib/**/*.test.ts`. `npm run typecheck` is the correctness gate and will surface every caller of the removed `NET_PENCE_PER_VEHICLE` and the changed `computeNextChargeOn` signature. There is no lint script.
- **No em-dashes** in code comments, docs or commit messages. This is a standing project convention.

## File structure

**Modified:**

| File | Responsibility after this change |
| --- | --- |
| `lib/billing/money.ts` | Sole source of the tier table, cycle length, VAT, and all pricing maths |
| `lib/billing/money.test.ts` | Band boundaries, monotonicity, VAT exactness, breakdown shape |
| `lib/billing/schedule.ts` | Fixed 28-day cycle advance plus the unchanged dunning retry schedule |
| `lib/billing/schedule.test.ts` | 28-day advance across month, year and leap-February boundaries |
| `lib/billing/run.ts` | Pure billing decision core, no longer aware of an anchor day |
| `lib/billing/run.test.ts` | Same, fixtures without `anchor_day` |
| `app/api/billing/card/route.ts` | Card capture and first charge, no longer writes `anchor_day` |
| `app/api/billing/run/route.ts` | Billing cron, no longer reads `anchor_day` |
| `app/settings/billing/NextInvoiceCard.tsx` | Renders real per-band invoice lines |
| `app/settings/billing/page.tsx` | Billing page copy and stat labels |
| `app/settings/licences/page.tsx` | Reads shared pricing module, shows tiered total |
| `app/settings/page.tsx` | Settings index card description |
| `app/super-admin/billing/page.tsx` | Reads shared pricing module |
| `components/landing/PricingCard.tsx` | Public tier table |
| `app/page.tsx` | Landing metadata and JSON-LD offer |
| `README.md`, `CLAUDE.md` | Header pricing line |

**Created:**

| File | Responsibility |
| --- | --- |
| `docs/sql/billing_02_four_weekly.sql` | Drops the now-meaningless `anchor_day` column |

---

## Task 1: Tier table and cycle pricing

**Files:**
- Modify: `lib/billing/money.ts:1-31`
- Test: `lib/billing/money.test.ts:1-45`

- [ ] **Step 1: Replace the `computeChargeAmounts` tests with band-boundary tests**

Open `lib/billing/money.test.ts`. Replace the import block at the top and the entire `describe("computeChargeAmounts", ...)` block (lines 1 to 45, ending just before `describe("chargeIdempotencyKey"`) with the following. Leave the `chargeIdempotencyKey`, `classifyPaymentResult` and `formatPence` describe blocks below untouched.

```ts
import { describe, expect, it } from "vitest";
import {
  chargeIdempotencyKey,
  classifyPaymentResult,
  computeChargeAmounts,
  formatPence,
  weeklyNetPence,
  WEEKS_PER_CYCLE,
} from "./money";

describe("weeklyNetPence", () => {
  // Graduated bands: the Nth vehicle is priced by the band N falls in, so the
  // first ten vehicles stay at GBP 10 even for a 500-vehicle fleet.
  it("prices a fleet inside the first band at GBP 10 per vehicle", () => {
    expect(weeklyNetPence(1)).toBe(1000);
    expect(weeklyNetPence(9)).toBe(9000);
    expect(weeklyNetPence(10)).toBe(10000);
  });

  it("prices the 11th to 20th vehicles at GBP 8", () => {
    expect(weeklyNetPence(11)).toBe(10800);
    expect(weeklyNetPence(20)).toBe(18000);
  });

  it("prices the 21st to 50th vehicles at GBP 6", () => {
    expect(weeklyNetPence(21)).toBe(18600);
    expect(weeklyNetPence(50)).toBe(36000);
  });

  it("prices the 51st vehicle onward at GBP 5", () => {
    expect(weeklyNetPence(51)).toBe(36500);
    expect(weeklyNetPence(60)).toBe(41000);
  });

  it("is zero for an empty fleet", () => {
    expect(weeklyNetPence(0)).toBe(0);
  });
});

describe("computeChargeAmounts", () => {
  it("bills 4 weeks per cycle", () => {
    expect(WEEKS_PER_CYCLE).toBe(4);
  });

  // The figure the commercial model was specified in. If this ever changes,
  // someone has changed the price, not refactored the maths.
  it("charges GBP 48 gross for a single vehicle", () => {
    expect(computeChargeAmounts(1)).toEqual({
      vehicleCount: 1,
      weeklyNetPence: 1000,
      blendedWeeklyPence: 1000,
      netPence: 4000,
      vatPence: 800,
      grossPence: 4800,
      vatRate: 20,
    });
  });

  it("charges a mixed-band fleet across all reached bands", () => {
    // 10 x GBP 10 + 10 x GBP 8 + 5 x GBP 6 = GBP 210 per week.
    expect(computeChargeAmounts(25)).toEqual({
      vehicleCount: 25,
      weeklyNetPence: 21000,
      blendedWeeklyPence: 840,
      netPence: 84000,
      vatPence: 16800,
      grossPence: 100800,
      vatRate: 20,
    });
  });

  it("reports the blended weekly rate, not the marginal one", () => {
    // A 50-vehicle fleet pays a blended GBP 7.20, NOT the GBP 6 marginal rate
    // and NOT the GBP 5 rate that only starts at vehicle 51.
    expect(computeChargeAmounts(50).blendedWeeklyPence).toBe(720);
    expect(computeChargeAmounts(60).blendedWeeklyPence).toBe(683);
  });

  it("returns all zeros for zero vehicles", () => {
    expect(computeChargeAmounts(0)).toEqual({
      vehicleCount: 0,
      weeklyNetPence: 0,
      blendedWeeklyPence: 0,
      netPence: 0,
      vatPence: 0,
      grossPence: 0,
      vatRate: 20,
    });
  });

  // This is the guard against anyone converting the bands to all-units
  // pricing, where a fleet crossing a threshold gets its WHOLE fleet
  // repriced and the bill drops when a vehicle is added.
  it("never bills less for more vehicles", () => {
    for (let n = 0; n < 200; n += 1) {
      expect(computeChargeAmounts(n + 1).grossPence).toBeGreaterThan(
        computeChargeAmounts(n).grossPence
      );
    }
  });

  it("lands VAT on an exact penny at every fleet size", () => {
    for (let n = 0; n <= 200; n += 1) {
      const { netPence, vatPence } = computeChargeAmounts(n);
      expect(netPence % 100).toBe(0);
      expect(vatPence * 5).toBe(netPence);
    }
  });

  it("rejects negative counts", () => {
    expect(() => computeChargeAmounts(-1)).toThrow();
  });

  it("rejects fractional counts", () => {
    expect(() => computeChargeAmounts(2.5)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/billing/money.test.ts`

Expected: FAIL. TypeScript/vitest reports that `weeklyNetPence` and `WEEKS_PER_CYCLE` are not exported from `./money`, and the `computeChargeAmounts` expectations mismatch on `netPence`.

- [ ] **Step 3: Replace the pricing constants and maths in `money.ts`**

In `lib/billing/money.ts`, replace lines 1 to 31 (the header comment, `NET_PENCE_PER_VEHICLE`, `VAT_RATE`, the `ChargeAmounts` type and `computeChargeAmounts`) with:

```ts
// Platform subscription pricing. All amounts are integer pence, never floats.
//
// The rate is per vehicle per WEEK, collected every 4 weeks (13 cycles a
// year). Billing 4 weeks per calendar month would only collect 48 weeks of
// revenue a year, which is why the cycle is a fixed 28 days rather than a
// calendar month. See lib/billing/schedule.ts.

export const WEEKS_PER_CYCLE = 4;
export const VAT_RATE = 20; // percent

export type PriceTier = {
  /** Inclusive last vehicle position in this band; null means no ceiling. */
  upToVehicle: number | null;
  weeklyPence: number;
};

// GRADUATED bands, not all-units: the Nth vehicle is priced by the band N
// falls in, so the first ten vehicles cost GBP 10 each no matter how large
// the fleet grows. Do not "simplify" this into repricing the whole fleet at
// the band rate: 19 vehicles at GBP 8 is GBP 152/week but 20 at GBP 6 is only
// GBP 120/week, so the bill would FALL when a customer added a vehicle.
// money.test.ts asserts monotonicity to keep that from being reintroduced.
export const PRICE_TIERS: readonly PriceTier[] = [
  { upToVehicle: 10, weeklyPence: 1000 },
  { upToVehicle: 20, weeklyPence: 800 },
  { upToVehicle: 50, weeklyPence: 600 },
  { upToVehicle: null, weeklyPence: 500 },
];

function assertVehicleCount(vehicleCount: number): void {
  if (!Number.isInteger(vehicleCount) || vehicleCount < 0) {
    throw new Error(
      `vehicleCount must be a non-negative integer, got ${vehicleCount}`
    );
  }
}

export type ChargeAmounts = {
  vehicleCount: number;
  /** Whole-fleet net for one week, before VAT. */
  weeklyNetPence: number;
  /** weeklyNetPence spread over the fleet, for "works out at GBP X" copy.
      This is the BLENDED rate, always higher than the marginal band rate. */
  blendedWeeklyPence: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  vatRate: number;
};

export function weeklyNetPence(vehicleCount: number): number {
  assertVehicleCount(vehicleCount);
  let total = 0;
  let priced = 0;
  for (const tier of PRICE_TIERS) {
    if (priced >= vehicleCount) break;
    const ceiling = tier.upToVehicle ?? vehicleCount;
    const inBand = Math.min(vehicleCount, ceiling) - priced;
    if (inBand <= 0) continue;
    total += inBand * tier.weeklyPence;
    priced += inBand;
  }
  return total;
}

export function computeChargeAmounts(vehicleCount: number): ChargeAmounts {
  const weekly = weeklyNetPence(vehicleCount);
  const netPence = weekly * WEEKS_PER_CYCLE;
  // Every band rate is a whole number of pounds and the cycle is 4 weeks, so
  // netPence is always a multiple of 100 and this round is a formality.
  const vatPence = Math.round((netPence * VAT_RATE) / 100);
  return {
    vehicleCount,
    weeklyNetPence: weekly,
    blendedWeeklyPence:
      vehicleCount === 0 ? 0 : Math.round(weekly / vehicleCount),
    netPence,
    vatPence,
    grossPence: netPence + vatPence,
    vatRate: VAT_RATE,
  };
}
```

Leave `formatPence`, `chargeIdempotencyKey` and `classifyPaymentResult` below exactly as they are.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/billing/money.test.ts`

Expected: PASS. All describe blocks green, including the 200-iteration monotonicity and VAT loops.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/money.ts lib/billing/money.test.ts
git commit -m "Price vehicles on graduated weekly tiers"
```

---

## Task 2: Per-band breakdown for the UI

**Files:**
- Modify: `lib/billing/money.ts` (append after `computeChargeAmounts`)
- Test: `lib/billing/money.test.ts` (append a describe block after `describe("computeChargeAmounts")`)

- [ ] **Step 1: Write the failing test**

Add `tierBreakdown` to the import list at the top of `lib/billing/money.test.ts`, then add this describe block immediately after the closing `});` of `describe("computeChargeAmounts", ...)`:

```ts
describe("tierBreakdown", () => {
  it("returns no lines for an empty fleet", () => {
    expect(tierBreakdown(0)).toEqual([]);
  });

  it("returns one line for a fleet inside the first band", () => {
    expect(tierBreakdown(5)).toEqual([
      {
        fromVehicle: 1,
        toVehicle: 5,
        vehiclesInBand: 5,
        weeklyPence: 1000,
        weeklyNetPence: 5000,
      },
    ]);
  });

  it("splits a fleet across the bands it actually reaches", () => {
    expect(tierBreakdown(15)).toEqual([
      {
        fromVehicle: 1,
        toVehicle: 10,
        vehiclesInBand: 10,
        weeklyPence: 1000,
        weeklyNetPence: 10000,
      },
      {
        fromVehicle: 11,
        toVehicle: 15,
        vehiclesInBand: 5,
        weeklyPence: 800,
        weeklyNetPence: 4000,
      },
    ]);
  });

  it("emits one line per reached band and no empty trailing bands", () => {
    expect(tierBreakdown(35)).toHaveLength(3);
    expect(tierBreakdown(75)).toHaveLength(4);
  });

  it("sums to weeklyNetPence at every fleet size", () => {
    for (let n = 0; n <= 200; n += 1) {
      const summed = tierBreakdown(n).reduce(
        (total, line) => total + line.weeklyNetPence,
        0
      );
      expect(summed).toBe(weeklyNetPence(n));
    }
  });

  it("covers every vehicle exactly once", () => {
    const lines = tierBreakdown(75);
    expect(lines[0].fromVehicle).toBe(1);
    expect(lines[lines.length - 1].toVehicle).toBe(75);
    for (let i = 1; i < lines.length; i += 1) {
      expect(lines[i].fromVehicle).toBe(lines[i - 1].toVehicle + 1);
    }
  });

  it("rejects invalid counts like the other pricing functions", () => {
    expect(() => tierBreakdown(-1)).toThrow();
    expect(() => tierBreakdown(2.5)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/money.test.ts -t "tierBreakdown"`

Expected: FAIL with `tierBreakdown is not a function` (or a TypeScript export error).

- [ ] **Step 3: Implement `tierBreakdown`**

In `lib/billing/money.ts`, insert this directly after `computeChargeAmounts` and before `formatPence`:

```ts
export type TierLine = {
  /** 1-based inclusive vehicle positions this line covers. */
  fromVehicle: number;
  toVehicle: number;
  vehiclesInBand: number;
  weeklyPence: number;
  weeklyNetPence: number;
};

// One line per band the fleet actually reaches, so the UI can show real
// invoice lines ("Vehicles 11-15 x GBP 8.00/week") instead of a single
// multiplication that is only correct for fleets inside the first band.
export function tierBreakdown(vehicleCount: number): TierLine[] {
  assertVehicleCount(vehicleCount);
  const lines: TierLine[] = [];
  let priced = 0;
  for (const tier of PRICE_TIERS) {
    if (priced >= vehicleCount) break;
    const ceiling = tier.upToVehicle ?? vehicleCount;
    const inBand = Math.min(vehicleCount, ceiling) - priced;
    if (inBand <= 0) continue;
    lines.push({
      fromVehicle: priced + 1,
      toVehicle: priced + inBand,
      vehiclesInBand: inBand,
      weeklyPence: tier.weeklyPence,
      weeklyNetPence: inBand * tier.weeklyPence,
    });
    priced += inBand;
  }
  return lines;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/billing/money.test.ts`

Expected: PASS, all describe blocks including `tierBreakdown`.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/money.ts lib/billing/money.test.ts
git commit -m "Add per-band pricing breakdown for invoice lines"
```

---

## Task 3: Fixed 28-day billing cycle

**Files:**
- Modify: `lib/billing/schedule.ts:26-51`
- Test: `lib/billing/schedule.test.ts:35-63`

- [ ] **Step 1: Replace the `computeNextChargeOn` tests**

In `lib/billing/schedule.test.ts`, replace the whole `describe("computeNextChargeOn", ...)` block with:

```ts
describe("computeNextChargeOn", () => {
  it("advances a fixed 28 days", () => {
    expect(CYCLE_DAYS).toBe(28);
    expect(computeNextChargeOn("2026-08-26")).toBe("2026-09-23");
  });

  it("crosses a month boundary", () => {
    expect(computeNextChargeOn("2026-09-20")).toBe("2026-10-18");
  });

  it("crosses the year boundary", () => {
    expect(computeNextChargeOn("2026-12-15")).toBe("2027-01-12");
  });

  it("crosses a 28-day February", () => {
    expect(computeNextChargeOn("2027-02-10")).toBe("2027-03-10");
  });

  it("crosses a leap-year February", () => {
    expect(computeNextChargeOn("2028-02-10")).toBe("2028-03-09");
  });

  // 28 days is exactly 4 weeks, so the billing weekday never drifts. This is
  // the property that replaced anchor-day clamping.
  it("keeps successive cycles exactly 28 days apart", () => {
    const first = computeNextChargeOn("2026-08-26");
    const second = computeNextChargeOn(first);
    expect(second).toBe(addDays("2026-08-26", 56));
  });
});
```

Add `CYCLE_DAYS` to the import list at the top of the file, which becomes:

```ts
import {
  addDays,
  computeNextChargeOn,
  CYCLE_DAYS,
  londonDateISO,
  nextRetryOn,
} from "./schedule";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/schedule.test.ts`

Expected: FAIL. `CYCLE_DAYS` is not exported, and `computeNextChargeOn("2026-08-26")` returns `"2026-09-26"` (the old calendar-month advance) rather than `"2026-09-23"`.

- [ ] **Step 3: Replace the scheduler arithmetic**

In `lib/billing/schedule.ts`, delete the `daysInMonth` helper (lines 26 to 29) and replace the whole `computeNextChargeOn` function and its preceding comment (lines 36 to 51) with:

```ts
export const CYCLE_DAYS = 28;

// Cycles are a fixed 4 weeks. There is no anchor day and no month-length
// clamping: every cycle is the same length, the billing weekday never drifts,
// and 13 cycles a year collects all 52 weeks. Billing 4 weeks per CALENDAR
// month would only have collected 48.
export function computeNextChargeOn(cycleDate: string): string {
  return addDays(cycleDate, CYCLE_DAYS);
}
```

Keep `londonDateISO`, `pad`, `parseISO`, `addDays`, `MAX_ATTEMPTS` and `nextRetryOn`. `parseISO` is still used by `addDays`; `daysInMonth` now has no callers, which is why it goes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/schedule.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/schedule.ts lib/billing/schedule.test.ts
git commit -m "Bill on a fixed 28-day cycle instead of a calendar month"
```

---

## Task 4: Drop the anchor day from the billing decision core

**Files:**
- Modify: `lib/billing/run.ts:10`, `lib/billing/run.ts:70`, `lib/billing/run.ts:78`
- Test: `lib/billing/run.test.ts:9`, `lib/billing/run.test.ts:70-89`

- [ ] **Step 1: Update the tests**

In `lib/billing/run.test.ts`, delete the `anchor_day: 26,` line from the `row()` fixture (line 9).

Then find the `applyChargeOutcome` success test. Its expected `next_charge_on` changes from `"2026-09-26"` to `"2026-09-23"` (28 days after the `2026-08-26` cycle date, not one calendar month).

Then delete the entire `it("anchor-clamps the advanced date", ...)` test. Anchor clamping no longer exists as a behaviour. Replace it with:

```ts
  it("advances a fixed 28 days regardless of month length", () => {
    expect(
      applyChargeOutcome({
        row: row({ next_charge_on: "2027-01-31" }),
        cycleDate: "2027-01-31",
        attempt: 1,
        succeeded: true,
      }).next_charge_on
    ).toBe("2027-02-28");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/billing/run.test.ts`

Expected: FAIL. TypeScript reports `anchor_day` is missing from the `CompanyBillingRow` fixture, and the success test's `next_charge_on` mismatches.

- [ ] **Step 3: Remove `anchor_day` from `run.ts`**

Three edits in `lib/billing/run.ts`.

Delete the `anchor_day` field from `CompanyBillingRow` (line 10), so the type reads:

```ts
export type CompanyBillingRow = {
  company_id: string;
  status: "active" | "past_due" | "canceled";
  next_charge_on: string;
  retry_at: string | null;
  retry_count: number;
};
```

Narrow the `applyChargeOutcome` argument `Pick` (line 70) from `"anchor_day" | "next_charge_on"` to just `"next_charge_on"`:

```ts
  row: Pick<CompanyBillingRow, "next_charge_on">;
```

Drop the second argument from the `computeNextChargeOn` call (line 78):

```ts
      next_charge_on: computeNextChargeOn(args.cycleDate),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/billing/run.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/run.ts lib/billing/run.test.ts
git commit -m "Remove anchor day from the billing decision core"
```

---

## Task 5: Stop writing `anchor_day`, and drop the column

**Files:**
- Modify: `app/api/billing/card/route.ts:146-152`, `:194`, `:230-235`, `:305-308`
- Modify: `app/api/billing/run/route.ts:58`
- Create: `docs/sql/billing_02_four_weekly.sql`

`anchor_day` is `not null` in the database today, so the code must stop supplying it and the migration must drop it. Do both in this task and commit them together.

- [ ] **Step 1: Remove the anchor day from the orphan-recovery insert**

In `app/api/billing/card/route.ts`, in the `if (recentOrphan)` branch, delete the `const anchorDay = ...` line, change the `computeNextChargeOn` call, and delete the `anchor_day` field from the insert. The block becomes:

```ts
      if (recentOrphan) {
        const cycleDate = recentOrphan.cycle_date as string;
        const nextChargeOn = computeNextChargeOn(cycleDate);
        const { error: insertError } = await admin.from("company_billing").insert({
          company_id: companyId,
          ...cardFields,
          status: "active",
          next_charge_on: nextChargeOn,
          retry_at: null,
          retry_count: 0,
        });
```

- [ ] **Step 2: Remove the anchor day from the first-time setup path**

Still in `app/api/billing/card/route.ts`, delete the line `const anchorDay = Number(today.slice(8, 10));` that sits just before the `let result;` declaration.

Then change the `computeNextChargeOn` call and the insert that follow the successful first charge:

```ts
      const nextChargeOn = computeNextChargeOn(today);
      const { error: insertError } = await admin.from("company_billing").insert({
        company_id: companyId,
        ...cardFields,
        status: "active",
        next_charge_on: nextChargeOn,
        retry_at: null,
        retry_count: 0,
      });
```

- [ ] **Step 3: Remove the anchor day from the recovery `applyChargeOutcome` call**

Still in `app/api/billing/card/route.ts`, the `applyChargeOutcome` call near line 305 loses its `anchor_day` row field:

```ts
    const outcome = applyChargeOutcome({
      row: {
        next_charge_on: existing.next_charge_on as string,
      },
      cycleDate,
      attempt,
      succeeded: result.succeeded,
    });
```

- [ ] **Step 4: Stop reading the column in the cron route**

In `app/api/billing/run/route.ts`, delete line 58, `anchor_day: Number(raw.anchor_day),`, from the object that builds the `CompanyBillingRow`.

- [ ] **Step 5: Write the migration**

Create `docs/sql/billing_02_four_weekly.sql`:

```sql
-- billing_02: fixed 4-weekly billing cycle.
-- Apply manually in the Supabase SQL editor, like the rls_* series and
-- billing_01. Safe to re-run.
--
-- Cycles are now a fixed 28 days (lib/billing/schedule.ts), so there is no
-- anchor day to clamp into a short month and the column is dead. Apply this
-- together with the code change that stops writing it: the column is NOT NULL,
-- so the old code cannot run against the new schema and the new code cannot
-- insert against the old one.

alter table public.company_billing drop column if exists anchor_day;
```

- [ ] **Step 6: Verify the whole billing layer typechecks**

Run: `npm run typecheck`

Expected: PASS with no errors. This is the step that proves no caller of `computeNextChargeOn` or `CompanyBillingRow` was missed. If it reports a remaining `anchor_day` reference, fix that file before committing.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`

Expected: PASS. All `lib/**/*.test.ts` green, including `lib/theme/contrast.test.ts`, which is unrelated but runs every time.

- [ ] **Step 8: Commit**

```bash
git add app/api/billing/card/route.ts app/api/billing/run/route.ts docs/sql/billing_02_four_weekly.sql
git commit -m "Stop writing anchor_day and add the migration dropping it"
```

- [ ] **Step 9: Flag the manual migration**

There is no automated migration runner in this project. Note in your handoff that `docs/sql/billing_02_four_weekly.sql` must be pasted into the Supabase SQL editor and run by hand before the deployed code creates or updates a `company_billing` row. Do not mark this task complete silently: the migration being unapplied is a deploy-blocking condition, not a detail.

---

## Task 6: Real invoice lines on the next-invoice card

**Files:**
- Modify: `app/settings/billing/NextInvoiceCard.tsx:1-12`, `:60-70`

This card currently renders `N vehicles × £10.00`, which is only correct for fleets inside the first band. It becomes one row per reached band.

- [ ] **Step 1: Update the imports**

In `app/settings/billing/NextInvoiceCard.tsx`, replace the import from `lib/billing/money`:

```ts
import {
  formatPence,
  tierBreakdown,
  WEEKS_PER_CYCLE,
  type ChargeAmounts,
  type TierLine,
} from "../../../lib/billing/money";
```

`NET_PENCE_PER_VEHICLE` no longer exists, so leaving it in the import list is a typecheck failure.

- [ ] **Step 2: Replace the single vehicles row with per-band rows**

Delete the `const vehiclesLabel = ...` block (the ternary computing `Vehicles × £10.00`) and replace it with:

```ts
  // One row per band the fleet reaches. A fleet of 10 or fewer, which is the
  // common case, still renders as a single row, so the card does not get
  // heavier for small customers.
  // Annotated rather than inferred: the ternary would otherwise infer
  // never[] | TierLine[] and the label helper below loses its parameter type.
  const lines: TierLine[] =
    loading || unavailable ? [] : tierBreakdown(amounts.vehicleCount);

  const lineLabel = (line: TierLine): string =>
    lines.length === 1
      ? `${line.vehiclesInBand} ${line.vehiclesInBand === 1 ? "vehicle" : "vehicles"} × ${formatPence(line.weeklyPence)}/week × ${WEEKS_PER_CYCLE} weeks`
      : `Vehicles ${line.fromVehicle}-${line.toVehicle} × ${formatPence(line.weeklyPence)}/week × ${WEEKS_PER_CYCLE} weeks`;
```

- [ ] **Step 3: Render the rows**

Replace the first `<Row label={vehiclesLabel} ... />` inside the `<Card>` with:

```tsx
      {lines.length === 0 ? (
        <Row
          label={`Vehicles × weekly rate × ${WEEKS_PER_CYCLE} weeks`}
          value={money(amounts.netPence, "6ch")}
        />
      ) : (
        lines.map((line) => (
          <Row
            key={line.fromVehicle}
            label={lineLabel(line)}
            value={money(line.weeklyNetPence * WEEKS_PER_CYCLE, "6ch")}
          />
        ))
      )}
      {lines.length > 1 ? (
        <Row label="Net" value={money(amounts.netPence, "6ch")} />
      ) : null}
```

The `lines.length === 0` branch covers three cases at once: still loading, licence count unavailable, and a genuine zero-vehicle fleet. All three want a rate summary rather than a multiplication, and `money()` already handles the skeleton and the `-` for the first two.

- [ ] **Step 4: Update the trailing note**

Change the last paragraph in the card so it states the cadence:

```tsx
      <p className="m-0 text-xs text-ink-3">
        The vehicle count is taken on the billing date, so this can change
        before then. Charged every {WEEKS_PER_CYCLE} weeks.
      </p>
```

- [ ] **Step 5: Verify it typechecks**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/settings/billing/NextInvoiceCard.tsx
git commit -m "Show per-band invoice lines on the next-invoice card"
```

---

## Task 7: Billing settings and settings index copy

**Files:**
- Modify: `app/settings/billing/page.tsx:101-104`, `:288-303`
- Modify: `app/settings/page.tsx:26`

- [ ] **Step 1: Update the billing page header blurb**

In `app/settings/billing/page.tsx`, inside `PageFrame`, replace the description paragraph:

```tsx
            <p className="m-0 text-sm text-ink-3">
              From £10 per active licensed vehicle per week, plus VAT, with
              volume rates for larger fleets. Charged to your card every 4
              weeks.
            </p>
```

- [ ] **Step 2: Relabel the total stat**

Still in `app/settings/billing/page.tsx`, the `Stat` currently labelled `"Monthly total"` becomes 4-weekly, and its `sub` gains the blended weekly rate. Replace its `label` and `sub` props:

```tsx
            label="4-weekly total"
```

```tsx
            sub={
              showSkeleton || loadError?.licences
                ? undefined
                : `${formatPence(amounts.netPence)} + ${formatPence(amounts.vatPence)} VAT · ${formatPence(amounts.blendedWeeklyPence)}/vehicle/week`
            }
```

Leave the `value` prop, the skeleton branch and the `Licensed vehicles` stat above it exactly as they are.

- [ ] **Step 3: Update the settings index card**

In `app/settings/page.tsx`, change the Vehicle Licences entry description:

```tsx
            description: "Add or remove licences and manage 4-weekly billing",
```

- [ ] **Step 4: Verify it typechecks**

Run: `npm run typecheck`

Expected: PASS. `blendedWeeklyPence` exists on `ChargeAmounts` from Task 1.

- [ ] **Step 5: Commit**

```bash
git add app/settings/billing/page.tsx app/settings/page.tsx
git commit -m "State weekly tiered pricing on the billing settings pages"
```

---

## Task 8: Licences page reads the shared pricing module

**Files:**
- Modify: `app/settings/licences/page.tsx:15`, `:245`, `:276`, `:296-303`

This page declares its own `PRICE_PER_LICENSED_VEHICLE = 10`, which is exactly how a price change goes half-applied. It gets deleted.

- [ ] **Step 1: Delete the local constant and import the shared module**

In `app/settings/licences/page.tsx`, delete line 15:

```ts
const PRICE_PER_LICENSED_VEHICLE = 10;
```

Add to the imports at the top of the file:

```ts
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";
```

Check the relative depth before writing it: this file is at `app/settings/licences/page.tsx`, so `../../../lib/...` resolves to the repo-root `lib/`. That matches the existing import style in `app/settings/billing/page.tsx`.

- [ ] **Step 2: Replace the monthly total calculation**

Replace line 245:

```ts
    const monthlyTotal = billableVehicleCount * PRICE_PER_LICENSED_VEHICLE;
```

with:

```ts
    const amounts = computeChargeAmounts(billableVehicleCount);
```

- [ ] **Step 3: Update the header copy**

Replace the header paragraph:

```tsx
                <p className="m-0 text-sm text-ink-3">
                    Add and manage vehicle licences. Billing starts at £10 per
                    licensed vehicle per week, with volume rates for larger
                    fleets, charged every 4 weeks.
                </p>
```

- [ ] **Step 4: Update the two stat tiles**

Replace the `Monthly Charge` and `Billing Rule` stats with:

```tsx
                <Stat
                    label="4-Weekly Charge"
                    value={
                        showSkeleton ? (
                            <Skeleton display="inline-block" w="7ch" h="1.25rem" />
                        ) : (
                            formatPence(amounts.grossPence)
                        )
                    }
                    sub="inc VAT"
                />
                <Stat label="Billing Rule" value="From £10" sub="per licensed vehicle per week" />
```

Leave the `Licensed Vehicles` stat above them unchanged. Note the skeleton width goes from `5ch` to `7ch`, because the value is now a formatted `£1,008.00`-shaped string rather than a bare `£250`.

- [ ] **Step 5: Verify it typechecks**

Run: `npm run typecheck`

Expected: PASS, and no remaining reference to `PRICE_PER_LICENSED_VEHICLE` in this file.

- [ ] **Step 6: Commit**

```bash
git add app/settings/licences/page.tsx
git commit -m "Read tiered pricing from the shared module on the licences page"
```

---

## Task 9: Super-admin billing page reads the shared pricing module

**Files:**
- Modify: `app/super-admin/billing/page.tsx:7`, `:137`, `:147`, `:246`, `:295`

This is a **legacy inline-styled page** (`style={{ ... }}` objects, not Tailwind classes). Do not convert it to the design system here; that is out of scope. Only the pricing changes.

- [ ] **Step 1: Delete the local constant and import the shared module**

In `app/super-admin/billing/page.tsx`, delete line 7:

```ts
const PRICE_PER_LICENSED_VEHICLE = 10;
```

Add to the imports at the top:

```ts
import { computeChargeAmounts } from "../../../lib/billing/money";
```

- [ ] **Step 2: Replace the charge calculation**

Replace line 137:

```ts
            const monthlyCharge = billableVehicleCount * PRICE_PER_LICENSED_VEHICLE;
```

with:

```ts
            // Whole pounds net. netPence is always a multiple of 400 under the
            // tier table, so this never introduces a fraction, and invoices.amount
            // stays the pounds figure it has always been.
            const cycleChargePounds =
                computeChargeAmounts(billableVehicleCount).netPence / 100;
```

- [ ] **Step 3: Rename the field on the row object**

Replace `monthlyCharge,` in the returned object (line 147) with:

```ts
                cycleChargePounds,
```

- [ ] **Step 4: Update the two render sites**

Replace the display line:

```tsx
                            <div style={{ opacity: 0.8, marginBottom: 12 }}>
                                4-Weekly Charge: £{row.cycleChargePounds} (ex VAT)
                            </div>
```

And the `createInvoice` argument:

```tsx
                                    createInvoice(
                                        row.company.id,
                                        row.billableVehicleCount,
                                        row.cycleChargePounds
                                    )
```

- [ ] **Step 5: Verify it typechecks**

Run: `npm run typecheck`

Expected: PASS, and no remaining reference to `monthlyCharge` or `PRICE_PER_LICENSED_VEHICLE` in this file.

- [ ] **Step 6: Commit**

```bash
git add app/super-admin/billing/page.tsx
git commit -m "Read tiered pricing from the shared module on super-admin billing"
```

---

## Task 10: Public tier table on the landing page

**Files:**
- Modify: `components/landing/PricingCard.tsx`
- Modify: `app/page.tsx:26`, `:81`

**The wording trap:** under graduated tiers, £5 is what the 51st vehicle costs, not what a 50-vehicle fleet pays per vehicle. Every line below is phrased as "vehicles 51+" deliberately. Do not reword this to "£5 a vehicle at 50+", which would be a promise the billing engine does not keep.

- [ ] **Step 1: Rewrite the pricing card with the full tier table**

Replace the whole body of `components/landing/PricingCard.tsx` with:

```tsx
import Container from "../Container";
import { buttonClasses } from "../Button";
import { PRICE_TIERS, formatPence } from "../../lib/billing/money";

/* Bands are GRADUATED: the rate shown applies to the vehicles in that band
   only, not to the whole fleet. The copy says "vehicles 51+" rather than
   "£5 a vehicle at 50+" on purpose, because a 50-vehicle fleet actually pays
   a blended £7.20. See docs/superpowers/specs/2026-09-04-weekly-tiered-pricing-design.md */
function bandLabel(index: number): string {
  const from = index === 0 ? 1 : (PRICE_TIERS[index - 1].upToVehicle ?? 0) + 1;
  const to = PRICE_TIERS[index].upToVehicle;
  if (to === null) return `Vehicles ${from}+`;
  if (from === 1) return `First ${to} vehicles`;
  return `Vehicles ${from} to ${to}`;
}

export default function PricingCard() {
  return (
    <section id="pricing" className="py-12 md:py-16">
      <Container className="text-center">
        <p className="text-overline uppercase text-ink-2">Pricing</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">
          Simple, per-vehicle pricing
        </h2>
        <div className="mx-auto mt-6 inline-block rounded-lg border-2 border-primary bg-surface p-6 text-left">
          <div className="text-2xl font-semibold text-ink">
            £10{" "}
            <span className="text-sm font-normal text-ink-3">
              per vehicle, per week
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            Billed every 4 weeks · every module included · no setup fee
          </p>

          <table className="mt-4 w-full border-collapse text-sm">
            <caption className="pb-2 text-left text-xs text-ink-3">
              Larger fleets pay less on the vehicles above each threshold
            </caption>
            <tbody>
              {PRICE_TIERS.map((tier, index) => (
                <tr key={tier.upToVehicle ?? "rest"} className="border-t border-line">
                  <td className="py-1.5 pr-6 text-ink-2">{bandLabel(index)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-ink">
                    {formatPence(tier.weeklyPence)}
                    <span className="text-ink-3"> /week</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <a
            href="#request-access"
            className={buttonClasses("primary", "lg", "mt-5 w-full")}
          >
            Request access
          </a>
        </div>
      </Container>
    </section>
  );
}
```

This renders the bands as "First 10 vehicles / Vehicles 11 to 20 / Vehicles 21 to 50 / Vehicles 51+", driven off `PRICE_TIERS`, so the public page can never drift from what the billing engine charges.

- [ ] **Step 2: Update the page metadata description**

In `app/page.tsx`, change the `description` in the exported `metadata` object. The old text ends with "£10 per vehicle per month."; it becomes:

```ts
  description:
    "Cloud transport management software for haulage, logistics and delivery operators. Jobs, proof of delivery, invoicing, fleet, drivers, subcontractors and live tracking in one platform. From £10 per vehicle per week, billed every 4 weeks.",
```

- [ ] **Step 3: Update the JSON-LD offer**

Still in `app/page.tsx`, the structured-data `offers` object advertises a monthly price. Change its `description`:

```ts
            offers: {
              // Was price "0", which advertised the product as free and
              // contradicted the pricing card. The price here is the entry
              // weekly rate; volume bands are on the pricing card.
              "@type": "Offer",
              price: "10",
              priceCurrency: "GBP",
              description: "Per vehicle, per week, billed every 4 weeks",
            },
```

- [ ] **Step 4: Verify it typechecks and builds**

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run build`

Expected: PASS. The landing page is a server component and `PricingCard` now imports from `lib/billing/money`, which is pure and has no server-only dependencies, so this import is safe in both environments. If the build objects to the import, that is a real signal, not noise.

- [ ] **Step 5: Commit**

```bash
git add components/landing/PricingCard.tsx app/page.tsx
git commit -m "Publish the full weekly tier table on the landing page"
```

---

## Task 11: Documentation and final verification

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Update the README pricing line**

Find the line in `README.md` describing the product as `GBP 10/vehicle/month` (it is in the opening description) and change it to `from GBP 10/vehicle/week, billed every 4 weeks`. Search with:

```bash
grep -n "vehicle/month\|per vehicle per month\|10/vehicle" README.md
```

Fix every hit. If the README has a pricing or billing section describing the calendar-month cycle, update it to describe the 28-day cycle and the four bands.

- [ ] **Step 2: Update the CLAUDE.md summary line**

In `CLAUDE.md`, the "What this is" paragraph opens with `(SaaS, GBP 10/vehicle/month)`. Change it to `(SaaS, from GBP 10/vehicle/week billed 4-weekly)`.

- [ ] **Step 3: Confirm no stale pricing copy survives**

Run:

```bash
grep -rn "per vehicle per month\|vehicle/month\|Monthly Charge\|Monthly total\|monthly billing\|NET_PENCE_PER_VEHICLE\|PRICE_PER_LICENSED_VEHICLE\|anchor_day\|anchorDay" app lib components README.md CLAUDE.md --include="*.ts" --include="*.tsx" --include="*.md"
```

Expected: no output, except hits inside `docs/` (the spec and this plan legitimately discuss the old model) which are excluded by the paths above. Any hit in `app/`, `lib/` or `components/` is a surface this plan missed. Fix it before continuing.

- [ ] **Step 4: Run the full verification gates**

Run: `npm test`

Expected: PASS. Every `lib/**/*.test.ts` green.

Run: `npm run typecheck`

Expected: PASS with no errors.

Run: `npm run build`

Expected: PASS.

Do not claim completion on any gate you have not actually run and seen pass.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document weekly tiered pricing and the 4-weekly cycle"
```

- [ ] **Step 6: Report what remains manual**

The branch is code-complete at this point, but two things are **not** done and must be stated plainly in the handoff rather than implied:

1. `docs/sql/billing_02_four_weekly.sql` has not been applied. It must be pasted into the Supabase SQL editor and run by hand. Until then the deployed code cannot insert a `company_billing` row, because `anchor_day` is still `NOT NULL` with no default.
2. No signed-in pass has been done. `/settings/billing`, `/settings/licences` and `/super-admin/billing` are all behind auth and have not been viewed with real data. Ask for that pass before merging.

---

## Notes for the reviewer

- The blended-versus-marginal distinction is the single highest-risk thing in this change, and it is a copy risk rather than a code risk. Any future edit to the landing page or the billing blurb that turns "vehicles 51+ are £5" into "£5 per vehicle at 50+" is a mis-statement of the price. The `bandLabel` helper in `PricingCard.tsx` exists to make that phrasing structural rather than hand-written.
- The monotonicity test in `money.test.ts` is the guard rail for the all-units mistake. If someone later "simplifies" `weeklyNetPence` into `count * rateForCount(count)`, that test fails immediately at n=19.
- `invoices.amount` on the super-admin page stays a whole-pounds net number, unchanged in type and meaning. It happens to remain integral only because every band rate is a whole number of pounds and the cycle is 4 weeks. If a future band rate is ever set to something like £7.50, that field needs revisiting.
