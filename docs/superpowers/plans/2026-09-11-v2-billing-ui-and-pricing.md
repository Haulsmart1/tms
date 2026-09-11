# v2 Billing UI and Public Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a `v2_period` company a billing page that shows what its open period will invoice, and move the product's public pricing from v1 to v2.

**Architecture:** The projected figure comes from a server route that calls the same function the close job calls, so the page and the invoice cannot disagree. `/settings/billing` splits into a thin shell that forks on `billing_model` plus one body per model. Every public pricing string is derived from `lib/billing/rateCard.ts` by a single new module, so the six surfaces that currently hardcode v1 prices cannot drift again.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (PostgREST + RLS), vitest, Tailwind with the `ds` design system.

**Spec:** `docs/superpowers/specs/2026-09-11-v2-billing-ui-and-pricing-design.md`. Read it before starting. Several choices below look arbitrary without it.

---

## Before you start

Things that are true of this repo and will cost you an hour each if you do not know them.

- **`npm test` only runs `lib/**/*.test.ts`.** Nothing under `app/` is covered. This is why every decision worth asserting is pushed into `lib/`. Do not try to add a test under `app/`; `vitest.config.ts` will not pick it up.
- **`npm run typecheck` is the real gate**, and it runs `next typegen && tsc --noEmit`. There is no lint script.
- **Never use `lib/billing/money.ts` in v2 code**, or `rateCard.ts` in v1 code. They are different pricing shapes. The one exception is `formatPence`, and Task 1 moves it out of `money.ts` precisely so that exception stops existing.
- **`vehicles` has no `company_id` column.** It is keyed by `tenant_id`, and some rows carry a company id there directly. Filtering on `vehicles.company_id` answers PostgREST 42703 and fails the whole request.
- **`vehicle_licences` holds compliance documents, not billing seats.** A vehicle can have several active at once. Count vehicles, never licence rows.
- Every page root needs `className="ds font-sans bg-canvas text-ink"`. Forgetting `ds` breaks borders because Tailwind Preflight is off; forgetting `font-sans` silently falls back to Inter.
- **Never use Tailwind `dark:` variants.** `:root` in `app/tokens.css` holds the dark values and `.light` is the opt-out, so `dark:` means the opposite of what it looks like.
- Run `npm test` after every task. The 1141 existing tests are the regression gate for the refactors in Tasks 1, 3 and 6.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `lib/billing/pricingCopy.ts` | Every public pricing string, derived from `rateCard.ts` |
| `lib/billing/pricingCopy.test.ts` | Asserts those strings against the constants, not against literals |
| `lib/billing/periodView.ts` | View model for the v2 billing page: period progress, the sentence explaining the total, the no-period diagnostic |
| `lib/billing/periodView.test.ts` | Covers the above, including the 2-vehicle boundary |
| `app/api/billing/preview/route.ts` | `GET`, returns what the open period would invoice today |
| `app/settings/billing/V1Billing.tsx` | Today's page body, moved |
| `app/settings/billing/V2Billing.tsx` | The v2 body |

**Modified:**

| File | Change |
|---|---|
| `lib/billing/format.ts` | Gains `formatPence` |
| `lib/billing/money.ts` | Loses `formatPence`, re-exports it |
| `lib/billing/periodServer.ts` | Gains `previewPeriodInvoice`; `computePeriodInvoice` calls it |
| `lib/billing/rateCard.ts` | Doc comment defect fixed; gains `NEW_COMPANY_BILLING_MODEL` in Task 9 |
| `app/settings/billing/page.tsx` | Becomes the shell |
| `components/landing/PricingCard.tsx` | Rewritten against `pricingCopy` |
| `app/page.tsx` | Meta description and JSON-LD offer |
| `app/settings/licences/page.tsx` | Model-aware pricing copy and stat tiles |
| `app/super-admin/billing/page.tsx` | Pricing sentence corrected |
| `app/api/billing/card/route.ts` | v2 signup branch (Task 9, flagged) |

---

## Task 1: Move `formatPence` out of the v1 pricing module

`formatPence` is pure display, but it lives in `money.ts`, which every v2 file is forbidden to import. Moving it to `format.ts` (whose own docstring already says "Display helpers for the billing page. No money maths lives here") lets v2 code format money without importing the v1 rate card.

**Files:**
- Modify: `lib/billing/format.ts`
- Modify: `lib/billing/money.ts:117-119`

- [ ] **Step 1: Add `formatPence` to `format.ts`**

Append to `lib/billing/format.ts`:

```ts
/* Moved here from ./money.ts, which is the v1 rate card and which v2 code must
   not import (see CLAUDE.md). Formatting pence is not pricing, so it belongs
   with the other display helpers and is shared by both billing models. */
export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
```

- [ ] **Step 2: Replace the definition in `money.ts` with a re-export**

In `lib/billing/money.ts`, delete lines 117 to 119:

```ts
export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
```

and put this in their place:

```ts
/* Display helper, moved to ./format.ts so v2 code can use it without importing
   this file. Re-exported rather than relocated at every call site, because the
   v1 pages that import it from here are correct to and there is no behaviour
   change. New code imports from ./format. */
export { formatPence } from "./format";
```

- [ ] **Step 3: Verify nothing broke**

```bash
npm test
npm run typecheck
```

Expected: 1141 tests pass, typecheck clean. `money.test.ts` imports `formatPence` from `./money` and must still pass through the re-export.

- [ ] **Step 4: Commit**

```bash
git add lib/billing/format.ts lib/billing/money.ts
git commit -m "Move formatPence to the display module

It is pure formatting, but it lived in money.ts, which is the v1 rate card and
which v2 code must not import. Re-exported from money.ts so the existing v1
call sites are unchanged."
```

---

## Task 2: `lib/billing/pricingCopy.ts`

Six surfaces show pricing. Five hardcode what the sixth computes, which is why they can disagree. This module is the one source, and it derives everything from `rateCard.ts` so a reprice moves the copy.

Note the framing, which comes from an existing observation in `rateCard.test.ts`: **£129 is exactly two vehicles at £64.50**, so "£129 minimum" and "your first 2 vehicles included" are the same offer. The second is the honest way to lead with a floor.

**Files:**
- Create: `lib/billing/pricingCopy.ts`
- Test: `lib/billing/pricingCopy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/billing/pricingCopy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DISCOUNT_BANDS,
  PERIOD_DAYS,
  PERIOD_MINIMUM_PENCE,
  PERIOD_VEHICLE_PENCE,
  fleetPeriodPence,
} from "./rateCard";
import {
  BILLING_BASIS_SENTENCE,
  includedVehicleCount,
  pricingBandRows,
  pricingHeadline,
} from "./pricingCopy";

describe("includedVehicleCount", () => {
  // The floor and the per-vehicle rate are set independently. If someone
  // reprices one without the other, "your first N vehicles included" must
  // follow rather than keep claiming the old N.
  it("derives from the minimum and the headline rate", () => {
    expect(includedVehicleCount()).toBe(
      Math.floor(PERIOD_MINIMUM_PENCE / PERIOD_VEHICLE_PENCE)
    );
  });

  it("is 2 at today's prices", () => {
    expect(includedVehicleCount()).toBe(2);
  });

  // The whole reason the copy can say "included" rather than "minimum": a
  // fleet of exactly that size pays exactly the floor and not a penny more.
  it("names a fleet size that costs exactly the minimum", () => {
    expect(fleetPeriodPence(includedVehicleCount())).toBe(PERIOD_MINIMUM_PENCE);
  });
});

describe("pricingHeadline", () => {
  it("leads with the minimum, which is the lowest anyone actually pays", () => {
    const headline = pricingHeadline();
    expect(headline.fromPence).toBe(PERIOD_MINIMUM_PENCE);
    expect(headline.fromLabel).toBe("£129.00");
  });

  it("carries the per-vehicle rate and the period length", () => {
    const headline = pricingHeadline();
    expect(headline.perVehiclePence).toBe(PERIOD_VEHICLE_PENCE);
    expect(headline.perVehicleLabel).toBe("£64.50");
    expect(headline.periodDays).toBe(PERIOD_DAYS);
  });

  it("summarises the offer in one sentence", () => {
    expect(pricingHeadline().summary).toBe(
      "From £129.00 per 28 days, including your first 2 vehicles."
    );
  });
});

describe("pricingBandRows", () => {
  // The 0% band exists in the rate card as the base case. Printing "0% off"
  // on a pricing page advertises a discount that is not one.
  it("omits the zero-discount band", () => {
    expect(pricingBandRows().every((row) => row.discountPercent > 0)).toBe(true);
    expect(pricingBandRows()).toHaveLength(
      DISCOUNT_BANDS.filter((band) => band.discountPercent > 0).length
    );
  });

  it("labels each band by its threshold", () => {
    expect(pricingBandRows()[0]).toEqual({
      threshold: 10,
      discountPercent: 10,
      label: "10 or more vehicles",
      discountLabel: "10% off your whole fleet",
    });
  });

  it("orders by ascending threshold", () => {
    const thresholds = pricingBandRows().map((row) => row.threshold);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
  });
});

describe("BILLING_BASIS_SENTENCE", () => {
  // v2 is ARREARS. Saying "charged every 4 weeks" here, as the v1 copy does,
  // describes the opposite billing direction.
  it("says the period length and that it bills in arrears", () => {
    expect(BILLING_BASIS_SENTENCE).toContain("28");
    expect(BILLING_BASIS_SENTENCE).toContain("end of each");
    expect(BILLING_BASIS_SENTENCE).toContain("Excludes VAT");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/billing/pricingCopy.test.ts
```

