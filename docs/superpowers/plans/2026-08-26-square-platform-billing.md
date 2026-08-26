# Square Platform Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge each customer company its monthly subscription (active licensed vehicles x GBP 10 net + 20% VAT) via Square card-on-file, self-managed by the company admin at `/settings/billing`, with a daily cron and retry-then-flag dunning.

**Architecture:** Pure billing logic (money maths, schedule, vehicle count, cron decisions) lives in `lib/billing/` with colocated vitest tests. Impure orchestration (`requireCompanyAdmin`, Square calls, DB writes) is thin and exercised by `npm run typecheck` plus manual sandbox testing. Two API routes: `POST /api/billing/card` (tokenized card in, first charge or recovery retry out) and `GET /api/billing/run` (Vercel Cron, `CRON_SECRET` bearer). All DB writes use the service-role client; authenticated clients are read-only via RLS.

**Tech Stack:** Next.js 16 App Router, `square` SDK v45 (already in package.json), Square Web Payments SDK (browser script), Supabase (service-role writes, RLS reads), zod v4, vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-square-platform-billing-design.md`. Read it before starting.

**Branch:** work on `ethan/square-platform-billing` (already exists, spec committed).

**Conventions that are non-negotiable in this repo:**
- No em-dashes anywhere (docs, comments, strings). Use commas, colons, or parentheses.
- Money is integer pence. Never floats.
- Dates that mean "a billing day" are `YYYY-MM-DD` strings computed in Europe/London.
- New page styling: design system (`ds font-sans bg-canvas text-ink`, tokens only, no Tailwind `dark:` variants ever).
- Verification gate before any "done" claim: `npm run typecheck` and `npm test` both pass.

**Square SDK caution:** the plan's Square call shapes (`client.customers.search`, `client.cards.create`, `client.payments.create`, `SquareError`) target the v45 SDK. If typecheck disagrees, open `node_modules/square/dist` type definitions and adjust names to what v45 actually exports. Do not downgrade the package.

---

### Task 1: Database migration

**Files:**
- Create: `docs/sql/billing_01_platform_billing.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- billing_01: platform subscription billing (Square card-on-file).
-- Apply manually in the Supabase SQL editor, like the rls_* series. Safe to re-run.
-- Depends on helpers that already exist in the DB: get_my_role(), get_my_company_id().

create table if not exists public.company_billing (
  company_id uuid primary key references public.companies(id) on delete cascade,
  square_customer_id text not null,
  square_card_id text not null,
  card_brand text,
  card_last4 text,
  card_exp_month int,
  card_exp_year int,
  status text not null check (status in ('active', 'past_due', 'canceled')),
  anchor_day int not null check (anchor_day between 1 and 31),
  next_charge_on date not null,
  retry_at date,
  retry_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_charges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cycle_date date not null,
  attempt int not null check (attempt >= 1),
  vehicle_count int not null check (vehicle_count >= 0),
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
  unique (company_id, cycle_date, attempt)
);

create index if not exists platform_charges_company_created_idx
  on public.platform_charges (company_id, created_at desc);

alter table public.company_billing enable row level security;
alter table public.platform_charges enable row level security;

-- Company admins read their own company's rows; super_admin reads all.
drop policy if exists company_billing_select on public.company_billing;
create policy company_billing_select on public.company_billing
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

drop policy if exists platform_charges_select on public.platform_charges;
create policy platform_charges_select on public.platform_charges
  for select to authenticated
  using (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and company_id = public.get_my_company_id())
  );

-- No INSERT/UPDATE/DELETE policies on purpose. All writes come from server
-- routes on the service role, which bypasses RLS. Belt and braces: revoke the
-- table grants too, matching rls_05_revoke_grants.sql.
revoke insert, update, delete on public.company_billing from authenticated, anon;
revoke insert, update, delete on public.platform_charges from authenticated, anon;
```

- [ ] **Step 2: Commit**

```bash
git add docs/sql/billing_01_platform_billing.sql
git commit -m "feat(billing): add platform billing tables migration (unapplied draft)"
```

Note in your report: the migration is a draft until Ethan runs it in the Supabase SQL editor. Nothing in later tasks fails to typecheck without it, but manual sandbox testing (Task 14) requires it applied.

---

### Task 2: Money maths (`lib/billing/money.ts`)

**Files:**
- Create: `lib/billing/money.ts`
- Test: `lib/billing/money.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/billing/money.test.ts
import { describe, expect, it } from "vitest";
import { chargeIdempotencyKey, computeChargeAmounts } from "./money";

describe("computeChargeAmounts", () => {
  it("charges 1000 pence net per vehicle plus 20% VAT", () => {
    expect(computeChargeAmounts(12)).toEqual({
      vehicleCount: 12,
      netPence: 12000,
      vatPence: 2400,
      grossPence: 14400,
      vatRate: 20,
    });
  });

  it("handles a single vehicle", () => {
    expect(computeChargeAmounts(1)).toEqual({
      vehicleCount: 1,
      netPence: 1000,
      vatPence: 200,
      grossPence: 1200,
      vatRate: 20,
    });
  });

  it("returns all zeros for zero vehicles", () => {
    expect(computeChargeAmounts(0)).toEqual({
      vehicleCount: 0,
      netPence: 0,
      vatPence: 0,
      grossPence: 0,
      vatRate: 20,
    });
  });

  it("rejects negative counts", () => {
    expect(() => computeChargeAmounts(-1)).toThrow();
  });

  it("rejects fractional counts", () => {
    expect(() => computeChargeAmounts(2.5)).toThrow();
  });
});