Expected: FAIL, `Failed to resolve import "./pricingCopy"`.

- [ ] **Step 3: Write the implementation**

Create `lib/billing/pricingCopy.ts`:

```ts
// The single source for every public pricing string.
//
// Six surfaces display pricing: the landing page card, the landing page meta
// description, the landing page JSON-LD, the licences page, the super-admin
// billing page and the settings billing page. Five of them used to hardcode
// what the sixth computed, which is why they could disagree. Everything here
// derives from ./rateCard, so a reprice moves the copy instead of leaving it
// stale in five places.
//
// v2 (v2_period) ONLY. v1's graduated weekly bands are a different pricing
// shape and live in ./money.ts. Do not add v1 strings here; see CLAUDE.md.

import {
  DISCOUNT_BANDS,
  PERIOD_DAYS,
  PERIOD_MINIMUM_PENCE,
  PERIOD_VEHICLE_PENCE,
} from "./rateCard";
import { formatPence } from "./format";

/**
 * How many vehicles the minimum already pays for at the headline rate.
 *
 * This is what lets the public copy say "your first 2 vehicles included"
 * instead of "£129 minimum". They are arithmetically the same offer, and the
 * first is the honest way to lead with a floor: a customer reading "minimum"
 * hears a penalty, and a customer reading "included" hears what they get. It
 * is derived rather than written as 2 so that repricing either number keeps
 * the sentence true.
 */
export function includedVehicleCount(): number {
  return Math.floor(PERIOD_MINIMUM_PENCE / PERIOD_VEHICLE_PENCE);
}

export type PricingHeadline = {
  /** The lowest amount anyone actually pays, which is the real entry price. */
  fromPence: number;
  fromLabel: string;
  perVehiclePence: number;
  perVehicleLabel: string;
  periodDays: number;
  includedVehicles: number;
  summary: string;
};

/**
 * The entry price leads with the MINIMUM, not the per-vehicle rate.
 *
 * The floor exists to select for customers who can afford the product, and
 * that selection has to happen on the pricing page rather than after signup. A
 * customer who works out the floor once they are onboarded costs a refund and
 * a bad conversation; one who works it out on the pricing page costs nothing.
 */
export function pricingHeadline(): PricingHeadline {
  const includedVehicles = includedVehicleCount();
  return {
    fromPence: PERIOD_MINIMUM_PENCE,
    fromLabel: formatPence(PERIOD_MINIMUM_PENCE),
    perVehiclePence: PERIOD_VEHICLE_PENCE,
    perVehicleLabel: formatPence(PERIOD_VEHICLE_PENCE),
    periodDays: PERIOD_DAYS,
    includedVehicles,
    summary:
      `From ${formatPence(PERIOD_MINIMUM_PENCE)} per ${PERIOD_DAYS} days, ` +
      `including your first ${includedVehicles} vehicles.`,
  };
}

export type PricingBandRow = {
  threshold: number;
  discountPercent: number;
  label: string;
  discountLabel: string;
};

/**
 * The volume bands as a customer should read them.
 *
 * WHOLE FLEET, not marginal. v1's bands were graduated, so its copy had to say
 * "vehicles 51+" to avoid implying a 50-vehicle fleet paid £5 across the
 * board. v2 inverts that: the discount genuinely applies to every vehicle, so
 * "10% off your whole fleet" is the accurate phrasing and the v1 wording would
 * now understate the offer.
 *
 * The 0% base band is dropped. It is real in the rate card and meaningless on
 * a pricing page, where "0% off" advertises a discount that is not one.
 */
export function pricingBandRows(): PricingBandRow[] {
  return DISCOUNT_BANDS.filter((band) => band.discountPercent > 0).map(
    (band) => ({
      threshold: band.threshold,
      discountPercent: band.discountPercent,
      label: `${band.threshold} or more vehicles`,
      discountLabel: `${band.discountPercent}% off your whole fleet`,
    })
  );
}

/**
 * How and when the money is taken.
 *
 * v2 bills in ARREARS: the period is computed and charged when it closes. The
 * v1 copy this replaces said "charged every 4 weeks", which describes charging
 * in advance and is the opposite billing direction.
 */
export const BILLING_BASIS_SENTENCE =
  `Billed at the end of each ${PERIOD_DAYS}-day period, for the days each ` +
  `vehicle was licensed. Excludes VAT.`;

/**
 * The consequence of the discount cap, stated plainly.
 *
 * `fleetPeriodPence` prices a fleet at the cheapest band it could buy by
 * pretending to be that band's threshold, which is what makes the curve
 * monotonic. The visible effect is that 19 vehicles and 20 vehicles both cost
 * £1,032.00. That fails toward the customer and is better said than
 * discovered on an invoice.
 */
export const THRESHOLD_PARITY_SENTENCE =
  "A fleet just below a discount threshold pays the threshold price, so " +
  "growing never costs you more.";
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run lib/billing/pricingCopy.test.ts
```

Expected: PASS, all 10 tests.

- [ ] **Step 5: Full suite and typecheck**

```bash
npm test
npm run typecheck
```

Expected: 1151 tests pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/billing/pricingCopy.ts lib/billing/pricingCopy.test.ts
git commit -m "Add one source for every public pricing string

Six surfaces show pricing and five hardcoded what the sixth computed. This
derives all of them from rateCard.ts, so a reprice moves the copy.

Leads with the GBP 129 minimum rather than the per-vehicle rate, framed as
'your first 2 vehicles included' since the floor is exactly two vehicles at
the headline rate. Both halves of that are derived, not written down, so
repricing either number keeps the sentence true."
```

---

## Task 3: Extract `previewPeriodInvoice`

`computePeriodInvoice` claims the period, then does four things that write nothing. Those four move out so the preview route can call them. After this there is one implementation of "what does this period invoice", not two that could drift.

**Files:**
- Modify: `lib/billing/periodServer.ts:391-440`

- [ ] **Step 1: Add the new export**

Insert into `lib/billing/periodServer.ts`, immediately **above** `async function computePeriodInvoice(`:

```ts
/**
 * What a period would invoice, without writing anything.
 *
 * Extracted from computePeriodInvoice so the billing page and the close job
 * share ONE implementation. The alternative was for the page to fetch vehicles
 * and licences itself and assemble in the browser, which would have meant two
 * implementations of "which vehicles count and over what coverage window".
 * Any drift between them would make the page confidently display a figure the
 * close job never produces, which is precisely the class of fault the page
 * exists to expose.
 *
 * Safe to call on an open period. It reads rows and returns a computation; the
 * writing starts in computePeriodInvoice after this returns.
 */
export async function previewPeriodInvoice(
  admin: SupabaseClient,
  args: {
    companyId: string;
    periodStartISO: string;
    /** Exclusive, matching billing_periods.period_end. */
    periodEndISO: string;
    settings: CompanyBillingSettings;
  }
): Promise<AssembledInvoice> {
  const vehicleIds = await fetchCompanyVehicleIds(admin, args.companyId);
  const licences = await fetchCompanyLicences(admin, vehicleIds);

  const vehicles = collectPeriodVehicles({
    periodStartISO: args.periodStartISO,
    periodEndISO: args.periodEndISO,
    licences,
  });

  return assembleInvoice({
    periodStartISO: args.periodStartISO,
    periodEndISO: args.periodEndISO,
    vehicles,
    minBillDays: args.settings.min_bill_days,
    unitAmountPence: args.settings.unit_amount_pence,
    minimumPence: args.settings.min_invoice_pence,
    includedVehicles: args.settings.included_vehicles,
    vatRatePercent: args.settings.vat_rate ?? 20,
  });
}
```

- [ ] **Step 2: Import the `AssembledInvoice` type**

`lib/billing/periodServer.ts:13` currently reads:

```ts
import type { AssembledLine } from "./invoice";
```

Change it to:

```ts
import type { AssembledInvoice, AssembledLine } from "./invoice";
```

- [ ] **Step 3: Make `computePeriodInvoice` call it**

In `computePeriodInvoice`, replace this block (currently lines 421 to 439):

```ts
  const vehicleIds = await fetchCompanyVehicleIds(admin, period.company_id);
  const licences = await fetchCompanyLicences(admin, vehicleIds);

  const vehicles = collectPeriodVehicles({
    periodStartISO: period.period_start,
    periodEndISO: period.period_end,
    licences,
  });

  const vatRate = settings.vat_rate ?? 20;
  const invoice = assembleInvoice({
    periodStartISO: period.period_start,
    periodEndISO: period.period_end,
    vehicles,
    minBillDays: settings.min_bill_days,
    unitAmountPence: settings.unit_amount_pence,
    minimumPence: settings.min_invoice_pence,
    includedVehicles: settings.included_vehicles,
    vatRatePercent: vatRate,
  });
```

with:

```ts
  // vatRate stays here as well as inside previewPeriodInvoice: the closed
  // period row below stores it, so removing it from this scope breaks the
  // update rather than the calculation.
  const vatRate = settings.vat_rate ?? 20;
  const invoice = await previewPeriodInvoice(admin, {
    companyId: period.company_id,
    periodStartISO: period.period_start,
    periodEndISO: period.period_end,
    settings,
  });
```

**Do not delete `vatRate`.** It is read further down as `vat_rate: vatRate` when the period is marked closed. Deleting it compiles as an error, but only if you have not shadowed it, so check.

- [ ] **Step 4: Run the full suite**

```bash
npm test
npm run typecheck
```

Expected: 1151 tests pass. This is a pure refactor: any failure means the extraction changed behaviour. `assembleInvoice` may now be an unused import in `periodServer.ts` if nothing else calls it; `quoteVehicleAddition` still does, so it should remain used. If typecheck reports it unused, leave the import removal to the compiler's guidance rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/periodServer.ts
git commit -m "Extract previewPeriodInvoice from computePeriodInvoice

The four steps that fetch vehicles and licences and assemble the invoice write
nothing, so the billing page can call them directly. One implementation rather
than two that could drift: a browser-side projection would have had to
reproduce which vehicles count and over what coverage window, and any
disagreement would show a figure the close job never produces."
```

---

## Task 4: `GET /api/billing/preview`

**Files:**
- Create: `app/api/billing/preview/route.ts`

No `lib/auth/publicRoutes.ts` change. The route is authenticated, and `proxy.ts` answering 401 to an anonymous caller is correct.

- [ ] **Step 1: Write the route**

Create `app/api/billing/preview/route.ts`:

```ts
// What the open period would invoice if it closed today.
//
// Read only, and deliberately a server route rather than browser arithmetic:
// it calls previewPeriodInvoice, which is the same function closeDuePeriods
// calls, on the same rows. The number on the billing page is therefore the
// number the close job will produce by construction, not by agreement. See
// docs/superpowers/specs/2026-09-11-v2-billing-ui-and-pricing-design.md.

import { NextResponse } from "next/server";
import { errorResponse } from "../../../../lib/accounts/server";
import { requireCompanyAdmin } from "../../../../lib/billing/server";
import { previewPeriodInvoice } from "../../../../lib/billing/periodServer";
import type { CompanyBillingSettings } from "../../../../lib/billing/periodServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_SELECT =
  "company_id, billing_model, status, currency, unit_amount_pence, " +
  "min_invoice_pence, included_vehicles, grace_days, min_bill_days";

const PERIOD_SELECT =
  "id, period_start, period_end, status, prepaid_pence, attempt_count, retry_on";

/* 42P01 is "no such table", 42703 is "no such column". Either means billing_06
   has not been applied, in which case there is no v2 company in this world and
   nothing to preview. NARROW ON PURPOSE, mirroring closeDuePeriods: any other
   code is a real fault, and dressing it up as a reassuring message would hide
   the faults this page exists to surface. */
function isMissingSchema(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "42703";
}

export async function GET() {
  try {
    const { admin, companyId } = await requireCompanyAdmin();

    const settingsRes = await admin
      .from("company_billing")
      .select(SETTINGS_SELECT)
      .eq("company_id", companyId)
      .maybeSingle();

    if (settingsRes.error) {
      if (isMissingSchema(settingsRes.error)) {
        return NextResponse.json({ ok: true, unavailable: "migration" });
      }
      throw new Error(settingsRes.error.message);
    }

    const settings = settingsRes.data as CompanyBillingSettings | null;

    /* Refused rather than answered with v1 figures. A v1 company rendering a
       v2 projection would show a bill that will never be raised. */
    if (!settings || settings.billing_model !== "v2_period") {
      return NextResponse.json(
        { error: "This account is not on period billing." },
        { status: 409 }
      );
    }

    /* maybeSingle is safe: billing_06 carries a partial unique index allowing
       at most one open period per company. */
    const periodRes = await admin
      .from("billing_periods")
      .select(PERIOD_SELECT)
      .eq("company_id", companyId)
      .eq("status", "open")
      .maybeSingle();

    if (periodRes.error) {
      if (isMissingSchema(periodRes.error)) {
        return NextResponse.json({ ok: true, unavailable: "migration" });
      }
      throw new Error(periodRes.error.message);
    }

    const period = periodRes.data;

    /* A SUCCESS, not an error. A v2 company that has not yet activated a
       vehicle for billing has no open period, and that is a legitimate steady
       state. Answering 404 would put a red banner on a page where nothing is
       wrong and teach the reader to ignore the banner that matters. */
    if (!period) {
      return NextResponse.json({ ok: true, period: null });
    }

    const invoice = await previewPeriodInvoice(admin, {
      companyId,
      periodStartISO: period.period_start as string,
      periodEndISO: period.period_end as string,
      settings,
    });

    return NextResponse.json({
      ok: true,
      period,
      lines: invoice.lines,
      vehicleCount: invoice.vehicleCount,
      discountPercent: invoice.discountPercent,
      subtotalPence: invoice.subtotalPence,
      netPence: invoice.netPence,
      vatPence: invoice.vatPence,
      grossPence: invoice.grossPence,
      minimumPence: settings.min_invoice_pence,
    });
  } catch (error) {
    const mapped = errorResponse(error);
    if (mapped.status === 500) {
      console.error(
        "Period preview failed",
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      );
    }
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean. There is no unit test for this route: vitest does not cover `app/`, and the route's only logic is branching on database results that cannot be produced without a database. Every decision it makes has been pushed into `previewPeriodInvoice` and `assembleInvoice`, which are covered.

- [ ] **Step 3: Commit**

```bash
git add app/api/billing/preview/route.ts
git commit -m "Add the period preview endpoint

Answers what the open period would invoice today, by calling the same function
the close job calls. No open period is a success rather than an error: a v2
company that has not activated a vehicle legitimately has none, and a red
banner there would train the reader to ignore the banner that matters."
```

---

## Task 5: `lib/billing/periodView.ts`

The v2 page's view model. `V2Billing.tsx` renders what this returns and decides nothing itself, because vitest reaches `lib/` and not `app/`.

**Files:**
- Create: `lib/billing/periodView.ts`
- Test: `lib/billing/periodView.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/billing/periodView.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  NO_PERIOD_REASONS,
  periodProgress,
  pricingExplanation,
  type PreviewLine,
} from "./periodView";

function vehicleLine(netPence: number, vrn = "AB12CDE"): PreviewLine {
  return {
    kind: "vehicle",
    vehicleId: "v1",
    vrnNormalised: vrn,
    coverageStartISO: "2026-09-10",
    coverageEndISO: "2026-10-08",
    actualDays: 28,
    billableDays: 28,
    unitAmountPence: 6450,
    netPence,
    includedInPlan: false,
    description: `${vrn}, 28 days`,
  };
}

function adjustmentLine(kind: PreviewLine["kind"], netPence: number): PreviewLine {
  return {
    kind,
    vehicleId: null,
    vrnNormalised: null,
    coverageStartISO: null,
    coverageEndISO: null,
    actualDays: 0,
    billableDays: 0,
    unitAmountPence: 0,
    netPence,
    includedInPlan: false,
    description: kind,
  };
}

describe("periodProgress", () => {
  it("counts the first day as day 1, not day 0", () => {
    const progress = periodProgress({
      periodStartISO: "2026-09-10",
      periodEndISO: "2026-10-08",
      todayISO: "2026-09-10",
    });
    expect(progress.dayOfPeriod).toBe(1);
    expect(progress.totalDays).toBe(28);
    expect(progress.label).toBe("Day 1 of 28");
  });

  it("counts a day in the middle", () => {
    expect(
      periodProgress({
        periodStartISO: "2026-09-10",
        periodEndISO: "2026-10-08",
        todayISO: "2026-09-13",
      }).dayOfPeriod
    ).toBe(4);
  });

  // A period whose end has arrived but which the cron has not yet closed is a
  // real and common state: the job runs once a day. Reporting "Day 31 of 28"
  // would read as a fault when nothing is wrong.
  it("clamps a period whose end has passed but which is not yet closed", () => {
    const progress = periodProgress({
      periodStartISO: "2026-09-10",
      periodEndISO: "2026-10-08",
      todayISO: "2026-10-11",
    });
    expect(progress.dayOfPeriod).toBe(28);
    expect(progress.daysRemaining).toBe(0);
  });

  // Cancellation cuts a period short, so period_end is not always start + 28.
  it("uses the stored end rather than assuming 28 days", () => {
    expect(
      periodProgress({
        periodStartISO: "2026-09-10",
        periodEndISO: "2026-09-17",
        todayISO: "2026-09-12",
      }).totalDays
    ).toBe(7);
  });
});

describe("pricingExplanation", () => {
  it("explains a bill the minimum is carrying", () => {
    expect(
      pricingExplanation({
        lines: [vehicleLine(6450), adjustmentLine("minimum_adjustment", 6450)],
        vehicleCount: 1,
        minimumPence: 12900,
        discountPercent: 0,
      })
    ).toBe(
      "The £129.00 minimum exceeds your 1 vehicle at £64.50, so the minimum applies."
    );
  });

  // THE BOUNDARY. Two vehicles cost exactly £129.00, which EQUALS the minimum
  // rather than falling below it, so assembleInvoice raises no adjustment line.
  // Saying "the minimum applies" here would be true of the number and false of
  // the bill.
  it("says nothing at exactly the minimum, where no adjustment is raised", () => {
    expect(
      pricingExplanation({
        lines: [vehicleLine(6450, "AB12CDE"), vehicleLine(6450, "XY98ZZZ")],
        vehicleCount: 2,
        minimumPence: 12900,
        discountPercent: 0,
      })
    ).toBeNull();
  });

  it("explains a whole-fleet discount", () => {
    expect(
      pricingExplanation({
        lines: [vehicleLine(64500), adjustmentLine("volume_discount", -6450)],
        vehicleCount: 10,
        minimumPence: 12900,
        discountPercent: 10,
      })
    ).toBe("10% off your whole fleet, saving £64.50.");
  });

  it("prefers the minimum when both lines are present", () => {
    const explanation = pricingExplanation({
      lines: [
        vehicleLine(6450),
        adjustmentLine("volume_discount", -645),
        adjustmentLine("minimum_adjustment", 7095),
      ],
      vehicleCount: 1,
      minimumPence: 12900,
      discountPercent: 10,
    });
    expect(explanation).toContain("minimum applies");
  });

  it("says nothing when only vehicle lines are involved", () => {
    expect(
      pricingExplanation({
        lines: [vehicleLine(6450), vehicleLine(6450), vehicleLine(6450)],
        vehicleCount: 3,
        minimumPence: 12900,
        discountPercent: 0,
      })
    ).toBeNull();
  });
});