describe("chargeIdempotencyKey", () => {
  it("is deterministic and compact over company, cycle and attempt", () => {
    expect(
      chargeIdempotencyKey(
        "0c8b6a1e-4f2d-4e7b-9a3c-1d5e7f9b2a4c",
        "2026-08-26",
        2
      )
    ).toBe("0c8b6a1e4f2d4e7b9a3c1d5e7f9b2a4c_20260826_2");
  });

  it("stays within Square's 45-character idempotency key limit", () => {
    const key = chargeIdempotencyKey(
      "0c8b6a1e-4f2d-4e7b-9a3c-1d5e7f9b2a4c",
      "2026-08-26",
      99
    );
    expect(key.length).toBeLessThanOrEqual(45);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/billing/money.test.ts`
Expected: FAIL, cannot resolve `./money`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/billing/money.ts
// Platform subscription pricing. All amounts are integer pence, never floats.

export const NET_PENCE_PER_VEHICLE = 1000; // GBP 10.00
export const VAT_RATE = 20; // percent

export type ChargeAmounts = {
  vehicleCount: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  vatRate: number;
};

export function computeChargeAmounts(vehicleCount: number): ChargeAmounts {
  if (!Number.isInteger(vehicleCount) || vehicleCount < 0) {
    throw new Error(
      `vehicleCount must be a non-negative integer, got ${vehicleCount}`
    );
  }
  const netPence = vehicleCount * NET_PENCE_PER_VEHICLE;
  const vatPence = Math.round((netPence * VAT_RATE) / 100);
  return {
    vehicleCount,
    netPence,
    vatPence,
    grossPence: netPence + vatPence,
    vatRate: VAT_RATE,
  };
}

// Square's CreatePayment idempotency_key allows at most 45 characters, so the
// key is compacted: UUID without dashes (32) + date without dashes (8) +
// attempt, joined by underscores. One key per (company, cycle, attempt): a
// crashed-and-rerun cron reuses the same key, so Square deduplicates and a
// double charge is impossible.
export function chargeIdempotencyKey(
  companyId: string,
  cycleDate: string,
  attempt: number
): string {
  const compactCompany = companyId.replace(/-/g, "");
  const compactDate = cycleDate.replace(/-/g, "");
  return `${compactCompany}_${compactDate}_${attempt}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/billing/money.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/money.ts lib/billing/money.test.ts
git commit -m "feat(billing): charge amount maths with VAT split"
```

---

### Task 3: Schedule maths (`lib/billing/schedule.ts`)

**Files:**
- Create: `lib/billing/schedule.ts`
- Test: `lib/billing/schedule.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// lib/billing/schedule.test.ts
import { describe, expect, it } from "vitest";
import {
  addDays,
  computeNextChargeOn,
  londonDateISO,
  nextRetryOn,
} from "./schedule";

describe("londonDateISO", () => {
  it("formats a UTC instant as a London calendar date", () => {
    expect(londonDateISO(new Date("2026-08-26T10:00:00Z"))).toBe("2026-08-26");
  });

  it("rolls to the next day when London (BST) is ahead of UTC at midnight", () => {
    // 23:30 UTC in August is 00:30 next day in London.
    expect(londonDateISO(new Date("2026-08-26T23:30:00Z"))).toBe("2026-08-27");
  });

  it("matches UTC in winter (GMT)", () => {
    expect(londonDateISO(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-15");
  });
});

describe("addDays", () => {
  it("adds days within a month", () => {
    expect(addDays("2026-08-01", 2)).toBe("2026-08-03");
  });

  it("crosses month boundaries", () => {
    expect(addDays("2026-08-30", 4)).toBe("2026-09-03");
  });
});

describe("computeNextChargeOn", () => {
  it("advances one month on the anchor day", () => {
    expect(computeNextChargeOn("2026-08-26", 26)).toBe("2026-09-26");
  });

  it("clamps a 31st anchor into a 30-day month", () => {
    expect(computeNextChargeOn("2026-08-31", 31)).toBe("2026-09-30");
  });

  it("clamps a 31st anchor into February", () => {
    expect(computeNextChargeOn("2027-01-31", 31)).toBe("2027-02-28");
  });

  it("clamps into a leap-year February", () => {
    expect(computeNextChargeOn("2028-01-31", 31)).toBe("2028-02-29");
  });

  it("recovers the anchor day after a clamped month", () => {
    // Charged 28 Feb with a 31 anchor: next charge is 31 March, not 28 March.
    expect(computeNextChargeOn("2027-02-28", 31)).toBe("2027-03-31");
  });

  it("crosses the year boundary", () => {
    expect(computeNextChargeOn("2026-12-15", 15)).toBe("2027-01-15");
  });
});

describe("nextRetryOn", () => {
  // Attempts land on days 1, 3, 5, 7 of the cycle: retry two days after the
  // cycle date per failed attempt.
  it("schedules the second attempt two days after the cycle date", () => {
    expect(nextRetryOn("2026-08-26", 1)).toBe("2026-08-28");
  });

  it("schedules the third attempt four days after the cycle date", () => {
    expect(nextRetryOn("2026-08-26", 2)).toBe("2026-08-30");
  });

  it("schedules the fourth attempt six days after the cycle date", () => {
    expect(nextRetryOn("2026-08-26", 3)).toBe("2026-09-01");
  });

  it("returns null after the fourth failure (dunning exhausted)", () => {
    expect(nextRetryOn("2026-08-26", 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/billing/schedule.test.ts`
Expected: FAIL, cannot resolve `./schedule`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/billing/schedule.ts
// Billing calendar maths. Dates are YYYY-MM-DD strings; "today" is always the
// Europe/London calendar date, because billing days are business days in the
// UK, not UTC days.

export const MAX_ATTEMPTS = 4;

export function londonDateISO(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseISO(dateISO: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateISO.split("-").map(Number);
  return { year, month, day };
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month. UTC avoids DST.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(dateISO: string, days: number): string {
  const { year, month, day } = parseISO(dateISO);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Next cycle: one calendar month after the cycle just charged, on the anchor
// day, clamped to the target month's length. Computed from anchor_day (not
// from the possibly-clamped cycle date) so a 31 anchor bounces back to the
// 31st after a short month.
export function computeNextChargeOn(cycleDate: string, anchorDay: number): string {
  const { year, month } = parseISO(cycleDate);
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const day = Math.min(anchorDay, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${pad(nextMonth)}-${pad(day)}`;
}

// After failedAttempt attempts have failed, when is the next try? Two days per
// failed attempt from the cycle date puts attempts on days 1, 3, 5 and 7.
// Null means dunning is exhausted and the company goes past_due.
export function nextRetryOn(cycleDate: string, failedAttempt: number): string | null {
  if (failedAttempt >= MAX_ATTEMPTS) return null;
  return addDays(cycleDate, 2 * failedAttempt);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/billing/schedule.test.ts`
Expected: PASS (15 tests). The BST test relies on vitest's pinned `TZ=Europe/London` plus the explicit `timeZone` option; both point the same way.

- [ ] **Step 5: Commit**

```bash
git add lib/billing/schedule.ts lib/billing/schedule.test.ts
git commit -m "feat(billing): anchor-clamped schedule and retry maths"
```

---

### Task 4: Vehicle count (`lib/billing/vehicleCount.ts`)

**Files:**
- Create: `lib/billing/vehicleCount.ts`
- Test: `lib/billing/vehicleCount.test.ts`

This extracts the billable-count definition so the cron and `/super-admin/billing` cannot drift. It must reproduce the existing page's semantics (`app/super-admin/billing/page.tsx:84-102`): a vehicle belongs to a company when `vehicle.tenant_id` or `vehicle.company_id` equals the company id, and it is billable when it has an ACTIVE licence. It additionally accepts the company's tenant ids, because vehicles are normally keyed by tenant.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/billing/vehicleCount.test.ts
import { describe, expect, it } from "vitest";
import { countBillableVehicles } from "./vehicleCount";

const COMPANY = "company-1";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

describe("countBillableVehicles", () => {
  it("counts actively licensed vehicles across all the company's tenants", () => {
    const count = countBillableVehicles({
      companyId: COMPANY,
      companyTenantIds: [TENANT_A, TENANT_B],
      vehicles: [
        { id: "v1", tenant_id: TENANT_A },
        { id: "v2", tenant_id: TENANT_B },
        { id: "v3", tenant_id: "other-tenant" },
      ],
      licences: [
        { vehicle_id: "v1", active: true },
        { vehicle_id: "v2", active: true },
        { vehicle_id: "v3", active: true },
      ],
    });
    expect(count).toBe(2);
  });

  it("ignores vehicles without an active licence", () => {
    const count = countBillableVehicles({
      companyId: COMPANY,
      companyTenantIds: [TENANT_A],
      vehicles: [
        { id: "v1", tenant_id: TENANT_A },
        { id: "v2", tenant_id: TENANT_A },
      ],
      licences: [
        { vehicle_id: "v1", active: true },
        { vehicle_id: "v2", active: false },
      ],
    });
    expect(count).toBe(1);
  });

  it("counts a vehicle once even with multiple active licences", () => {
    const count = countBillableVehicles({
      companyId: COMPANY,
      companyTenantIds: [TENANT_A],
      vehicles: [{ id: "v1", tenant_id: TENANT_A }],
      licences: [
        { vehicle_id: "v1", active: true },
        { vehicle_id: "v1", active: true },
      ],
    });
    expect(count).toBe(1);
  });

  it("matches vehicles keyed directly by company_id (legacy data shape)", () => {
    const count = countBillableVehicles({
      companyId: COMPANY,
      companyTenantIds: [],
      vehicles: [
        { id: "v1", company_id: COMPANY },
        { id: "v2", tenant_id: COMPANY },
      ],
      licences: [
        { vehicle_id: "v1", active: true },
        { vehicle_id: "v2", active: true },
      ],
    });
    expect(count).toBe(2);
  });

  it("returns zero for a company with no vehicles", () => {
    const count = countBillableVehicles({
      companyId: COMPANY,
      companyTenantIds: [TENANT_A],
      vehicles: [],
      licences: [],
    });
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/billing/vehicleCount.test.ts`
Expected: FAIL, cannot resolve `./vehicleCount`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/billing/vehicleCount.ts
// THE billable-count definition. The cron and /super-admin/billing must agree
// on what a billable vehicle is; this is the single implementation.
//
// Semantics mirror app/super-admin/billing/page.tsx: a vehicle is the
// company's when its tenant belongs to the company, or when its tenant_id or
// company_id column equals the company id directly (a legacy data shape the
// page supports). Billable = has at least one active licence.

export type VehicleRow = {
  id: string;
  tenant_id?: string | null;
  company_id?: string | null;
};

export type LicenceRow = {
  vehicle_id: string;
  active: boolean | null;
};

export function countBillableVehicles(args: {
  companyId: string;
  companyTenantIds: readonly string[];
  vehicles: readonly VehicleRow[];
  licences: readonly LicenceRow[];
}): number {
  const tenantIds = new Set(args.companyTenantIds);

  const companyVehicleIds = new Set(
    args.vehicles
      .filter(
        (v) =>
          (v.tenant_id != null &&
            (tenantIds.has(v.tenant_id) || v.tenant_id === args.companyId)) ||
          v.company_id === args.companyId
      )
      .map((v) => v.id)
  );

  const licensed = new Set(
    args.licences
      .filter((l) => l.active && companyVehicleIds.has(l.vehicle_id))
      .map((l) => l.vehicle_id)
  );

  return licensed.size;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/billing/vehicleCount.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/vehicleCount.ts lib/billing/vehicleCount.test.ts
git commit -m "feat(billing): shared billable vehicle count definition"
```

---

### Task 5: Cron decision core (`lib/billing/run.ts`)

**Files:**
- Create: `lib/billing/run.ts`
- Test: `lib/billing/run.test.ts`

Two pure functions: `selectDueAction` (given a billing row and today, should we charge, and which cycle/attempt?) and `applyChargeOutcome` (given the result, what does the row become?). The cron route is a thin loop over these.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/billing/run.test.ts
import { describe, expect, it } from "vitest";
import { applyChargeOutcome, selectDueAction } from "./run";
import type { CompanyBillingRow } from "./run";

function row(overrides: Partial<CompanyBillingRow> = {}): CompanyBillingRow {
  return {
    company_id: "company-1",
    status: "active",
    anchor_day: 26,
    next_charge_on: "2026-08-26",
    retry_at: null,
    retry_count: 0,
    ...overrides,
  };
}

describe("selectDueAction", () => {
  it("charges attempt 1 when the cycle date has arrived", () => {
    expect(selectDueAction(row(), "2026-08-26")).toEqual({
      kind: "charge",
      cycleDate: "2026-08-26",
      attempt: 1,
    });
  });

  it("also fires when the cycle date was missed (cron downtime)", () => {
    expect(selectDueAction(row(), "2026-08-28")).toEqual({
      kind: "charge",
      cycleDate: "2026-08-26",
      attempt: 1,
    });
  });

  it("does nothing before the cycle date", () => {
    expect(selectDueAction(row(), "2026-08-25")).toEqual({ kind: "none" });
  });

  it("fires a due retry with the next attempt number", () => {
    const r = row({ retry_at: "2026-08-28", retry_count: 1 });
    expect(selectDueAction(r, "2026-08-28")).toEqual({
      kind: "charge",
      cycleDate: "2026-08-26",
      attempt: 2,
    });
  });

  it("waits for a future retry even though next_charge_on is past", () => {
    const r = row({ retry_at: "2026-08-28", retry_count: 1 });
    expect(selectDueAction(r, "2026-08-27")).toEqual({ kind: "none" });
  });

  it("never charges a past_due company (dunning halted)", () => {
    const r = row({ status: "past_due", retry_count: 4 });
    expect(selectDueAction(r, "2026-09-26")).toEqual({ kind: "none" });
  });

  it("never charges a canceled company", () => {
    const r = row({ status: "canceled" });
    expect(selectDueAction(r, "2026-09-26")).toEqual({ kind: "none" });
  });
});

describe("applyChargeOutcome", () => {
  it("advances the schedule and clears dunning on success", () => {
    expect(
      applyChargeOutcome({
        row: row({ retry_at: "2026-08-28", retry_count: 1 }),
        cycleDate: "2026-08-26",
        attempt: 2,
        succeeded: true,
      })
    ).toEqual({
      status: "active",
      next_charge_on: "2026-09-26",
      retry_at: null,
      retry_count: 0,
    });
  });

  it("anchor-clamps the advanced date", () => {
    expect(
      applyChargeOutcome({
        row: row({ anchor_day: 31, next_charge_on: "2027-01-31" }),
        cycleDate: "2027-01-31",
        attempt: 1,
        succeeded: true,
      }).next_charge_on
    ).toBe("2027-02-28");
  });

  it("schedules a retry on a non-final failure", () => {
    expect(
      applyChargeOutcome({
        row: row(),
        cycleDate: "2026-08-26",
        attempt: 1,
        succeeded: false,
      })
    ).toEqual({
      status: "active",
      next_charge_on: "2026-08-26",
      retry_at: "2026-08-28",
      retry_count: 1,
    });
  });

  it("goes past_due after the fourth failure", () => {
    expect(
      applyChargeOutcome({
        row: row({ retry_at: "2026-09-01", retry_count: 3 }),
        cycleDate: "2026-08-26",
        attempt: 4,
        succeeded: false,
      })
    ).toEqual({
      status: "past_due",
      next_charge_on: "2026-08-26",
      retry_at: null,
      retry_count: 4,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/billing/run.test.ts`
Expected: FAIL, cannot resolve `./run`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/billing/run.ts
// Pure decision core of the billing cron. The route fetches rows, calls
// selectDueAction, performs the Square charge, then persists
// applyChargeOutcome. Nothing here touches the network or the DB.

import { computeNextChargeOn, nextRetryOn } from "./schedule";

export type CompanyBillingRow = {
  company_id: string;
  status: "active" | "past_due" | "canceled";
  anchor_day: number;
  next_charge_on: string;
  retry_at: string | null;
  retry_count: number;
};

export type DueAction =
  | { kind: "none" }
  | { kind: "charge"; cycleDate: string; attempt: number };

export function selectDueAction(
  row: CompanyBillingRow,
  todayISO: string
): DueAction {
  // past_due halts dunning AND new cycles: debt must not stack on a dead card.
  if (row.status === "canceled" || row.status === "past_due") {
    return { kind: "none" };
  }
  if (row.retry_at !== null) {
    if (row.retry_at <= todayISO) {
      return {
        kind: "charge",
        cycleDate: row.next_charge_on,
        attempt: row.retry_count + 1,
      };
    }
    return { kind: "none" };
  }
  if (row.next_charge_on <= todayISO) {
    return { kind: "charge", cycleDate: row.next_charge_on, attempt: 1 };
  }
  return { kind: "none" };
}

export type ChargeOutcomeUpdate = {
  status: "active" | "past_due";
  next_charge_on: string;
  retry_at: string | null;
  retry_count: number;
};

export function applyChargeOutcome(args: {
  row: Pick<CompanyBillingRow, "anchor_day" | "next_charge_on">;
  cycleDate: string;
  attempt: number;
  succeeded: boolean;
}): ChargeOutcomeUpdate {
  if (args.succeeded) {
    return {
      status: "active",
      next_charge_on: computeNextChargeOn(args.cycleDate, args.row.anchor_day),
      retry_at: null,
      retry_count: 0,
    };
  }
  const retryOn = nextRetryOn(args.cycleDate, args.attempt);
  if (retryOn === null) {
    return {
      status: "past_due",
      next_charge_on: args.row.next_charge_on,
      retry_at: null,
      retry_count: args.attempt,
    };
  }
  return {
    status: "active",
    next_charge_on: args.row.next_charge_on,
    retry_at: retryOn,
    retry_count: args.attempt,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/billing/run.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/billing/run.ts lib/billing/run.test.ts
git commit -m "feat(billing): pure cron decision core"
```

---

### Task 6: Square server client (`lib/payments/square.ts`)

**Files:**
- Create: `lib/payments/square.ts`
- Test: `lib/payments/square.test.ts`

Mirrors `lib/payments/stripe.ts` (same lazy singleton and guard style).

- [ ] **Step 1: Write the failing tests**

```ts
// lib/payments/square.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module caches its client, so re-import fresh for every test.
async function importFresh() {
  vi.resetModules();
  return import("./square");
}

describe("getSquare env guards", () => {
  beforeEach(() => {
    vi.stubEnv("SQUARE_ACCESS_TOKEN", "test-token");
    vi.stubEnv("SQUARE_ENVIRONMENT", "sandbox");
    vi.stubEnv("SQUARE_LOCATION_ID", "LTEST");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when SQUARE_ACCESS_TOKEN is missing", async () => {
    vi.stubEnv("SQUARE_ACCESS_TOKEN", "");
    const { getSquare } = await importFresh();
    expect(() => getSquare()).toThrow(/SQUARE_ACCESS_TOKEN/);
  });

  it("throws when SQUARE_ENVIRONMENT is not sandbox or production", async () => {
    vi.stubEnv("SQUARE_ENVIRONMENT", "staging");
    const { getSquare } = await importFresh();
    expect(() => getSquare()).toThrow(/SQUARE_ENVIRONMENT/);
  });

  it("constructs a client when config is valid", async () => {
    const { getSquare } = await importFresh();
    expect(getSquare()).toBeTruthy();
  });

  it("throws from getSquareLocationId when unset", async () => {
    vi.stubEnv("SQUARE_LOCATION_ID", "");
    const { getSquareLocationId } = await importFresh();
    expect(() => getSquareLocationId()).toThrow(/SQUARE_LOCATION_ID/);
  });

  it("returns the location id when set", async () => {
    const { getSquareLocationId } = await importFresh();
    expect(getSquareLocationId()).toBe("LTEST");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/payments/square.test.ts`
Expected: FAIL, cannot resolve `./square`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/payments/square.ts
import { SquareClient, SquareEnvironment } from "square";

let squareClient: SquareClient | null = null;

export function getSquare(): SquareClient {
  if (typeof window !== "undefined") {
    throw new Error("Square server client cannot be used in the browser.");
  }

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const environment = process.env.SQUARE_ENVIRONMENT;

  if (!token) {
    throw new Error("SQUARE_ACCESS_TOKEN is not configured.");
  }

  if (environment !== "sandbox" && environment !== "production") {
    throw new Error(
      "SQUARE_ENVIRONMENT must be 'sandbox' or 'production'."
    );
  }

  if (!squareClient) {
    squareClient = new SquareClient({
      token,
      environment:
        environment === "sandbox"
          ? SquareEnvironment.Sandbox
          : SquareEnvironment.Production,
    });
  }

  return squareClient;
}

export function getSquareLocationId(): string {
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) {
    throw new Error("SQUARE_LOCATION_ID is not configured.");
  }
  return locationId;
}
```

If v45's constructor options differ (for example `accessToken` instead of `token`), check `node_modules/square` types and use the real names; keep the guard behavior identical.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/payments/square.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/payments/square.ts lib/payments/square.test.ts
git commit -m "feat(billing): Square server client with env guards"
```

---

### Task 7: Billing orchestration (`lib/billing/server.ts`)

**Files:**
- Create: `lib/billing/server.ts`

Impure glue shared by both API routes: company-admin auth, vehicle-count fetch, and the execute-one-charge-cycle function. No unit tests (network + DB); the gate is `npm run typecheck`, and Task 14 exercises it against the sandbox. Keep every branch of logic that CAN be pure delegated to the Task 2-5 modules.

- [ ] **Step 1: Write the module**

```ts
// lib/billing/server.ts
// Server-only billing orchestration. Auth, DB reads/writes (service role) and
// Square calls live here; all decisions are delegated to the pure modules.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, createUserClient } from "../accounts/server";
import { extractRoleName } from "../roles";
import { getSquare, getSquareLocationId } from "../payments/square";
import { chargeIdempotencyKey, computeChargeAmounts } from "./money";
import { countBillableVehicles } from "./vehicleCount";

export async function requireCompanyAdmin() {
  const userClient = await createUserClient();
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    throw new Error("UNAUTHENTICATED");
  }

  const admin = createAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("company_id, role_id, roles(name)")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  const role = extractRoleName(profile?.roles);

  if (!profile?.company_id || (role !== "admin" && role !== "super_admin")) {
    throw new Error("FORBIDDEN");
  }

  return { admin, user, companyId: profile.company_id as string, role };
}

export async function fetchBillableVehicleCount(
  admin: SupabaseClient,
  companyId: string
): Promise<number> {
  const [tenantsRes, vehiclesRes, licencesRes] = await Promise.all([
    admin.from("tenants").select("id").eq("company_id", companyId),
    admin.from("vehicles").select("id, tenant_id, company_id"),
    admin.from("vehicle_licences").select("vehicle_id, active").eq("active", true),
  ]);

  const firstError =
    tenantsRes.error ?? vehiclesRes.error ?? licencesRes.error;
  if (firstError) {
    throw new Error(`Unable to load billing data: ${firstError.message}`);
  }

  return countBillableVehicles({
    companyId,
    companyTenantIds: (tenantsRes.data ?? []).map((t) => t.id as string),
    vehicles: vehiclesRes.data ?? [],
    licences: licencesRes.data ?? [],
  });
}

function extractSquareFailureCode(error: unknown): string {
  // v45 throws SquareError with an errors array; fall back to the message.
  const maybe = error as { errors?: Array<{ code?: string }>; message?: string };
  return (
    maybe?.errors?.[0]?.code ??
    (maybe?.message ? maybe.message.slice(0, 120) : "UNKNOWN")
  );
}

export type CycleResult = {
  companyId: string;
  cycleDate: string;
  attempt: number;
  vehicleCount: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  succeeded: boolean;
  failureCode: string | null;
  squarePaymentId: string | null;
  receiptUrl: string | null;
};

// Runs one charge attempt end to end: count vehicles, take payment (skipped
// for zero vehicles), append the platform_charges audit row. Does NOT touch
// company_billing; callers persist applyChargeOutcome themselves, because the
// first-ever charge creates the row while cron charges update it.
export async function runChargeCycle(
  admin: SupabaseClient,
  args: {
    companyId: string;
    cycleDate: string;
    attempt: number;
    squareCustomerId: string;
    squareCardId: string;
  }
): Promise<CycleResult> {
  const vehicleCount = await fetchBillableVehicleCount(admin, args.companyId);
  const amounts = computeChargeAmounts(vehicleCount);

  let succeeded = true;
  let failureCode: string | null = null;
  let squarePaymentId: string | null = null;
  let receiptUrl: string | null = null;

  if (amounts.grossPence > 0) {
    try {
      const square = getSquare();
      const response = await square.payments.create({
        idempotencyKey: chargeIdempotencyKey(
          args.companyId,
          args.cycleDate,
          args.attempt
        ),
        sourceId: args.squareCardId,
        customerId: args.squareCustomerId,
        locationId: getSquareLocationId(),
        amountMoney: {
          amount: BigInt(amounts.grossPence),
          currency: "GBP",
        },
        note: `TMS Wizzard subscription ${args.cycleDate}: ${vehicleCount} vehicles`,
      });

      const payment = response.payment;
      squarePaymentId = payment?.id ?? null;
      receiptUrl = payment?.receiptUrl ?? null;
      succeeded = payment?.status === "COMPLETED";
      if (!succeeded) {
        failureCode = payment?.status ?? "NO_PAYMENT_RETURNED";
      }
    } catch (error) {
      succeeded = false;
      failureCode = extractSquareFailureCode(error);
    }
  }

  const { error: insertError } = await admin.from("platform_charges").insert({
    company_id: args.companyId,
    cycle_date: args.cycleDate,
    attempt: args.attempt,
    vehicle_count: vehicleCount,
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

  if (insertError) {
    // The payment (if any) went through; surface the bookkeeping failure
    // loudly rather than pretending the cycle did not happen.
    throw new Error(
      `Charge recorded at Square but platform_charges insert failed: ${insertError.message}`
    );
  }

  return {
    companyId: args.companyId,
    cycleDate: args.cycleDate,
    attempt: args.attempt,
    vehicleCount,
    netPence: amounts.netPence,
    vatPence: amounts.vatPence,
    grossPence: amounts.grossPence,
    succeeded,
    failureCode,
    squarePaymentId,
    receiptUrl,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. If the Square payment call or response property names differ in v45 (`payments.create` argument shape, `receiptUrl` casing), fix them against `node_modules/square` types now.

- [ ] **Step 3: Commit**

```bash
git add lib/billing/server.ts
git commit -m "feat(billing): company-admin auth and charge cycle orchestration"
```

---

### Task 8: Card route (`POST /api/billing/card`)

**Files:**
- Create: `app/api/billing/card/route.ts`

Handles both first-time setup (create customer, store card, immediate first charge, create `company_billing` only on success) and card replacement (update card, retry outstanding cycle if one exists).

- [ ] **Step 1: Write the route**

```ts
// app/api/billing/card/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "../../../../lib/accounts/server";
import { getSquare } from "../../../../lib/payments/square";
import {
  requireCompanyAdmin,
  runChargeCycle,
} from "../../../../lib/billing/server";
import { applyChargeOutcome } from "../../../../lib/billing/run";
import { computeNextChargeOn, londonDateISO } from "../../../../lib/billing/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  cardToken: z.string().min(1),
  verificationToken: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "cardToken and verificationToken are required." },
        { status: 400 }
      );
    }

    const { admin, companyId } = await requireCompanyAdmin();
    const square = getSquare();

    const { data: existing, error: existingError } = await admin
      .from("company_billing")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    // Find or create the Square customer. Search by reference_id first so a
    // failed first charge (which stores no row) does not create duplicates.
    let customerId = existing?.square_customer_id as string | undefined;
    if (!customerId) {
      const search = await square.customers.search({
        query: { filter: { referenceId: { exact: companyId } } },
      });
      customerId = search.customers?.[0]?.id ?? undefined;
    }
    if (!customerId) {
      const { data: company } = await admin
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle();
      const created = await square.customers.create({
        referenceId: companyId,
        companyName: (company?.name as string | undefined) ?? undefined,
      });
      customerId = created.customer?.id ?? undefined;
    }
    if (!customerId) {
      throw new Error("Square customer could not be created.");
    }

    const cardResponse = await square.cards.create({
      idempotencyKey: crypto.randomUUID(),
      sourceId: parsed.data.cardToken,
      verificationToken: parsed.data.verificationToken,
      card: { customerId },
    });

    const card = cardResponse.card;
    if (!card?.id) {
      throw new Error("Square card could not be stored.");
    }

    const cardFields = {
      square_customer_id: customerId,
      square_card_id: card.id,
      card_brand: card.cardBrand ?? null,
      card_last4: card.last4 ?? null,
      card_exp_month: card.expMonth != null ? Number(card.expMonth) : null,
      card_exp_year: card.expYear != null ? Number(card.expYear) : null,
    };

    const today = londonDateISO(new Date());

    if (!existing) {
      // First-time setup: immediate first charge; write company_billing only
      // on success so a declined card leaves no half-configured subscription.
      const anchorDay = Number(today.slice(8, 10));
      const result = await runChargeCycle(admin, {
        companyId,
        cycleDate: today,
        attempt: 1,
        squareCustomerId: customerId,
        squareCardId: card.id,
      });

      if (!result.succeeded) {
        return NextResponse.json(
          {
            error: "Your card was declined. No subscription was set up.",
            failureCode: result.failureCode,
          },
          { status: 402 }
        );
      }

      const nextChargeOn = computeNextChargeOn(today, anchorDay);
      const { error: insertError } = await admin.from("company_billing").insert({
        company_id: companyId,
        ...cardFields,
        status: "active",
        anchor_day: anchorDay,
        next_charge_on: nextChargeOn,
        retry_at: null,
        retry_count: 0,
      });
      if (insertError) {
        throw new Error(insertError.message);
      }

      return NextResponse.json({
        ok: true,
        firstCharge: true,
        vehicleCount: result.vehicleCount,
        grossPence: result.grossPence,
        receiptUrl: result.receiptUrl,
        nextChargeOn,
      });
    }

    // Replacement card: store the new card, then, if a cycle is outstanding
    // (mid-dunning or past_due), retry it immediately.
    const hasOutstandingCycle =
      existing.status === "past_due" || existing.retry_at !== null;

    if (!hasOutstandingCycle) {
      const { error: updateError } = await admin
        .from("company_billing")
        .update({ ...cardFields, updated_at: new Date().toISOString() })
        .eq("company_id", companyId);
      if (updateError) {
        throw new Error(updateError.message);
      }
      return NextResponse.json({ ok: true, firstCharge: false, retried: false });
    }

    const attempt = Number(existing.retry_count) + 1;
    const result = await runChargeCycle(admin, {
      companyId,
      cycleDate: existing.next_charge_on as string,
      attempt,
      squareCustomerId: customerId,
      squareCardId: card.id,
    });

    const outcome = applyChargeOutcome({
      row: {
        anchor_day: Number(existing.anchor_day),
        next_charge_on: existing.next_charge_on as string,
      },
      cycleDate: existing.next_charge_on as string,
      attempt,
      succeeded: result.succeeded,
    });

    const { error: updateError } = await admin
      .from("company_billing")
      .update({
        ...cardFields,
        ...outcome,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId);
    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({
      ok: true,
      firstCharge: false,
      retried: true,
      succeeded: result.succeeded,
      failureCode: result.failureCode,
      receiptUrl: result.receiptUrl,
      status: outcome.status,
    });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
```

One subtlety to preserve: a card-replacement retry while `past_due` uses `attempt = retry_count + 1` (attempt 5 and up). The `platform_charges` check constraint allows any attempt >= 1 for exactly this reason.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. Fix Square response property names against v45 types if needed (`cardBrand`, `last4`, `expMonth`, `expYear` and the `customers.search` filter shape are the likely suspects).

- [ ] **Step 3: Commit**

```bash
git add app/api/billing/card/route.ts
git commit -m "feat(billing): card setup route with immediate first charge"
```

---

### Task 9: Cron route (`GET /api/billing/run`) and Vercel cron

**Files:**
- Create: `app/api/billing/run/route.ts`
- Create: `vercel.json`
- Modify: `.env.local` (add `CRON_SECRET`)

- [ ] **Step 1: Write the route**

```ts
// app/api/billing/run/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/accounts/server";
import { runChargeCycle } from "../../../../lib/billing/server";
import { applyChargeOutcome, selectDueAction } from "../../../../lib/billing/run";
import type { CompanyBillingRow } from "../../../../lib/billing/run";
import { londonDateISO } from "../../../../lib/billing/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Charging many companies serially can exceed the default limit.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  // This endpoint charges cards. No secret configured means no access at all.
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = londonDateISO(new Date());

  const { data: rows, error } = await admin
    .from("company_billing")
    .select("*")
    .neq("status", "canceled");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const raw of rows ?? []) {
    const row: CompanyBillingRow = {
      company_id: raw.company_id,
      status: raw.status,
      anchor_day: Number(raw.anchor_day),
      next_charge_on: raw.next_charge_on,
      retry_at: raw.retry_at ?? null,
      retry_count: Number(raw.retry_count),
    };

    const action = selectDueAction(row, today);
    if (action.kind === "none") {
      skipped += 1;
      continue;
    }

    // Per-company isolation: one company's failure never aborts the batch.
    try {
      const result = await runChargeCycle(admin, {
        companyId: row.company_id,
        cycleDate: action.cycleDate,
        attempt: action.attempt,
        squareCustomerId: raw.square_customer_id,
        squareCardId: raw.square_card_id,
      });

      const outcome = applyChargeOutcome({
        row,
        cycleDate: action.cycleDate,
        attempt: action.attempt,
        succeeded: result.succeeded,
      });

      const { error: updateError } = await admin
        .from("company_billing")
        .update({ ...outcome, updated_at: new Date().toISOString() })
        .eq("company_id", row.company_id);
      if (updateError) {
        throw new Error(updateError.message);
      }

      if (result.succeeded) {
        succeeded += 1;
      } else {
        failed += 1;
      }
      results.push({
        companyId: row.company_id,
        cycleDate: action.cycleDate,
        attempt: action.attempt,
        vehicleCount: result.vehicleCount,
        grossPence: result.grossPence,
        succeeded: result.succeeded,
        failureCode: result.failureCode,
        newStatus: outcome.status,
      });
    } catch (cycleError) {
      failed += 1;
      const message =
        cycleError instanceof Error ? cycleError.message : "Unknown error.";
      console.error(`billing cron: company ${row.company_id} failed:`, message);
      results.push({ companyId: row.company_id, error: message });
    }
  }

  return NextResponse.json({
    ok: true,
    date: today,
    processed: (rows ?? []).length,
    charged: succeeded,
    failed,
    skipped,
    results,
  });
}
```

- [ ] **Step 2: Create `vercel.json`**

There is currently no `vercel.json` in the repo, so this file is new. Vercel invokes cron paths with GET and, when a `CRON_SECRET` env var exists on the project, automatically sends it as `Authorization: Bearer <value>`.

```json
{
  "crons": [
    {
      "path": "/api/billing/run",
      "schedule": "0 6 * * *"
    }
  ]
}
```

06:00 UTC daily: early enough that charges land at the start of the UK business day, and the one-hour London offset in summer never moves it across a date boundary.

- [ ] **Step 3: Generate a CRON_SECRET and add it to `.env.local`**

Run (PowerShell): `[guid]::NewGuid().ToString("N")`
Append to `.env.local`: `CRON_SECRET=<the generated value>`
Do NOT commit the value anywhere. Note for the final report: Ethan must add `CRON_SECRET` to Vercel env vars too.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/billing/run/route.ts vercel.json
git commit -m "feat(billing): daily charge cron route and Vercel schedule"
```

---

### Task 10: Square card form component

**Files:**
- Create: `components/billing/SquareCardForm.tsx`

Client component that loads the Web Payments SDK script, mounts the hosted card fields, tokenizes, runs `verifyBuyer` (the 3-D Secure step, mandatory for storing UK cards), and POSTs to `/api/billing/card`.

- [ ] **Step 1: Write the component**

```tsx
// components/billing/SquareCardForm.tsx
"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typings for the Web Payments SDK surface we use.
type SquareCard = {
  attach: (selector: string) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: Array<{ message?: string }> }>;
  destroy: () => Promise<void>;
};

type SquarePayments = {
  card: () => Promise<SquareCard>;
  verifyBuyer: (
    token: string,
    details: {
      intent: "STORE";
      billingContact: { givenName?: string; familyName?: string };
    }
  ) => Promise<{ token: string } | null>;
};

declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => SquarePayments;
    };
  }
}

const APP_ID = process.env.NEXT_PUBLIC_SQUARE_APP_ID ?? "";
const LOCATION_ID = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID ?? "";

// Sandbox app ids are prefixed "sandbox-"; each environment has its own CDN.
const SDK_URL = APP_ID.startsWith("sandbox-")
  ? "https://sandbox.web.squarecdn.com/v1/square.js"
  : "https://web.squarecdn.com/v1/square.js";

type Props = {
  onComplete: (response: Record<string, unknown>) => void;
};

export default function SquareCardForm({ onComplete }: Props) {
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const paymentsRef = useRef<SquarePayments | null>(null);
  const cardRef = useRef<SquareCard | null>(null);

  useEffect(() => {
    if (!APP_ID || !LOCATION_ID) {
      setErrorMessage(
        "Square is not configured (missing NEXT_PUBLIC_SQUARE_APP_ID or NEXT_PUBLIC_SQUARE_LOCATION_ID)."
      );
      return;
    }

    let cancelled = false;

    async function init() {
      if (!window.Square) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = SDK_URL;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Square SDK failed to load."));
          document.head.appendChild(script);
        });
      }
      if (cancelled || !window.Square) return;
      const payments = window.Square.payments(APP_ID, LOCATION_ID);
      const card = await payments.card();
      if (cancelled) {
        await card.destroy();
        return;
      }
      await card.attach("#square-card-container");
      paymentsRef.current = payments;
      cardRef.current = card;
      setReady(true);
    }

    init().catch((error) => {
      setErrorMessage(
        error instanceof Error ? error.message : "Square SDK failed to load."
      );
    });

    return () => {
      cancelled = true;
      cardRef.current?.destroy().catch(() => {});
      cardRef.current = null;
    };
  }, []);

  async function submit() {
    const payments = paymentsRef.current;
    const card = cardRef.current;
    if (!payments || !card || submitting) return;

    setSubmitting(true);
    setErrorMessage("");

    try {
      const tokenResult = await card.tokenize();
      if (tokenResult.status !== "OK" || !tokenResult.token) {
        throw new Error(
          tokenResult.errors?.[0]?.message ?? "Card details were not accepted."
        );
      }

      // 3-D Secure. Required to store a UK card; later monthly charges are
      // merchant-initiated and exempt.
      const nameParts = cardholderName.trim().split(/\s+/);
      const verification = await payments.verifyBuyer(tokenResult.token, {
        intent: "STORE",
        billingContact: {
          givenName: nameParts[0] || undefined,
          familyName: nameParts.slice(1).join(" ") || undefined,
        },
      });
      if (!verification?.token) {
        throw new Error("Card verification was not completed.");
      }

      const response = await fetch("/api/billing/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardToken: tokenResult.token,
          verificationToken: verification.token,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Payment setup failed.");
      }
      onComplete(body);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Payment setup failed."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm text-ink">
        Name on card
        <input
          type="text"
          value={cardholderName}
          onChange={(e) => setCardholderName(e.target.value)}
          className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
          autoComplete="cc-name"
        />
      </label>

      <div
        id="square-card-container"
        className="rounded-md border border-line bg-surface p-2"
      />

      {errorMessage ? (
        <div className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {errorMessage}
        </div>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || submitting}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
      >
        {submitting ? "Processing..." : "Save card and start subscription"}
      </button>
    </div>
  );
}
```

Token classes used (`bg-surface`, `border-line`, `text-danger`, `bg-primary`, `text-on-primary`, `text-ink`): check `app/tokens.css` / `app/globals.css` for the exact utility names in this repo and substitute the real ones (for example if the border token utility is `border-border` or the surface is `bg-panel`). Do not introduce raw color literals.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/billing/SquareCardForm.tsx
git commit -m "feat(billing): Square Web Payments card form with 3DS verify"
```

---

### Task 11: Billing settings page (`/settings/billing`)

**Files:**
- Create: `app/settings/billing/page.tsx`
- Modify: `lib/nav/themeableRoutes.ts` (add `"/settings/billing"` entry)

- [ ] **Step 1: Write the page**

Follow the ds pattern of `app/settings/invoices/page.tsx` (root `className="ds min-h-screen bg-canvas font-sans text-ink"`, `Stat` from `components/Stat`).

```tsx
// app/settings/billing/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import Stat from "../../../components/Stat";
import SquareCardForm from "../../../components/billing/SquareCardForm";
import {
  computeChargeAmounts,
} from "../../../lib/billing/money";

type BillingRow = {
  company_id: string;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  status: "active" | "past_due" | "canceled";
  next_charge_on: string;
};

type ChargeRow = {
  id: string;
  cycle_date: string;
  attempt: number;
  vehicle_count: number;
  gross_pence: number;
  status: "succeeded" | "failed";
  failure_code: string | null;
  receipt_url: string | null;
  created_at: string;
};

function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export default function BillingSettingsPage() {
  const supabase = createClient();
  const { role } = useTenant();

  const [billing, setBilling] = useState<BillingRow | null>(null);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCardForm, setShowCardForm] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [billingRes, chargesRes, licencesRes] = await Promise.all([
      supabase.from("company_billing").select("*").maybeSingle(),
      supabase
        .from("platform_charges")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(24),
      supabase.from("vehicle_licences").select("vehicle_id").eq("active", true),
    ]);
    setBilling((billingRes.data as BillingRow) ?? null);
    setCharges((chargesRes.data as ChargeRow[]) ?? []);
    setVehicleCount(new Set(licencesRes.data?.map((l) => l.vehicle_id)).size);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const isAdmin = role === "admin" || role === "super_admin";
  const amounts = computeChargeAmounts(vehicleCount);

  if (!isAdmin) {
    return (
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <p className="text-sm text-ink-3">
            Billing is managed by your company admin.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-[1480px] px-6 py-8">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Admin</div>
          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Subscription
          </h1>
          <p className="text-sm text-ink-3">
            £10 per active licensed vehicle per month, plus VAT, charged to
            your card on your billing date.
          </p>
        </header>

        {billing?.status === "past_due" ? (
          <div className="mb-4 rounded-md border border-danger px-4 py-3 text-sm text-danger">
            Your last payment failed. Add a new card below to bring your
            subscription back up to date.
          </div>
        ) : null}

        {notice ? (
          <div className="mb-4 rounded-md border border-line px-4 py-3 text-sm text-ink">
            {notice}
          </div>
        ) : null}

        <div className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label="Licensed vehicles"
            value={String(vehicleCount)}
            sub="counted on each billing date"
          />
          <Stat
            label="Monthly total"
            value={pounds(amounts.grossPence)}
            sub={`${pounds(amounts.netPence)} + ${pounds(amounts.vatPence)} VAT`}
          />
          <Stat
            label="Status"
            value={billing ? billing.status.replace("_", " ") : "not set up"}
          />
          <Stat
            label="Next charge"
            value={billing?.next_charge_on ?? "n/a"}
          />
        </div>

        <section className="mb-6 max-w-[480px]">
          <h2 className="mb-2 text-base font-semibold text-ink">
            Payment method
          </h2>
          {billing && !showCardForm ? (
            <div className="flex items-center gap-3 rounded-md border border-line px-4 py-3 text-sm">
              <span>
                {billing.card_brand ?? "Card"} ending {billing.card_last4},
                expires {billing.card_exp_month}/{billing.card_exp_year}
              </span>
              <button
                type="button"
                onClick={() => setShowCardForm(true)}
                className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink"
              >
                Replace card
              </button>
            </div>
          ) : (
            <SquareCardForm
              onComplete={(response) => {
                setShowCardForm(false);
                setNotice(
                  response.firstCharge
                    ? `Subscription started: ${pounds(Number(response.grossPence))} charged. Next charge ${response.nextChargeOn}.`
                    : "Card updated."
                );
                load();
              }}
            />
          )}
        </section>

        <section>
          <h2 className="mb-2 text-base font-semibold text-ink">
            Charge history
          </h2>
          {loading ? (
            <p className="text-sm text-ink-3">Loading...</p>
          ) : charges.length === 0 ? (
            <p className="text-sm text-ink-3">No charges yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="px-3 py-2 font-medium">Billing date</th>
                    <th className="px-3 py-2 font-medium">Vehicles</th>
                    <th className="px-3 py-2 font-medium">Amount</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((charge) => (
                    <tr key={charge.id} className="border-b border-line">
                      <td className="px-3 py-2">{charge.cycle_date}</td>
                      <td className="px-3 py-2">{charge.vehicle_count}</td>
                      <td className="px-3 py-2">{pounds(charge.gross_pence)}</td>
                      <td className="px-3 py-2">
                        {charge.status === "succeeded"
                          ? "Paid"
                          : `Failed (${charge.failure_code ?? "declined"})`}
                      </td>
                      <td className="px-3 py-2">
                        {charge.receipt_url ? (
                          <a
                            href={charge.receipt_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline"
                          >
                            View
                          </a>
                        ) : (
                          "n/a"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
```

Notes for the implementer:
- `useTenant()` provides `role`; confirm the exact field names against `app/components/TenantProvider.tsx` before relying on them.
- The vehicle-count preview intentionally mirrors `app/settings/invoices/page.tsx` (active licences visible under RLS). The authoritative count happens server-side at charge time.
- Same token-utility caveat as Task 10: verify class names against `app/tokens.css`.

- [ ] **Step 2: Add the route to the theme allowlist**

In `lib/nav/themeableRoutes.ts`, add to `THEMEABLE_ROUTES` after the `"/settings/company"` entry:

```ts
  "/settings/billing",        // app/settings/billing/page.tsx
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/settings/billing/page.tsx lib/nav/themeableRoutes.ts
git commit -m "feat(billing): subscription settings page with card management"
```

---

### Task 12: Past-due banner

**Files:**
- Create: `components/billing/PastDueBanner.tsx`
- Modify: `app/layout.tsx` (mount the banner inside `TenantProvider`)

- [ ] **Step 1: Write the component**

```tsx
// components/billing/PastDueBanner.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTenant } from "../../app/components/TenantProvider";
import { shouldShowShell } from "../../lib/nav/shouldShowShell";
import { createClient } from "../../lib/supabase/browser";

// Fixed overlay shown to company admins while their subscription is past_due.
// RLS means the company_billing select returns at most the caller's own row.
export default function PastDueBanner() {
  const pathname = usePathname();
  const { role, status } = useTenant();
  const [pastDue, setPastDue] = useState(false);

  useEffect(() => {
    if (role !== "admin") return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("company_billing")
      .select("status")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setPastDue(data?.status === "past_due");
      });
    return () => {
      cancelled = true;
    };
  }, [role, pathname]);

  if (!pastDue) return null;
  if (!shouldShowShell(pathname, status)) return null;
  if (pathname === "/settings/billing") return null;

  return (
    <div className="ds fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-danger px-4 py-2 font-sans text-sm font-semibold text-on-danger">
      <span>A subscription payment failed. Please update your card.</span>
      <Link
        href="/settings/billing"
        className="underline"
      >
        Go to billing
      </Link>
    </div>
  );
}
```

Same caveats as before: confirm `useTenant()`'s `role`/`status` field names and the `shouldShowShell(pathname, status)` signature against `app/components/AppShell.tsx:29-31`, which uses exactly this pattern; confirm `bg-danger`/`text-on-danger` utilities exist in the token setup.

- [ ] **Step 2: Mount it in the root layout**

In `app/layout.tsx`, import it and render it as the first child inside `TenantProvider` (it is a fixed overlay, so it must not sit inside the flex row):

```tsx
import PastDueBanner from "../components/billing/PastDueBanner";
```

```tsx
        <TenantProvider>
          <PastDueBanner />
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <AppShell />
            <ThemeScope>{children}</ThemeScope>
          </div>
        </TenantProvider>
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/billing/PastDueBanner.tsx app/layout.tsx
git commit -m "feat(billing): past-due banner for company admins"
```

---

### Task 13: Super-admin billing visibility

**Files:**
- Modify: `app/super-admin/billing/page.tsx`

Two changes: show subscription status per company, and refactor the page's billable-count maths onto the shared `lib/billing/vehicleCount.ts` definition (the spec requires the page and the cron to share one implementation). This is a legacy inline-styled page: match its existing style (inline styles, no ds classes), change as little as possible beyond these two things.

Naming note: the page already has a `billingRows` memo, so the new `company_billing` state MUST be named `subscriptionRows`, not `billingRows`.

- [ ] **Step 1: Refactor the count onto the shared definition**

Import at the top of the file:

```ts
import { countBillableVehicles } from "../../../lib/billing/vehicleCount";
```

In the `billingRows` memo, keep the existing `companyVehicles` filter (still needed for the `totalVehicles` display), but replace the manual `vehicleIds`/`licensedVehicleIds` set logic with:

```ts
const billableVehicleCount = countBillableVehicles({
    companyId: company.id,
    companyTenantIds: [],
    vehicles,
    licences,
});
```

`companyTenantIds: []` preserves the page's current behavior exactly (it never fetched tenants; the shared function's direct `tenant_id`/`company_id` matching covers what the page matched before). The row types on the page are structurally compatible with `VehicleRow`/`LicenceRow`.

- [ ] **Step 2: Extend the data load**

Add a `company_billing` fetch to the existing `Promise.all` in `loadData` and store it in state:

```ts
type CompanyBilling = {
    company_id: string;
    status: string | null;
    next_charge_on: string | null;
    card_last4: string | null;
    retry_count: number | null;
};
```

```ts
const [billingRows, setBillingRows] = useState<CompanyBilling[]>([]);
```

In the `Promise.all`, add:

```ts
supabase.from("company_billing").select("company_id, status, next_charge_on, card_last4, retry_count"),
```

and destructure/store it like the other results (`setBillingRows((billingData as CompanyBilling[]) || [])`). Include its error in the error-message chain.

- [ ] **Step 3: Render the status inside each company card**

Inside the `billingRows.map` card (after the "Monthly Charge" div), look up and render the subscription state:

```tsx
{(() => {
    const sub = subscriptionRows.find((s) => s.company_id === row.company.id);
    if (!sub) {
        return (
            <div style={{ opacity: 0.8, marginBottom: 12 }}>
                Subscription: no card on file
            </div>
        );
    }
    const isPastDue = sub.status === "past_due";
    return (
        <div
            style={{
                marginBottom: 12,
                color: isPastDue ? "#b91c1c" : undefined,
                fontWeight: isPastDue ? 700 : undefined,
                opacity: isPastDue ? 1 : 0.8,
            }}
        >
            Subscription: {sub.status}
            {sub.card_last4 ? ` • card ****${sub.card_last4}` : ""}
            {sub.next_charge_on ? ` • next charge ${sub.next_charge_on}` : ""}
            {isPastDue ? ` • ${sub.retry_count ?? 0} failed attempts` : ""}
        </div>
    );
})()}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/super-admin/billing/page.tsx
git commit -m "feat(billing): shared count and subscription status on super-admin billing"
```

---

### Task 14: Docs, verification, sandbox walkthrough

**Files:**
- Modify: `README.md` (page inventory, env vars, integrations)

- [ ] **Step 1: Update README.md**

- Page inventory: add a `/settings/billing` row, status [OK], description like: "subscription payment method (Square card on file) and charge history; company admins only". Update the `/super-admin/billing` row's description to mention subscription status.
- Environment variables section: add `SQUARE_ACCESS_TOKEN`, `SQUARE_ENVIRONMENT`, `SQUARE_LOCATION_ID`, `NEXT_PUBLIC_SQUARE_APP_ID`, `NEXT_PUBLIC_SQUARE_LOCATION_ID`, `CRON_SECRET` with one-line descriptions.
- Integrations section: add Square (platform subscription billing), distinct from the existing Stripe Connect entry.
- Note `docs/sql/billing_01_platform_billing.sql` wherever the RLS migration list is documented.

- [ ] **Step 2: Full verification**

Run: `npm run typecheck`
Expected: clean.

Run: `npm test`
Expected: all tests pass, including the ~40 new billing tests and the pre-existing suite (contrast, tenant, pod, etc.).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Square subscription billing and new env vars"
```

- [ ] **Step 4: Manual sandbox walkthrough (requires the migration applied)**

Document the following in the final report as the manual test script for Ethan (the dev-login flow in `scripts/dev-login.mjs` signs into the LIVE Supabase, so charges recorded during this test land in production data; Square money flows stay in the sandbox):

1. Apply `docs/sql/billing_01_platform_billing.sql` in the Supabase SQL editor.
2. `npm run dev`, sign in as a company admin, open `/settings/billing`.
3. Add Square's sandbox test card `4111 1111 1111 1111` (any future expiry, any CVV, any postcode). Expect: 3DS challenge, then a success notice showing the charged amount and next charge date; a `succeeded` row in the history table; the payment visible in the Square sandbox dashboard.
4. Trigger the cron manually (PowerShell):
   `Invoke-RestMethod -Uri "http://localhost:3000/api/billing/run" -Headers @{ Authorization = "Bearer <CRON_SECRET value>" }`
   Expect: `charged: 0, skipped: 1` (next charge is a month away).
5. Decline path: in Supabase, set the company's `next_charge_on` to today and replace `square_card_id` with a bogus id; run the cron; expect a `failed` charge row and `retry_at` two days out. Set `retry_at` back to today and rerun three more times; expect `past_due` and the admin banner on next page load. Replace the card in the UI; expect an immediate successful retry and status back to `active`.
6. Reset any rows mutated during testing.

---

## Execution notes

- Tasks 2 through 6 are independent of each other and of Task 1; they can be done in any order but the listed order keeps dependencies obvious. Tasks 7+ depend on 2 through 6.
- Task 1's SQL and Task 14's walkthrough are the only steps touching the real Supabase project, and both are manual/Ethan-gated.
- Nothing in this plan touches the existing Stripe Connect flow, the `invoices` table, or `/super-admin/invoices`.
- Final state for `superpowers:finishing-a-development-branch`: all tests green, typecheck clean, branch `ethan/square-platform-billing` ready for merge decision. Outstanding for Ethan afterward: apply the migration, add `CRON_SECRET` + the five Square vars to Vercel, run the sandbox walkthrough.