describe("NO_PERIOD_REASONS", () => {
  // This list replaces the SQL diagnostic in the 2026-09-10 handoff. If it
  // shrinks, a cause has stopped being explained to the person looking at a
  // page that shows no charge.
  it("lists every cause of a missing period", () => {
    expect(NO_PERIOD_REASONS).toHaveLength(3);
    expect(NO_PERIOD_REASONS.every((reason) => reason.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/billing/periodView.test.ts
```

Expected: FAIL, `Failed to resolve import "./periodView"`.

- [ ] **Step 3: Write the implementation**

Create `lib/billing/periodView.ts`:

```ts
// View model for the v2 billing page.
//
// app/settings/billing/V2Billing.tsx renders what this returns and decides
// nothing itself. vitest covers lib/ and not app/, so a decision made in the
// component is a decision nothing asserts.

import { daysBetween } from "./schedule";
import { formatPence } from "./format";

/** One line as /api/billing/preview returns it. Mirrors invoice.ts's AssembledLine. */
export type PreviewLine = {
  kind: "vehicle" | "volume_discount" | "minimum_adjustment";
  vehicleId: string | null;
  vrnNormalised: string | null;
  coverageStartISO: string | null;
  coverageEndISO: string | null;
  actualDays: number;
  billableDays: number;
  unitAmountPence: number;
  netPence: number;
  includedInPlan: boolean;
  description: string;
};

export type PeriodProgress = {
  /** 1 on the first day. */
  dayOfPeriod: number;
  totalDays: number;
  daysRemaining: number;
  label: string;
};

/**
 * Where today falls inside the open period.
 *
 * Clamped at both ends. A period whose end has arrived but which the nightly
 * cron has not yet closed is a normal state that can last most of a day, and
 * "Day 31 of 28" reads as a fault when nothing is wrong.
 *
 * totalDays comes from the stored period_end rather than PERIOD_DAYS, because
 * cancellation cuts a period short and a cancelled period is exactly when
 * someone will be reading this page closely.
 */
export function periodProgress(args: {
  periodStartISO: string;
  /** Exclusive, matching billing_periods.period_end. */
  periodEndISO: string;
  todayISO: string;
}): PeriodProgress {
  const totalDays = Math.max(
    1,
    daysBetween(args.periodStartISO, args.periodEndISO)
  );
  const elapsed = daysBetween(args.periodStartISO, args.todayISO);
  const dayOfPeriod = Math.min(Math.max(elapsed + 1, 1), totalDays);
  return {
    dayOfPeriod,
    totalDays,
    daysRemaining: totalDays - dayOfPeriod,
    label: `Day ${dayOfPeriod} of ${totalDays}`,
  };
}

/**
 * Why the total is what it is, in one sentence, or null when only the vehicle
 * lines are involved.
 *
 * Derived from the lines the invoice actually produced rather than recomputed
 * from the fleet size, so the sentence and the figures beside it cannot
 * disagree. That matters most where they would diverge: a capped fleet is
 * priced by a band it does not nominally sit in, so a sentence written from
 * the vehicle count would quote a percentage the amount does not match.
 *
 * The minimum counts as binding only when its adjustment line is strictly
 * positive. At exactly two vehicles the fleet price EQUALS the GBP 129
 * minimum, assembleInvoice raises no adjustment, and "the minimum applies"
 * would be true of the number and false of the bill.
 */
export function pricingExplanation(args: {
  lines: readonly PreviewLine[];
  vehicleCount: number;
  minimumPence: number;
  discountPercent: number;
}): string | null {
  const minimum = args.lines.find((line) => line.kind === "minimum_adjustment");
  if (minimum && minimum.netPence > 0) {
    const fleetPence = args.lines
      .filter((line) => line.kind !== "minimum_adjustment")
      .reduce((total, line) => total + line.netPence, 0);
    const vehicles =
      args.vehicleCount === 1 ? "1 vehicle" : `${args.vehicleCount} vehicles`;
    return (
      `The ${formatPence(args.minimumPence)} minimum exceeds your ` +
      `${vehicles} at ${formatPence(fleetPence)}, so the minimum applies.`
    );
  }

  const discount = args.lines.find((line) => line.kind === "volume_discount");
  if (discount && discount.netPence < 0) {
    return (
      `${args.discountPercent}% off your whole fleet, saving ` +
      `${formatPence(Math.abs(discount.netPence))}.`
    );
  }

  return null;
}

/**
 * Why a v2 company can have no open period.
 *
 * Every one of these is a legitimate state that the activation route reports
 * as ok:true with no charge, which is indistinguishable from success in a UI
 * that does not say so out loud. This list is the SQL diagnostic from the
 * 2026-09-10 handoff, moved into the product so the page answers the question
 * instead of the reader querying for it.
 *
 * "A period was already open" is deliberately NOT here: it is a cause of an
 * unexpected zero charge, but it cannot be a cause of a MISSING period. It is
 * explained on the open-period view instead.
 */
export const NO_PERIOD_REASONS: readonly string[] = [
  "The licence was not ticked as active for billing. An inactive licence is a compliance record and costs nothing.",
  "The vehicle is already billable through another active licence. Billing is per vehicle, not per licence, and one vehicle can hold several.",
  "This company is not on period billing after all. Check billing_model on company_billing.",
];

/**
 * Why adding a vehicle to an OPEN period takes no money.
 *
 * The other half of the same confusion. v2 bills in arrears, so a mid-period
 * addition is an insert that moves nothing until the period closes. A customer
 * who expects the v1 behaviour reads that silence as a failure.
 */
export const MID_PERIOD_ADDITION_NOTE =
  "Adding a vehicle mid-period takes no payment. It is billed for the days it " +
  "was licensed when this period closes.";
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run lib/billing/periodView.test.ts
```

Expected: PASS, all 10 tests.

- [ ] **Step 5: Full suite and typecheck**

```bash
npm test
npm run typecheck
```

Expected: 1161 tests pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/billing/periodView.ts lib/billing/periodView.test.ts
git commit -m "Add the v2 billing page view model

Keeps the decisions in lib/, where vitest reaches them, so the component only
renders. Covers the boundary that reads two ways: at exactly two vehicles the
fleet price EQUALS the GBP 129 minimum, no adjustment line is raised, and
saying the minimum applies would be true of the number and false of the bill.

Also carries the no-open-period diagnostic from the 2026-09-10 handoff, so the
page answers the question the SQL used to."
```

---

## Task 6: Split `page.tsx` into a shell and `V1Billing`

Pure move. No behaviour change for a v1 company, which is every company today. Do this as its own commit so that if a v1 regression appears later, `git bisect` lands on a diff that only moves code.

**Files:**
- Modify: `app/settings/billing/page.tsx`
- Create: `app/settings/billing/V1Billing.tsx`

- [ ] **Step 1: Create `V1Billing.tsx` from the current page body**

Create `app/settings/billing/V1Billing.tsx` containing, **verbatim and in this order**, everything currently in `page.tsx` except the `PageFrame` function and the `BillingSettingsPage` default export's role-gate branches:

1. The `"use client";` directive.
2. All imports currently at the top of `page.tsx` except `TenantGate`.
3. The type declarations `ChargeRow`, `AddonChargeRow`, `LoadError`.
4. `HISTORY_LIMIT`, `addonLabel`, `toChargeRow`, `CHARGE_COLUMNS`.
5. The body of `BillingSettingsPage` from `const supabase = useMemo(...)` down to the closing `}`, renamed and re-signed as below.

Change only these three things:

- Rename the default export from `BillingSettingsPage` to `V1Billing`.
- Delete the two role-gate blocks (the `super_admin` banner and the non-admin banner). The shell owns them now.
- Replace every `<PageFrame>...</PageFrame>` wrapper in the return with a bare fragment `<>...</>`. The shell supplies the frame.

Add this header comment at the top of the file, under the `"use client";` line:

```tsx
/* The v1_immediate billing body: charge in advance every 4 weeks, pro-rata the
   moment a vehicle is added. Split out of page.tsx unchanged when v2 arrived.
   Every company is still on this model.

   Reads platform_charges and vehicle_addon_charges, prices with
   lib/billing/money.ts. Do NOT import anything from ./rateCard or
   ./pricingCopy here: those are v2's pricing shape and mean different things.
   See CLAUDE.md. */
```

- [ ] **Step 2: Rewrite `page.tsx` as the shell**

Replace the entire contents of `app/settings/billing/page.tsx` with:

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";
import V1Billing from "./V1Billing";
import V2Billing from "./V2Billing";

/* Shell for the billing page. Owns the role gates and ONE query, then hands
   off to the body for whichever billing model this company is on.

   Two models run side by side (see CLAUDE.md): v1_immediate charges in advance
   every 4 weeks, v2_period bills in arrears when a 28-day period closes. They
   have different pricing shapes, different tables and different vocabulary, so
   they get a body each rather than a shared one full of conditionals. */

type BillingModelRow = {
  billing_model?: string | null;
};

function PageFrame({
  description,
  children,
}: {
  /* Withheld rather than defaulted while the model is unknown. Defaulting to
     the v1 sentence would flash "£10 per active licensed vehicle per week" at
     a v2 admin before correcting itself, and a wrong price shown briefly is
     worse than an obvious loading state. */
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Admin</div>
            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Billing
            </h1>
            <p className="m-0 text-sm text-ink-3">{description}</p>
          </header>
          {children}
        </main>
      </div>
    </TenantGate>
  );
}

export default function BillingSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [model, setModel] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const loadModel = useCallback(async () => {
    setModelError(null);
    try {
      /* select("*") is deliberate and must not be narrowed to the columns
         actually used. billing_model is a billing_06 column: on a deploy where
         that migration has not been applied, "*" returns a row without the
         field and the company reads as v1, which is correct. An explicit
         select("billing_model, ...") would instead answer PostgREST 42703 and
         fail this page for EVERY v1 company. */
      const { data, error } = await supabase
        .from("company_billing")
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      setModel((data as BillingModelRow | null)?.billing_model ?? null);
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "Unexpected error");
    } finally {
      setModelLoaded(true);
    }
  }, [supabase]);

  useEffect(() => {
    /* Only the one role that can see this page. A super_admin's RLS scope
       returns every company's rows, so maybeSingle() would error. */
    if (tenant.status !== "ready" || tenant.role !== "admin") return;
    void loadModel();
  }, [loadModel, tenant.status, tenant.role]);

  /* Role gates apply only once status is ready. Before that, role is the
     provider's placeholder and every admin would see the staff notice flash. */
  if (tenant.status === "ready" && tenant.role === "super_admin") {
    return (
      <PageFrame description={null}>
        <MessageBanner tone="info">
          Platform billing for all companies lives in the super-admin console.{" "}
          <Link href="/super-admin/billing" className="underline">
            Go to super-admin billing
          </Link>
        </MessageBanner>
      </PageFrame>
    );
  }

  if (tenant.status === "ready" && tenant.role !== "admin") {
    return (
      <PageFrame description={null}>
        <MessageBanner tone="info">
          Billing is managed by your company admin.
        </MessageBanner>
      </PageFrame>
    );
  }

  if (!modelLoaded) {
    return (
      <PageFrame description={<Skeleton display="inline-block" w="34ch" h="0.875rem" />}>
        <span className="sr-only" role="status">
          Loading billing
        </span>
      </PageFrame>
    );
  }

  if (modelError) {
    return (
      <PageFrame description={null}>
        <MessageBanner tone="danger">
          Could not load billing data: {modelError}
        </MessageBanner>
      </PageFrame>
    );
  }

  /* FAIL CLOSED on anything that is not exactly the v2 string, undefined
     included. A company wrongly rendered as v1 sees a stale but harmless page;
     one wrongly rendered as v2 sees a bill that does not exist. */
  const isV2 = model === "v2_period";

  return isV2 ? (
    <PageFrame description={<V2Billing.Description />}>
      <V2Billing />
    </PageFrame>
  ) : (
    <PageFrame description={<V1Billing.Description />}>
      <V1Billing />
    </PageFrame>
  );
}
```

- [ ] **Step 3: Attach the description to `V1Billing`**

At the bottom of `app/settings/billing/V1Billing.tsx`, after the component:

```tsx
/* Attached to the component rather than exported separately so the shell gets
   the body and its header sentence from one import and they cannot fall out of
   step. v1 copy stays hardcoded here: lib/billing/pricingCopy.ts is v2 only. */
V1Billing.Description = function V1Description() {
  return (
    <>
      £10 per active licensed vehicle per week, plus VAT, and less per vehicle
      as the fleet grows. Charged to your card every 4 weeks.
    </>
  );
};
```

- [ ] **Step 4: Typecheck (it will fail, and that is expected)**

```bash
npm run typecheck
```

Expected: FAIL, `Cannot find module './V2Billing'`. Task 7 creates it. If you want a clean checkpoint here instead, create `V2Billing.tsx` as a stub returning `null` with a `Description` returning `null`, and replace it wholesale in Task 7.

- [ ] **Step 5: Commit after Task 7**

This task and Task 7 share one commit, because the shell does not compile without `V2Billing`.

---

## Task 7: `V2Billing.tsx`

**Files:**
- Create: `app/settings/billing/V2Billing.tsx`

- [ ] **Step 1: Write the component**

Create `app/settings/billing/V2Billing.tsx`:

```tsx
"use client";

/* The v2_period billing body: bills in ARREARS when a 28-day period closes.
   Adding a vehicle mid-period moves no money.

   Designed as an instrument as much as a bill. The v2 path had never charged
   when this was written, and all four early exits in the activation route
   return ok:true with no charge, which is indistinguishable from success. So
   the no-period state is a designed screen carrying the diagnostic, not an
   empty table.

   Prices with lib/billing/rateCard.ts via the preview endpoint. Do NOT import
   lib/billing/money.ts here: that is v1's graduated weekly shape. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import Badge from "../../../components/Badge";
import Card from "../../../components/Card";
import DataTable, {
  type Column,
  type DataTableState,
} from "../../../components/DataTable";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";
import Stat from "../../../components/Stat";
import { formatPence, formatCycleDate } from "../../../lib/billing/format";
import { londonDateISO } from "../../../lib/billing/schedule";
import {
  MID_PERIOD_ADDITION_NOTE,
  NO_PERIOD_REASONS,
  periodProgress,
  pricingExplanation,
  type PreviewLine,
} from "../../../lib/billing/periodView";
import {
  BILLING_BASIS_SENTENCE,
  pricingHeadline,
} from "../../../lib/billing/pricingCopy";
import PaymentMethodCard, { type BillingRow } from "./PaymentMethodCard";

type PreviewPeriod = {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  prepaid_pence: number;
  attempt_count: number;
  retry_on: string | null;
};

type PreviewResponse = {
  ok: true;
  unavailable?: "migration";
  period?: PreviewPeriod | null;
  lines?: PreviewLine[];
  vehicleCount?: number;
  discountPercent?: number;
  subtotalPence?: number;
  netPence?: number;
  vatPence?: number;
  grossPence?: number;
  minimumPence?: number;
};

/* A settled charge attempt against a period. Distinct from a projection: this
   is money that moved, or tried to. */
type PeriodCharge = {
  id: string;
  billing_period_id: string;
  kind: "minimum" | "balance";
  attempt: number;
  gross_pence: number;
  status: "pending" | "succeeded" | "failed" | "refunded";
  failure_code: string | null;
  receipt_url: string | null;
  created_at: string;
};

/* Each region withholds only what it cannot vouch for: a failed charge history
   must not hide a valid card, and a failed preview must not hide a charge the
   customer has actually paid. */
type LoadError = {
  message: string;
  billing: boolean;
  preview: boolean;
  charges: boolean;
};

const HISTORY_LIMIT = 24;

const CHARGE_TONE: Record<PeriodCharge["status"], "success" | "danger" | "warning" | "neutral"> = {
  succeeded: "success",
  failed: "danger",
  pending: "warning",
  refunded: "neutral",
};

const CHARGE_LABEL: Record<PeriodCharge["status"], string> = {
  succeeded: "Paid",
  failed: "Failed",
  pending: "Pending",
  /* Distinct from failed on purpose: a refunded charge DID collect and was
     then given back under cooling-off. Calling it "failed" would describe a
     period that never collected. */
  refunded: "Refunded",
};

const CHARGE_COLUMNS: Column<PeriodCharge>[] = [
  {
    header: "Date",
    cell: (c) => (
      <span className="font-mono">{formatCycleDate(c.created_at.slice(0, 10))}</span>
    ),
  },
  {
    header: "For",
    cell: (c) => (
      <div>
        <span>{c.kind === "minimum" ? "Period minimum" : "Period balance"}</span>
        {c.attempt > 1 ? (
          <span className="ml-2 text-xs text-ink-3">attempt {c.attempt}</span>
        ) : null}
      </div>
    ),
  },
  {
    header: "Amount",
    align: "right",
    cell: (c) => (
      <span className="font-mono tabular-nums">{formatPence(c.gross_pence)}</span>
    ),
  },
  {
    header: "Status",
    cell: (c) => (
      <div>
        <Badge tone={CHARGE_TONE[c.status]}>{CHARGE_LABEL[c.status]}</Badge>
        {c.failure_code ? (
          <div className="mt-0.5 text-xs text-ink-3">{c.failure_code}</div>
        ) : null}
      </div>
    ),
  },
  {
    header: "Receipt",
    cell: (c) =>
      c.receipt_url ? (
        <a
          href={c.receipt_url}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View
        </a>
      ) : (
        <span className="text-ink-3">-</span>
      ),
  },
];

function LineRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-start justify-between gap-4 py-1.5 text-sm",
        strong ? "font-semibold text-ink" : muted ? "text-ink-3" : "text-ink-2",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums slashed-zero text-ink">{value}</span>
    </div>
  );
}

export default function V2Billing() {
  const supabase = useMemo(() => createClient(), []);

  const [billing, setBilling] = useState<BillingRow | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [charges, setCharges] = useState<PeriodCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "warning" } | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      /* No filterByTenant on either query. This is the bill, not an
         operational view: the period spans every tenant under the company, and
         RLS scopes both tables to the admin's own company. */
      const [billingRes, chargesRes, previewRes] = await Promise.all([
        supabase.from("company_billing").select("*").maybeSingle(),
        supabase
          .from("period_charges")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT),
        fetch("/api/billing/preview", { cache: "no-store" }),
      ]);

      let previewBody: PreviewResponse | null = null;
      let previewFailed = false;
      if (previewRes.ok) {
        previewBody = (await previewRes.json()) as PreviewResponse;
      } else {
        previewFailed = true;
      }

      const firstError = billingRes.error ?? chargesRes.error;
      setLoadError(
        firstError || previewFailed
          ? {
              message:
                firstError?.message ??
                `The period preview could not be loaded (${previewRes.status}).`,
              billing: Boolean(billingRes.error),
              preview: previewFailed,
              charges: Boolean(chargesRes.error),
            }
          : null
      );

      setBilling((billingRes.data as BillingRow | null) ?? null);
      setCharges((chargesRes.data as PeriodCharge[] | null) ?? []);
      setPreview(previewBody);
    } catch (error) {
      /* A thrown client error rather than a returned .error. Without this the
         finally below flips hasLoaded and the page renders a confident zero
         state with no banner. */
      setLoadError({
        message: error instanceof Error ? error.message : "Unexpected error",
        billing: true,
        preview: true,
        charges: true,
      });
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = loading || !hasLoaded;
  const period = preview?.period ?? null;
  const lines = preview?.lines ?? [];
  const migrationMissing = preview?.unavailable === "migration";

  const progress = period
    ? periodProgress({
        periodStartISO: period.period_start,
        periodEndISO: period.period_end,
        todayISO: londonDateISO(new Date()),
      })
    : null;

  const explanation =
    period && preview
      ? pricingExplanation({
          lines,
          vehicleCount: preview.vehicleCount ?? 0,
          minimumPence: preview.minimumPence ?? 0,
          discountPercent: preview.discountPercent ?? 0,
        })
      : null;

  /* Withheld, never rendered as £0.00. A confident zero on a billing page is a
     lie with financial consequences. */
  const money = (pence: number | undefined): string =>
    loadError?.preview || pence === undefined ? "-" : formatPence(pence);

  const tableState: DataTableState = busy
    ? "loading"
    : loadError?.charges
      ? "error"
      : charges.length === 0
        ? "empty"
        : "ready";

  return (
    <>
      <MessageBanner tone="danger">
        {loadError ? `Could not load billing data: ${loadError.message}` : ""}
      </MessageBanner>
      <MessageBanner tone="warning">
        {migrationMissing
          ? "Period billing tables are not present in this database yet. Apply docs/sql/billing_06_period_billing.sql."
          : ""}
      </MessageBanner>
      <MessageBanner tone="danger">
        {billing?.status === "past_due"
          ? "Your last payment failed. Replace your card below to bring your account back up to date."
          : ""}
      </MessageBanner>
      <MessageBanner tone={notice?.tone ?? "success"}>{notice?.text ?? ""}</MessageBanner>

      <div aria-busy={busy || undefined}>
        {busy ? (
          <span className="sr-only" role="status">
            Loading billing
          </span>
        ) : null}

        <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label="Current period"
            value={
              busy ? (
                <Skeleton display="inline-block" w="16ch" h="1.25rem" />
              ) : period ? (
                `${formatCycleDate(period.period_start)} to ${formatCycleDate(period.period_end)}`
              ) : (
                "None open"
              )
            }
          />
          <Stat
            label="Progress"
            value={
              busy ? (
                <Skeleton display="inline-block" w="10ch" h="1.25rem" />
              ) : (
                progress?.label ?? "-"
              )
            }
            sub={progress ? `${progress.daysRemaining} days remaining` : undefined}
          />
          <Stat
            label="Vehicles counted"
            value={
              busy ? (
                <Skeleton display="inline-block" w="2.5ch" h="1.25rem" />
              ) : loadError?.preview || !period ? (
                "-"
              ) : (
                String(preview?.vehicleCount ?? 0)
              )
            }
            sub={period ? "billable so far this period" : undefined}
          />
          <Stat
            label="Projected total"
            value={
              busy ? (
                <Skeleton display="inline-block" w="8ch" h="1.25rem" />
              ) : period ? (
                money(preview?.grossPence)
              ) : (
                "-"
              )
            }
            sub={period ? "inc VAT, if it closed today" : undefined}
          />
        </div>

        {!busy && !period && !migrationMissing ? (
          <Card kicker="No open period" className="mb-6">
            <p className="m-0 text-sm text-ink-2">
              Nothing is being billed right now. A period opens when the first
              vehicle is activated for billing, so if you expected a charge, one
              of these is the reason:
            </p>
            <ul className="mb-0 mt-2 list-disc pl-5 text-sm text-ink-2">
              {NO_PERIOD_REASONS.map((reason) => (
                <li key={reason} className="py-0.5">
                  {reason}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {!busy && period ? (
          <Card kicker="This period, if it closed today" className="mb-6">
            <p className="m-0 text-xs text-ink-3">
              A projection, not an invoice. These figures are produced by the
              same calculation that will run when the period closes.
            </p>

            <div className="mt-3 border-t border-line pt-1">
              {lines.map((line, index) => (
                <LineRow
                  key={`${line.kind}-${line.vehicleId ?? index}`}
                  label={line.description}
                  value={formatPence(line.netPence)}
                  muted={line.kind !== "vehicle"}
                />
              ))}
            </div>

            <div className="mt-1 border-t border-line pt-1">
              <LineRow label="Net" value={money(preview?.netPence)} />
              <LineRow label="VAT" value={money(preview?.vatPence)} />
              <LineRow label="Total" value={money(preview?.grossPence)} strong />
            </div>

            {explanation ? (
              <p className="mb-0 mt-3 text-sm text-ink-2">{explanation}</p>
            ) : null}
            <p className="mb-0 mt-1 text-xs text-ink-3">{MID_PERIOD_ADDITION_NOTE}</p>
          </Card>
        ) : null}

        <div className="mb-6 grid gap-3 md:grid-cols-2">
          <PaymentMethodCard
            loading={busy}
            billing={billing}
            loadError={Boolean(loadError?.billing)}
            showForm={showCardForm}
            onReplace={() => {
              setNotice(null);
              setShowCardForm(true);
            }}
            onCancel={() => setShowCardForm(false)}
            onComplete={(response) => {
              setShowCardForm(false);
              /* No firstCharge branch. v2 takes no money when a card is saved:
                 the period is charged when it closes. A "subscription started,
                 £X charged" notice here would announce a payment that did not
                 happen. */
              setNotice(
                response.retried && response.succeeded === false
                  ? {
                      tone: "warning",
                      text: `New card saved, but the outstanding charge was declined (${String(response.failureCode ?? "declined")}). It will be retried automatically.`,
                    }
                  : { tone: "success", text: "Card updated." }
              );
              void load();
            }}
          />
          <Card kicker="Your plan">
            <p className="m-0 text-sm text-ink-2">{pricingHeadline().summary}</p>
            <p className="mb-0 mt-1 text-sm text-ink-3">{BILLING_BASIS_SENTENCE}</p>
          </Card>
        </div>

        <h2 className="mb-2 mt-0 text-base font-semibold text-ink">
          Charge history
        </h2>
        <DataTable
          columns={CHARGE_COLUMNS}
          rows={charges}
          rowKey={(c) => c.id}
          state={tableState}
          errorMessage="Couldn't load charge history."
          onRetry={load}
          emptyTitle="No charges yet"
          emptyDescription="Your first charge appears here after a period closes."
        />
      </div>
    </>
  );
}

V2Billing.Description = function V2Description() {
  const headline = pricingHeadline();
  return (
    <>
      {headline.fromLabel} per {headline.periodDays} days, including your first{" "}
      {headline.includedVehicles} vehicles, then {headline.perVehicleLabel} per
      vehicle. Billed at the end of each period, plus VAT.
    </>
  );
};
```

- [ ] **Step 2: Widen `BillingRow.next_charge_on` to allow null**

`app/settings/billing/PaymentMethodCard.tsx:19` declares:

```ts
  next_charge_on: string;
```

Change it to:

```ts
  /* Null on a v2_period company: next_charge_on drives the v1 4-weekly cron
     and a period-billed company has no such date. PaymentMethodCard itself
     never reads this field; V1Billing does, and already guards with
     `billing?.next_charge_on ? ... : "-"`, so widening breaks nothing. */
  next_charge_on: string | null;
```

Without this, a v2 row typed as `BillingRow` is a lie: the cast in `load` would compile while the value is null.

No change is needed to `onComplete`. Its parameter is `Record<string, unknown>`, and `V1Billing` already uses the exact `response.retried && response.succeeded === false` pattern reproduced above, so it typechecks unchanged.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Run the suite**

```bash
npm test
```

Expected: 1161 tests pass. Nothing here is covered directly; this confirms the Task 6 move broke nothing in `lib/`.

- [ ] **Step 5: Commit Tasks 6 and 7 together**

```bash
git add app/settings/billing/page.tsx app/settings/billing/V1Billing.tsx app/settings/billing/V2Billing.tsx app/settings/billing/PaymentMethodCard.tsx
git commit -m "Split the billing page by billing model

page.tsx becomes a shell owning the role gates and one company_billing query,
then hands off to a body per model. The two models have different pricing
shapes, tables and vocabulary; sharing one body would have meant state
variables meaning different things depending on a flag.

The shell keeps select('*') deliberately. billing_model is a billing_06
column, so on a deploy before that migration '*' returns a row without it and
the company reads as v1, which is right. An explicit column list would answer
42703 and fail the page for every v1 company.

The v2 body is an instrument as much as a bill: the no-period state carries
the diagnostic from the 2026-09-10 handoff, because all four early exits in
the activation path look like success."
```

---

## Task 8: Move every pricing surface to v2

**Files:**
- Modify: `lib/billing/rateCard.ts` (comment defect)
- Modify: `components/landing/PricingCard.tsx`
- Modify: `app/page.tsx`
- Modify: `app/settings/licences/page.tsx`
- Modify: `app/super-admin/billing/page.tsx`

- [ ] **Step 1: Fix the `rateCard.ts` comment defect**

In `lib/billing/rateCard.ts`, in the doc comment above `fleetPeriodPence`, find:

```
 * The visible consequence is that fleets just under a threshold pay the
 * threshold price: 18, 19 and 20 vehicles all cost GBP 1032.00. That is
 * intended. It is the honest form of the promise, and it fails toward the
 * customer.
```

Replace with:

```
 * The visible consequence is that a fleet just under a threshold pays the
 * threshold price: 19 and 20 vehicles both cost GBP 1032.00. That is intended.
 * It is the honest form of the promise, and it fails toward the customer.
 *
 * This previously read "18, 19 and 20", which is wrong and was quotable to a
 * customer. 18 costs GBP 986.85: the 15% band gives 18 x 6450 x 0.85 = 98685,
 * which beats the 20 band's 103200, so the cap does not fire at 18.
```

- [ ] **Step 2: Pin the correction with a test**

Append to `lib/billing/rateCard.test.ts`:

```ts
describe("threshold cap", () => {
  // These three were documented as equal and are not. The comment above
  // fleetPeriodPence said "18, 19 and 20 vehicles all cost GBP 1032.00",
  // which is the kind of sentence that gets quoted to a customer.
  it("prices 19 and 20 the same, and 18 strictly cheaper", () => {
    expect(fleetPeriodPence(19)).toBe(fleetPeriodPence(20));
    expect(fleetPeriodPence(18)).toBeLessThan(fleetPeriodPence(19));
    expect(fleetPeriodPence(18)).toBe(98685);
    expect(fleetPeriodPence(20)).toBe(103200);
  });

  // The other cap effect, which the copy does describe correctly.
  it("makes the tenth vehicle free", () => {
    expect(fleetPeriodPence(9)).toBe(fleetPeriodPence(10));
  });
});
```

- [ ] **Step 3: Run it**

```bash
npx vitest run lib/billing/rateCard.test.ts
```

Expected: PASS. If `fleetPeriodPence(18)` is not 98685, stop: the rate card has changed since this plan was written and the public copy needs recalculating before you write it.

- [ ] **Step 4: Rewrite the landing pricing card**

Replace the entire contents of `components/landing/PricingCard.tsx` with:

```tsx
import Container from "../Container";
import { buttonClasses } from "../Button";
import {
  BILLING_BASIS_SENTENCE,
  THRESHOLD_PARITY_SENTENCE,
  pricingBandRows,
  pricingHeadline,
} from "../../lib/billing/pricingCopy";

/* Every string here is derived from lib/billing/rateCard.ts through
   pricingCopy, so a reprice moves this card rather than leaving it stale.

   Leads with the MINIMUM, not the per-vehicle rate. The floor selects for
   customers who can afford the product, and that selection has to happen here
   rather than after signup. It is framed as "your first N vehicles included"
   because the floor is exactly N vehicles at the headline rate: the same offer,
   stated as what you get rather than as a penalty.

   Bands are WHOLE FLEET, unlike v1's graduated weekly bands. "10% off your
   whole fleet" is accurate here, and the old "vehicles 51+" phrasing would now
   understate the offer. */
export default function PricingCard() {
  const headline = pricingHeadline();
  const bands = pricingBandRows();

  return (
    <section id="pricing" className="py-12 md:py-16">
      <Container className="text-center">
        <p className="text-overline uppercase text-ink-2">Pricing</p>
        <h2 className="mt-1 text-xl font-semibold text-ink">
          Simple, per-vehicle pricing
        </h2>
        <div className="mx-auto mt-6 inline-block rounded-lg border-2 border-primary bg-surface p-6 text-left">
          <div className="text-2xl font-semibold text-ink">
            {headline.fromLabel}{" "}
            <span className="text-sm font-normal text-ink-3">
              per {headline.periodDays} days
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            Includes your first {headline.includedVehicles} vehicles, then{" "}
            {headline.perVehicleLabel} per vehicle · every module included · no
            setup fee
          </p>
          <p className="mt-1 text-sm text-ink-3">{BILLING_BASIS_SENTENCE}</p>

          <table className="mt-4 w-full border-collapse text-sm">
            <caption className="pb-2 text-left text-xs text-ink-3">
              Larger fleets get a discount on every vehicle, not just the ones
              above each threshold
            </caption>
            <tbody>
              {bands.map((band) => (
                <tr key={band.threshold} className="border-t border-line">
                  <td className="py-1.5 pr-6 text-ink-2">{band.label}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums text-ink">
                    {band.discountPercent}%
                    <span className="text-ink-3"> off</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-2 text-xs text-ink-3">{THRESHOLD_PARITY_SENTENCE}</p>

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

- [ ] **Step 5: Update the landing meta description**

In `app/page.tsx`, in `export const metadata`, replace:

```ts
    "Cloud transport management software for haulage, logistics and delivery operators. Jobs, proof of delivery, invoicing, fleet, drivers, subcontractors and live tracking in one platform. From £10 per vehicle per week, billed every 4 weeks.",
```

with:

```ts
    "Cloud transport management software for haulage, logistics and delivery operators. Jobs, proof of delivery, invoicing, fleet, drivers, subcontractors and live tracking in one platform. From £129 per 28 days, including your first 2 vehicles.",
```

This one string is hardcoded rather than derived, because Next's `metadata` export is evaluated at module scope and keeping it a literal keeps the file free of a runtime import for one sentence. `pricingCopy.test.ts` pins the numbers it quotes, so a reprice fails a test that names them.

- [ ] **Step 6: Update the JSON-LD offer**

In `app/page.tsx`, replace:

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

with:

```ts
            offers: {
              // Was price "0" (advertising the product as free), then "10"
              // (the v1 weekly per-vehicle rate). Now the v2 MINIMUM, which is
              // the lowest amount anyone actually pays and therefore the only
              // honest "from" price. Quoting the 64.50 per-vehicle rate here
              // would index a number no customer is ever charged, since one
              // vehicle still costs 129.
              "@type": "Offer",
              price: "129",
              priceCurrency: "GBP",
              description:
                "Per 28-day period, including the first 2 vehicles, billed in arrears",
            },
```

- [ ] **Step 7: Make the licences page model-aware**

`app/settings/licences/page.tsx` shows v1 pricing to every company, including the "4-Weekly Charge" tile computed from `money.ts`. For a v2 company both the sentence and the figure are wrong, on the very page where billing gets switched on.

Add to the component's state and load, alongside the existing queries:

```tsx
  const [billingModel, setBillingModel] = useState<string | null>(null);
```

In the same `Promise.all` that loads the page's other data, add:

```tsx
        supabase.from("company_billing").select("*").maybeSingle(),
```

and after it resolves:

```tsx
      /* select("*") for the same reason as the billing page shell:
         billing_model is a billing_06 column, and naming it explicitly would
         answer 42703 on a database where that migration has not been applied,
         failing this page for every v1 company. */
      setBillingModel(
        ((billingRes.data as { billing_model?: string | null } | null)
          ?.billing_model) ?? null
      );
```

Add near the top of the file:

```tsx
import { pricingHeadline, BILLING_BASIS_SENTENCE } from "../../../lib/billing/pricingCopy";
```

Replace the header paragraph:

```tsx
                <p className="m-0 text-sm text-ink-3">
                    Add and manage vehicle licences. £10 per licensed vehicle
                    per week, less per vehicle on larger fleets, charged every 4
                    weeks.
                </p>
```

with:

```tsx
                <p className="m-0 text-sm text-ink-3">
                    {isPeriodBilling ? (
                        <>
                            Add and manage vehicle licences.{" "}
                            {pricingHeadline().summary} {BILLING_BASIS_SENTENCE}
                        </>
                    ) : (
                        <>
                            Add and manage vehicle licences. £10 per licensed
                            vehicle per week, less per vehicle on larger fleets,
                            charged every 4 weeks.
                        </>
                    )}
                </p>
```

Define, just above the `return`:

```tsx
    /* Fail closed to v1, as the billing page shell does: a v2 company shown v1
       copy sees a stale sentence, but a v1 company shown v2 copy sees a price
       it will never be charged. */
    const isPeriodBilling = billingModel === "v2_period";
```

Replace the "4-Weekly Charge" and "Billing Rule" tiles:

```tsx
                <Stat
                    label="4-Weekly Charge"
                    value={
                        showSkeleton ? (
                            <Skeleton display="inline-block" w="10ch" h="1.25rem" />
                        ) : (
                            formatPence(amounts.grossPence)
                        )
                    }
                    sub="this tenant only, inc VAT"
                />
                <Stat label="Billing Rule" value="£10" sub="per vehicle per week, less on larger fleets" />
```

with:

```tsx
                {/* A v2 company is NOT shown a 4-weekly figure. amounts comes
                    from lib/billing/money.ts, which is v1's graduated weekly
                    shape and produces a number a v2 company will never be
                    charged. The real v2 figure depends on the open period, so
                    it lives on the billing page rather than being recomputed
                    here from a different rate card. */}
                {isPeriodBilling ? (
                    <Stat
                        label="This period"
                        value="See billing"
                        sub="charged when the period closes"
                    />
                ) : (
                    <Stat
                        label="4-Weekly Charge"
                        value={
                            showSkeleton ? (
                                <Skeleton display="inline-block" w="10ch" h="1.25rem" />
                            ) : (
                                formatPence(amounts.grossPence)
                            )
                        }
                        sub="this tenant only, inc VAT"
                    />
                )}
                {isPeriodBilling ? (
                    <Stat
                        label="Billing Rule"
                        value={pricingHeadline().perVehicleLabel}
                        sub={`per vehicle per ${pricingHeadline().periodDays} days, less on larger fleets`}
                    />
                ) : (
                    <Stat
                        label="Billing Rule"
                        value="£10"
                        sub="per vehicle per week, less on larger fleets"
                    />
                )}
```

- [ ] **Step 8: Correct the super-admin pricing sentence**

A super-admin sees every company, and companies exist on both models, so a single-model sentence is wrong for half the platform whichever model it names.

In `app/super-admin/billing/page.tsx`, replace:

```tsx
                    <p className="m-0 text-sm text-ink-3">
                        Billing is £10 per licensed vehicle per week, less per vehicle on
                        larger fleets, charged every 4 weeks.
                    </p>
```

with:

```tsx
                    {/* Both models are live, so naming one is wrong for the
                        other half of the platform. The figures below this
                        header are still v1-shaped (they read platform_charges,
                        which v2 never writes); a v2 view of this console is
                        deliberately out of scope, see the 2026-09-11 spec. */}
                    <p className="m-0 text-sm text-ink-3">
                        Period billing (current): {pricingHeadline().summary}{" "}
                        Legacy 4-weekly billing: £10 per licensed vehicle per
                        week, less per vehicle on larger fleets. The figures
                        below cover 4-weekly companies only.
                    </p>
```

Add the import:

```tsx
import { pricingHeadline } from "../../../lib/billing/pricingCopy";
```

- [ ] **Step 9: Verify**

```bash
npm test
npm run typecheck
```

Expected: 1163 tests pass, typecheck clean.

- [ ] **Step 10: Check the landing page renders**

```bash
npm run dev
```

Open `http://localhost:3000` and confirm the pricing card shows "£129.00 per 28 days", "Includes your first 2 vehicles, then £64.50 per vehicle", and four discount rows (10%, 15%, 20%, 22%). Then stop the server.

- [ ] **Step 11: Commit**

```bash
git add lib/billing/rateCard.ts lib/billing/rateCard.test.ts components/landing/PricingCard.tsx app/page.tsx app/settings/licences/page.tsx app/super-admin/billing/page.tsx
git commit -m "Move every pricing surface to v2

Six surfaces showed v1's GBP 10 per week. All now derive from rateCard.ts
through pricingCopy, except the Next metadata string, which stays a literal
because that export is evaluated at module scope; the numbers it quotes are
pinned by pricingCopy.test.ts.

The JSON-LD price moves from 10 to 129, the minimum, which is the lowest
amount anyone actually pays and the only honest 'from' price: quoting the
GBP 64.50 per-vehicle rate would index a number no customer is charged.

Fixes a comment defect found while writing the spec: fleetPeriodPence claimed
18, 19 and 20 vehicles all cost GBP 1032.00. Only 19 and 20 do; 18 costs
GBP 986.85 in the 15% band. Now pinned by a test."
```

---

## STOP HERE FOR THE DRY RUN

Tasks 1 to 8 change nothing about what any existing company is charged. Every company remains `v1_immediate`, and a new signup still lands on v1.

**Perform the dry run now**, signed in as an **admin of the test company**, not as super-admin (`/settings/billing` deliberately bounces super-admins). Follow the 2026-09-10 handoff's steps 1 to 5. The billing page is now the instrument: the no-period card names the three causes, and the projection card shows what the close job will produce.

Only continue to Task 9 once a v2 activation has actually charged.

---

## Task 9 (FLAGGED): v2 signup branch in the card route

**This changes what a new customer experiences.** `/api/billing/card` has zero v2 awareness: on a company with no `company_billing` row it calls `runChargeCycle`, which writes `platform_charges` and charges at v1 prices immediately, then inserts a row with `next_charge_on` set and no `billing_model`.

**Files:**
- Modify: `lib/billing/rateCard.ts`
- Modify: `app/api/billing/card/route.ts`

- [ ] **Step 1: Add the constant, still set to v1**

Append to `lib/billing/rateCard.ts`:

```ts
/**
 * The billing model a BRAND NEW company is created on.
 *
 * Which model a new company gets cannot be read from a company_billing row,
 * because at signup there is not one yet. So it is a constant, in one place,
 * and switching the product's default pricing is a one-line reviewable change
 * rather than a hunt through the signup path.
 *
 * Existing companies are unaffected: their row already carries a
 * billing_model, and nothing here rewrites it. Use
 * scripts/migrate-company-to-period-billing.mjs to move one.
 */
export const NEW_COMPANY_BILLING_MODEL: "v1_immediate" | "v2_period" =
  "v1_immediate";
```

- [ ] **Step 2: Branch the new-company path**

In `app/api/billing/card/route.ts`, add the import:

```ts
import { NEW_COMPANY_BILLING_MODEL } from "../../../../lib/billing/rateCard";
```

Then, in the first-time path, **before** the `platform_charges` attempt lookup at line 180 (`const { data: attemptRows, error: attemptError } = await admin`), insert:

```ts
      /* v2 bills in ARREARS, so saving a card takes no money. The period opens
         and the minimum is charged when the first vehicle is activated, in
         openPeriodAndChargeMinimum, not here.

         Returning early rather than falling through matters: runChargeCycle
         below writes platform_charges and prices with lib/billing/money.ts,
         which is v1's rate card. A v2 company reaching it would be charged v1
         prices and land with a row marked v2_period carrying a v1
         next_charge_on, which no later code path knows how to reconcile. */
      if (NEW_COMPANY_BILLING_MODEL === "v2_period") {
        const { error: insertError } = await admin
          .from("company_billing")
          .insert({
            company_id: companyId,
            ...cardFields,
            status: "active",
            billing_model: "v2_period",
            /* Null, not a date. next_charge_on is a v1 concept: it drives the
               4-weekly cron, which must never pick up a v2 company. */
            next_charge_on: null,
            retry_at: null,
            retry_count: 0,
          });
        if (insertError) {
          throw new Error(insertError.message);
        }

        return NextResponse.json({
          ok: true,
          firstCharge: false,
          model: "v2_period",
        });
      }
```

- [ ] **Step 3: Verify the v1 path is untouched**

```bash
npm test
npm run typecheck
```

Expected: 1163 tests pass, typecheck clean. With the constant still `v1_immediate`, the branch is unreachable and behaviour is identical to before.

- [ ] **Step 4: Commit**

```bash
git add lib/billing/rateCard.ts app/api/billing/card/route.ts
git commit -m "Add the v2 signup path to the card route, still switched off

The route had no v2 awareness: a new company was charged v1 prices through
runChargeCycle and got a row with next_charge_on set and no billing_model. v2
bills in arrears, so saving a card must take nothing and the period opens when
the first vehicle is activated.

NEW_COMPANY_BILLING_MODEL stays v1_immediate here, so this branch is
unreachable and nothing changes yet. Task 10 flips it."
```

---

## Task 10 (FLAGGED): make v2 the default for new companies

**Do not do this until a v2 activation has charged in the dry run.** Until then the first v2 charge in the system's history would be a real customer's, on a path that has never moved money.

**Files:**
- Modify: `lib/billing/rateCard.ts`

- [ ] **Step 1: Flip the constant**

```ts
export const NEW_COMPANY_BILLING_MODEL: "v1_immediate" | "v2_period" =
  "v2_period";
```

- [ ] **Step 2: Verify**

```bash
npm test
npm run typecheck
```

Expected: 1163 tests pass, typecheck clean.

- [ ] **Step 3: Confirm the whole path by hand**

With a throwaway company: sign up, add a card, and confirm **no charge appears at Square** and the `company_billing` row reads `billing_model = 'v2_period'` with `next_charge_on` null. Then activate a vehicle licence and confirm the £129 minimum plus VAT is taken and a period opens.

- [ ] **Step 4: Commit**

```bash
git add lib/billing/rateCard.ts
git commit -m "Make period billing the default for new companies

New signups now land on v2_period and are billed in arrears. Existing
companies are unaffected: their billing_model is already set and nothing here
rewrites it.

Gated on the dry run, so the first v2 charge in the system's history was a
test rather than a customer."
```

---

## Self-review notes

Checked against the spec:

- Spec section 1 (one implementation) is Task 3. Return type simplified from the spec's `{ invoice, vehicleCount }` to `AssembledInvoice`, which already carries `vehicleCount` and `discountPercent`.
- Spec section 2 (preview route) is Task 4. All four response shapes covered.
- Spec section 3 (page structure) is Tasks 6 and 7, including the `select("*")` reasoning and the withheld description.
- Spec section 4 (what V2Billing shows) is Task 7. **One deliberate omission:** closed periods expandable to stored `period_invoice_lines` is not built. `DataTable` supports it via `renderExpanded`/`expandedKey`, but no period has ever closed, so there is no shape to build against and nothing to verify it with. Add it after the first real close.
- Spec section 5 (degradation) is in Task 7: three regions, `-` rather than `£0.00`, no `filterByTenant`.
- Spec section 6 (one pricing source) is Tasks 2 and 8, including the `rateCard.ts` comment defect.
- Spec's flagged steps 7 and 8 are Tasks 9 and 10, with the dry-run gate between Task 8 and Task 9.
- The 2-vehicle boundary named in the spec's testing section is asserted in `periodView.test.ts`.

Naming is consistent throughout: `previewPeriodInvoice`, `pricingHeadline`, `pricingBandRows`, `includedVehicleCount`, `periodProgress`, `pricingExplanation`, `NO_PERIOD_REASONS`, `MID_PERIOD_ADDITION_NOTE`, `BILLING_BASIS_SENTENCE`, `THRESHOLD_PARITY_SENTENCE`, `NEW_COMPANY_BILLING_MODEL`.
