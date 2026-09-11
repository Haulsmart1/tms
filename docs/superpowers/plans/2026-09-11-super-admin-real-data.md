# Super Admin Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `/super-admin` dashboard with live platform figures, make the company and user lists searchable and informative, and add the area's first write path: editing a company profile and renaming or re-parenting its tenants.

**Architecture:** Reads stay on the client through Supabase RLS, which already grants super_admin platform-wide select. Writes go through three new server routes, because `companies` and `tenants` have no RLS write policy at all by design (`docs/sql/rls_04_identity_tables.sql`), so only the service-role key can write them. All aggregation, filtering and validation logic lives in `lib/superAdmin/` as pure functions with colocated vitest tests, because `vitest.config.ts` covers `lib/**/*.test.ts` only and nothing under `app/`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres + RLS + service role), Tailwind with the repo's `ds` design-system tokens, vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-super-admin-real-data-design.md`

---

## Before you start

Read these, in this order. They contain constraints that will silently break your work if you miss them:

1. `CLAUDE.md` at the repo root, the "Tenancy is the backbone" and "One styling system" sections.
2. The spec above, especially "Findings that shaped the design".

The four rules you are most likely to break:

- **`vehicles` has no `company_id` column.** Selecting one fails the whole PostgREST request with Postgres error 42703. A vehicle reaches its company through its `tenant_id`.
- **`company_profiles.tenant_id` holds a COMPANY id**, despite the name. One profile row per company.
- **Never use Tailwind `dark:` variants.** This app's `:root` holds the dark values and `.light` is the opt-out, so `dark:` means the opposite of what it reads as. Put theme differences in token values.
- **Every page root needs `className="ds font-sans ..."`.** Tailwind Preflight is disabled globally. Without `ds` the borders and layout break; without `font-sans` the font silently falls back to Inter.

Commands:

```bash
npm test              # vitest run, lib/**/*.test.ts only
npm run typecheck     # next typegen && tsc --noEmit, the fast correctness gate
npx vitest run lib/superAdmin/search.test.ts     # single file
```

---

## File Structure

**Create:**

| Path | Responsibility |
| --- | --- |
| `lib/superAdmin/search.ts` | The search predicate. Pure. |
| `lib/superAdmin/search.test.ts` | Tests for the above. |
| `lib/superAdmin/summary.ts` | Aggregates raw rows into dashboard tiles and company list rows. Pure. |
| `lib/superAdmin/summary.test.ts` | Tests for the above. |
| `lib/superAdmin/companyEdit.ts` | Column allowlist, normalization and validation for a company edit. Pure. |
| `lib/superAdmin/companyEdit.test.ts` | Tests for the above. |
| `lib/superAdmin/guard.ts` | `withSuperAdmin()` wrapper for route handlers, `requireSuperAdmin()` / `resolveSuperAdmin()` for callers that need the session, and the pure decision they wrap. |
| `lib/superAdmin/guard.test.ts` | Tests the pure decision. |
| `components/SearchInput.tsx` | The one search box, styled from the same rules as `Field`. |
| `app/api/super-admin/users/route.ts` | `GET`. Joins profiles to `auth.users` for email. Service role. |
| `app/api/super-admin/companies/[id]/route.ts` | `PATCH`. Writes `companies.name` and upserts `company_profiles`. Service role. |
| `app/api/super-admin/tenants/[id]/route.ts` | `PATCH`. Renames or re-parents a tenant. Service role. |
| `app/super-admin/companies/[id]/page.tsx` | Company detail and edit page. |

**Modify:**

| Path | Change |
| --- | --- |
| `app/super-admin/page.tsx` | Hardcoded tiles become live figures. |
| `app/super-admin/companies/page.tsx` | Cards become a searchable `DataTable` with real columns. |
| `app/super-admin/users/page.tsx` | Backed by the new route, gains email and search. |
| `app/super-admin/invoices/page.tsx` | Search box only. |
| `app/super-admin/requests/page.tsx` | Search box only. |
| `app/super-admin/layout.tsx` | Off inline styles, onto `ds` tokens; role check moves to `guard.ts`. |
| `lib/nav/themeableRoutes.ts` | Narrow prefix rule for `/super-admin/companies/`. |
| `lib/nav/themeableRoutes.test.ts` | Assert the new rule. |
| `README.md` | Page inventory status for the changed routes. |

---

## Task 1: The search predicate

**Files:**
- Create: `lib/superAdmin/search.ts`
- Test: `lib/superAdmin/search.test.ts`

Why a module rather than an inline `.filter()`: four pages need the same behaviour, and "every term must match some field" is easy to get subtly wrong (the naive version matches the whole query against one field, so "acme past" finds nothing).

- [ ] **Step 1: Write the failing test**

Create `lib/superAdmin/search.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchesSearch, filterBySearch } from "./search";

describe("matchesSearch", () => {
  it("returns true for an empty query", () => {
    expect(matchesSearch("", ["Acme Haulage"])).toBe(true);
    expect(matchesSearch("   ", ["Acme Haulage"])).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesSearch("acme", ["Acme Haulage"])).toBe(true);
    expect(matchesSearch("ACME", ["Acme Haulage"])).toBe(true);
  });

  it("requires every term to match, across different fields", () => {
    // The point of the module. "acme past" should find the past-due Acme,
    // even though no single field contains both words.
    expect(matchesSearch("acme past", ["Acme Haulage", "past_due"])).toBe(true);
    expect(matchesSearch("acme active", ["Acme Haulage", "past_due"])).toBe(false);
  });

  it("ignores null and undefined fields", () => {
    expect(matchesSearch("acme", [null, undefined, "Acme Haulage"])).toBe(true);
    expect(matchesSearch("acme", [null, undefined])).toBe(false);
  });

  it("collapses extra whitespace between terms", () => {
    expect(matchesSearch("  acme   past ", ["Acme Haulage", "past_due"])).toBe(true);
  });
});

describe("filterBySearch", () => {
  type Row = { name: string; status: string | null };
  const rows: Row[] = [
    { name: "Acme Haulage", status: "past_due" },
    { name: "Bravo Logistics", status: "active" },
  ];
  const fieldsOf = (row: Row) => [row.name, row.status];

  it("returns every row for an empty query", () => {
    expect(filterBySearch("", rows, fieldsOf)).toHaveLength(2);
  });

  it("returns only matching rows", () => {
    expect(filterBySearch("bravo", rows, fieldsOf)).toEqual([rows[1]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterBySearch("zzz", rows, fieldsOf)).toEqual([]);
  });

  it("does not match a field the caller did not declare", () => {
    // Searchable fields are declared explicitly, never derived by
    // stringifying the row, so a hidden field can never produce a
    // match the operator cannot see the reason for.
    const onlyName = (row: Row) => [row.name];
    expect(filterBySearch("past", rows, onlyName)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/superAdmin/search.test.ts`
Expected: FAIL, "Failed to resolve import ./search".

- [ ] **Step 3: Write the implementation**

Create `lib/superAdmin/search.ts`:

```ts
/* The one search predicate for the /super-admin list pages.

   Every term must match SOME field, rather than the whole query matching one
   field. That is what makes "acme past" find the past-due Acme: the two terms
   land in different columns. The naive whole-query version finds nothing there,
   which reads to the operator as "no such company".

   Fields are declared by the caller, never derived by stringifying the row. A
   row carries ids, timestamps and flags the operator cannot see; if those were
   searchable, a query would return rows with no visible reason for matching. */

export type SearchableField = string | null | undefined;

function terms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesSearch(query: string, fields: readonly SearchableField[]): boolean {
  const needles = terms(query);
  if (needles.length === 0) return true;

  const haystack = fields
    .filter((field): field is string => typeof field === "string")
    .join(" ")
    .toLowerCase();

  return needles.every((needle) => haystack.includes(needle));
}

export function filterBySearch<T>(
  query: string,
  rows: readonly T[],
  fieldsOf: (row: T) => readonly SearchableField[],
): T[] {
  if (terms(query).length === 0) return [...rows];
  return rows.filter((row) => matchesSearch(query, fieldsOf(row)));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/superAdmin/search.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/superAdmin/search.ts lib/superAdmin/search.test.ts
git commit -m "Add the super-admin search predicate"
```

---

## Task 2: Dashboard and company-list aggregation

**Files:**
- Create: `lib/superAdmin/summary.ts`
- Test: `lib/superAdmin/summary.test.ts`

This module owns two things: what "collected in the last 28 days" means, and how raw rows roll up into a company list row. Both are pure. The pages fetch; this aggregates.

The revenue rule has two traps worth a test each. **Refunds are not revenue:** `period_charges` has a `refunded` status that the v1 tables do not, and a refunded period collected nothing. **A missing table must not zero the tile silently:** several `billing_0*` migrations may not be applied on the live project, so a source that does not exist has to be reported, not treated as zero income.

- [ ] **Step 1: Write the failing test**

Create `lib/superAdmin/summary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  collectedRevenue,
  buildCompanySummaries,
  isMissingRelationError,
  type ChargeSource,
} from "./summary";

const NOW = new Date("2026-09-11T12:00:00Z");

function charge(over: Partial<{ company_id: string; gross_pence: number | null; status: string | null; created_at: string | null }> = {}) {
  return {
    company_id: "c1",
    gross_pence: 10_000,
    status: "succeeded",
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

describe("collectedRevenue", () => {
  it("sums succeeded charges across all three sources", () => {
    const sources: ChargeSource[] = [
      { key: "v1_cycle", label: "v1 cycles", rows: [charge({ gross_pence: 10_000 })] },
      { key: "v1_addon", label: "v1 mid-cycle additions", rows: [charge({ gross_pence: 2_500 })] },
      { key: "v2_period", label: "v2 periods", rows: [charge({ gross_pence: 7_500 })] },
    ];
    expect(collectedRevenue(sources, NOW).totalPence).toBe(20_000);
  });

  it("excludes failed charges", () => {
    const sources: ChargeSource[] = [
      { key: "v1_cycle", label: "v1 cycles", rows: [charge(), charge({ status: "failed" })] },
    ];
    expect(collectedRevenue(sources, NOW).totalPence).toBe(10_000);
  });

  it("excludes refunded charges", () => {
    // A refunded period succeeded and was then given back in full. Counting it
    // as revenue overstates income by the exact amount that was returned.
    const sources: ChargeSource[] = [
      { key: "v2_period", label: "v2 periods", rows: [charge(), charge({ status: "refunded" })] },
    ];
    expect(collectedRevenue(sources, NOW).totalPence).toBe(10_000);
  });

  it("excludes pending charges", () => {
    const sources: ChargeSource[] = [
      { key: "v2_period", label: "v2 periods", rows: [charge({ status: "pending" })] },
    ];
    expect(collectedRevenue(sources, NOW).totalPence).toBe(0);
  });

  it("excludes charges older than the 28 day window", () => {
    const sources: ChargeSource[] = [
      { key: "v1_cycle", label: "v1 cycles", rows: [
        charge({ created_at: "2026-09-10T00:00:00Z" }),
        charge({ created_at: "2026-07-01T00:00:00Z" }),
      ] },
    ];
    expect(collectedRevenue(sources, NOW).totalPence).toBe(10_000);
  });

  it("counts distinct companies that paid", () => {
    const sources: ChargeSource[] = [
      { key: "v1_cycle", label: "v1 cycles", rows: [charge({ company_id: "c1" }), charge({ company_id: "c2" })] },
      { key: "v1_addon", label: "v1 mid-cycle additions", rows: [charge({ company_id: "c1" })] },
    ];
    expect(collectedRevenue(sources, NOW).companyCount).toBe(2);
  });

  it("reports an unavailable source instead of treating it as zero", () => {
    // rows: null means the table could not be read, usually an unapplied
    // migration. A silent zero would be worse than the hardcoded placeholder
    // this tile replaces.
    const sources: ChargeSource[] = [
      { key: "v1_cycle", label: "v1 cycles", rows: [charge()] },
      { key: "v2_period", label: "v2 periods", rows: null },
    ];
    const result = collectedRevenue(sources, NOW);
    expect(result.totalPence).toBe(10_000);
    expect(result.missingSources).toEqual(["v2 periods"]);
  });

  it("treats a null gross_pence as zero rather than NaN", () => {
    const sources: ChargeSource[] = [
      { key: "v1_cycle", label: "v1 cycles", rows: [charge({ gross_pence: null })] },
    ];
    expect(collectedRevenue(sources, NOW).totalPence).toBe(0);
  });
});

describe("buildCompanySummaries", () => {
  const input = {
    companies: [
      { id: "c1", name: "Acme Haulage" },
      { id: "c2", name: "Bravo Logistics" },
    ],
    tenants: [
      { id: "t1", name: "Acme North", company_id: "c1" },
      { id: "t2", name: "Acme South", company_id: "c1" },
      { id: "t3", name: "Bravo Main", company_id: "c2" },
    ],
    vehicles: [
      { id: "v1", tenant_id: "t1" },
      { id: "v2", tenant_id: "t2" },
      { id: "v3", tenant_id: "t3" },
    ],
    licences: [
      { vehicle_id: "v1", active: true },
      { vehicle_id: "v1", active: true },
      { vehicle_id: "v2", active: false },
      { vehicle_id: "v3", active: true },
    ],
    profiles: [
      { id: "u1", tenant_id: "t1" },
      { id: "u2", tenant_id: "t3" },
    ],
    billing: [
      { company_id: "c1", status: "active", billing_model: "v1_immediate" },
    ],
  };

  it("counts tenants per company", () => {
    const rows = buildCompanySummaries(input);
    expect(rows.find((r) => r.id === "c1")?.tenantCount).toBe(2);
    expect(rows.find((r) => r.id === "c2")?.tenantCount).toBe(1);
  });

  it("counts a vehicle with two active licences once", () => {
    // vehicle_licences holds compliance documents, not billing seats. One
    // vehicle legitimately carries an O-licence and an ADR certificate at
    // once. Counting licence rows where you mean vehicles double-bills.
    const rows = buildCompanySummaries(input);
    expect(rows.find((r) => r.id === "c1")?.billableVehicleCount).toBe(1);
  });

  it("counts users per company through their tenant", () => {
    const rows = buildCompanySummaries(input);
    expect(rows.find((r) => r.id === "c1")?.userCount).toBe(1);
  });

  it("carries the billing model and subscription status", () => {
    const rows = buildCompanySummaries(input);
    expect(rows.find((r) => r.id === "c1")?.billingModel).toBe("v1_immediate");
    expect(rows.find((r) => r.id === "c1")?.subscriptionStatus).toBe("active");
  });

  it("leaves the billing model null when the company has no billing row", () => {
    const rows = buildCompanySummaries(input);
    expect(rows.find((r) => r.id === "c2")?.billingModel).toBeNull();
    expect(rows.find((r) => r.id === "c2")?.subscriptionStatus).toBeNull();
  });

  it("attributes a vehicle whose tenant_id is the company id directly", () => {
    // Rows written before tenants existed carry a company id in tenant_id.
    // countBillableVehicles already handles this; the summary must not lose it.
    const rows = buildCompanySummaries({
      ...input,
      vehicles: [{ id: "v9", tenant_id: "c1" }],
      licences: [{ vehicle_id: "v9", active: true }],
    });
    expect(rows.find((r) => r.id === "c1")?.billableVehicleCount).toBe(1);
  });

  it("sorts by company name", () => {
    const rows = buildCompanySummaries({
      ...input,
      companies: [
        { id: "c2", name: "Bravo Logistics" },
        { id: "c1", name: "Acme Haulage" },
      ],
    });
    expect(rows.map((r) => r.name)).toEqual(["Acme Haulage", "Bravo Logistics"]);
  });
});

describe("isMissingRelationError", () => {
  it("recognises a Postgres undefined-table error", () => {
    expect(isMissingRelationError({ code: "42P01" })).toBe(true);
  });

  it("recognises the PostgREST schema-cache miss", () => {
    expect(isMissingRelationError({ code: "PGRST205" })).toBe(true);
  });

  it("does not treat an ordinary error as a missing table", () => {
    expect(isMissingRelationError({ code: "42703", message: "column does not exist" })).toBe(false);
    expect(isMissingRelationError(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/superAdmin/summary.test.ts`
Expected: FAIL, "Failed to resolve import ./summary".

- [ ] **Step 3: Write the implementation**

Create `lib/superAdmin/summary.ts`:

```ts
import { countBillableVehicles, type VehicleRow, type LicenceRow } from "../billing/vehicleCount";

/* Aggregation for the /super-admin dashboard and company list. Pure: the pages
   fetch rows, this turns them into figures. */

export type ChargeRow = {
  company_id: string;
  gross_pence: number | null;
  status: string | null;
  created_at: string | null;
};

/* rows: null means the source could not be read at all, which on this project
   usually means the migration that creates it has not been applied. That is a
   different fact from "no charges", and the tile has to say so. */
export type ChargeSource = {
  key: "v1_cycle" | "v1_addon" | "v2_period";
  label: string;
  rows: ChargeRow[] | null;
};

export type CollectedRevenue = {
  totalPence: number;
  companyCount: number;
  missingSources: string[];
};

const COLLECTED_STATUS = "succeeded";

export function collectedRevenue(
  sources: readonly ChargeSource[],
  now: Date,
  windowDays = 28,
): CollectedRevenue {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  let totalPence = 0;
  const companies = new Set<string>();
  const missingSources: string[] = [];

  for (const source of sources) {
    if (source.rows == null) {
      missingSources.push(source.label);
      continue;
    }

    for (const row of source.rows) {
      /* 'failed', 'pending' and 'refunded' all collected nothing. Only
         'refunded' is subtle: it succeeded and was then given back in full,
         so counting it overstates income by exactly what was returned. */
      if (row.status !== COLLECTED_STATUS) continue;
      if (!row.created_at) continue;

      const at = new Date(row.created_at).getTime();
      if (Number.isNaN(at) || at < cutoff) continue;

      totalPence += row.gross_pence ?? 0;
      companies.add(row.company_id);
    }
  }

  return { totalPence, companyCount: companies.size, missingSources };
}

export type CompanySummary = {
  id: string;
  name: string | null;
  tenantCount: number;
  billableVehicleCount: number;
  userCount: number;
  billingModel: string | null;
  subscriptionStatus: string | null;
};

export type SummaryInput = {
  companies: readonly { id: string; name: string | null }[];
  tenants: readonly { id: string; name?: string | null; company_id: string | null }[];
  vehicles: readonly VehicleRow[];
  licences: readonly LicenceRow[];
  profiles: readonly { id: string; tenant_id: string | null }[];
  billing: readonly { company_id: string; status: string | null; billing_model?: string | null }[];
};

export function buildCompanySummaries(input: SummaryInput): CompanySummary[] {
  const billingByCompany = new Map(input.billing.map((row) => [row.company_id, row]));

  const rows = input.companies.map((company) => {
    const companyTenantIds = input.tenants
      .filter((tenant) => tenant.company_id === company.id)
      .map((tenant) => tenant.id);

    /* A profile belongs to the company when its tenant does, or when its
       tenant_id is the company id directly, the same two-way rule
       countBillableVehicles applies to vehicles. */
    const tenantIdSet = new Set(companyTenantIds);
    const userCount = input.profiles.filter(
      (profile) =>
        profile.tenant_id != null &&
        (tenantIdSet.has(profile.tenant_id) || profile.tenant_id === company.id),
    ).length;

    const billing = billingByCompany.get(company.id) ?? null;

    return {
      id: company.id,
      name: company.name,
      tenantCount: companyTenantIds.length,
      // The single definition of billable. Never count licence rows here: one
      // vehicle legitimately holds several active compliance licences.
      billableVehicleCount: countBillableVehicles({
        companyId: company.id,
        companyTenantIds,
        vehicles: input.vehicles,
        licences: input.licences,
      }),
      userCount,
      billingModel: billing?.billing_model ?? null,
      subscriptionStatus: billing?.status ?? null,
    };
  });

  return rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/* PostgREST reports a table that does not exist as Postgres 42P01, or as
   PGRST205 when the schema cache has never seen it. Both mean "this migration
   is not applied", which the caller must show rather than swallow. */
export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42P01" || code === "PGRST205";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/superAdmin/summary.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/superAdmin/summary.ts lib/superAdmin/summary.test.ts
git commit -m "Add super-admin dashboard and company-list aggregation"
```

---

## Task 3: The company edit allowlist

**Files:**
- Create: `lib/superAdmin/companyEdit.ts`
- Test: `lib/superAdmin/companyEdit.test.ts`

This is the security control of the feature. The route that consumes it holds the service-role key, which bypasses RLS completely, so handing a request body to `.update()` would let any accepted key reach any column. The patch is built from an explicit allowlist and everything else is dropped.

- [ ] **Step 1: Write the failing test**

Create `lib/superAdmin/companyEdit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeCompanyEdit, EDITABLE_PROFILE_FIELDS } from "./companyEdit";

function ok(input: unknown) {
  const result = normalizeCompanyEdit(input);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

describe("normalizeCompanyEdit", () => {
  it("accepts a name and a profile", () => {
    const result = ok({ name: "Acme Haulage", profile: { city: "Leeds" } });
    expect(result.name).toBe("Acme Haulage");
    expect(result.profile.city).toBe("Leeds");
  });

  it("rejects a missing or blank name", () => {
    expect(normalizeCompanyEdit({ profile: {} })).toMatchObject({ ok: false, field: "name" });
    expect(normalizeCompanyEdit({ name: "   ", profile: {} })).toMatchObject({ ok: false, field: "name" });
  });

  it("rejects a non-object body", () => {
    expect(normalizeCompanyEdit(null)).toMatchObject({ ok: false });
    expect(normalizeCompanyEdit("nope")).toMatchObject({ ok: false });
  });

  it("drops keys that are not in the allowlist", () => {
    // The consuming route holds the service-role key, which bypasses RLS
    // entirely. An unfiltered patch would let a crafted body write any column.
    const result = ok({
      name: "Acme",
      profile: { city: "Leeds", id: "evil", tenant_id: "other-company", made_up_column: 1 },
    });
    expect(result.profile).not.toHaveProperty("id");
    expect(result.profile).not.toHaveProperty("tenant_id");
    expect(result.profile).not.toHaveProperty("made_up_column");
    expect(result.profile.city).toBe("Leeds");
  });

  it("keeps company_name in step with the company name", () => {
    // companies.name and company_profiles.company_name are two rows shown to
    // users in different places. One input writes both so they cannot drift.
    const result = ok({ name: "Acme Haulage", profile: { company_name: "Stale Name Ltd" } });
    expect(result.profile.company_name).toBe("Acme Haulage");
  });

  it("trims strings", () => {
    expect(ok({ name: "  Acme  ", profile: { city: "  Leeds  " } }).profile.city).toBe("Leeds");
    expect(ok({ name: "  Acme  ", profile: {} }).name).toBe("Acme");
  });

  it("turns an empty string into null", () => {
    // A cleared field must read as absent, not as "". Otherwise a blank VAT
    // number renders as an empty box that looks filled in.
    expect(ok({ name: "Acme", profile: { vat_number: "" } }).profile.vat_number).toBeNull();
    expect(ok({ name: "Acme", profile: { vat_number: "   " } }).profile.vat_number).toBeNull();
  });

  it("uppercases country and currency codes", () => {
    const result = ok({ name: "Acme", profile: { country_code: "gb", currency_code: "gbp" } });
    expect(result.profile.country_code).toBe("GB");
    expect(result.profile.currency_code).toBe("GBP");
  });

  it("rejects a malformed business email", () => {
    expect(normalizeCompanyEdit({ name: "Acme", profile: { business_email: "not-an-email" } }))
      .toMatchObject({ ok: false, field: "business_email" });
  });

  it("accepts a valid business email and a cleared one", () => {
    expect(ok({ name: "Acme", profile: { business_email: "ops@acme.test" } }).profile.business_email)
      .toBe("ops@acme.test");
    expect(ok({ name: "Acme", profile: { business_email: "" } }).profile.business_email).toBeNull();
  });

  it("rejects a non-string profile value rather than coercing it", () => {
    expect(normalizeCompanyEdit({ name: "Acme", profile: { city: 42 } }))
      .toMatchObject({ ok: false, field: "city" });
  });

  it("accepts an absent profile as an empty patch", () => {
    expect(ok({ name: "Acme" }).profile.company_name).toBe("Acme");
  });

  it("exposes an allowlist that excludes identity columns", () => {
    expect(EDITABLE_PROFILE_FIELDS).not.toContain("id");
    expect(EDITABLE_PROFILE_FIELDS).not.toContain("tenant_id");
    expect(EDITABLE_PROFILE_FIELDS).toContain("city");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/superAdmin/companyEdit.test.ts`
Expected: FAIL, "Failed to resolve import ./companyEdit".

- [ ] **Step 3: Write the implementation**

Create `lib/superAdmin/companyEdit.ts`:

```ts
/* Normalization and validation for a super-admin company edit.

   THE SECURITY CONTROL OF THIS FEATURE. The route that calls this holds the
   service-role key, which bypasses Row Level Security completely. Passing a
   request body straight to .update() would let any key in that body reach any
   column of company_profiles. The patch is therefore rebuilt from the
   allowlist below and every other key is dropped, silently and deliberately.

   Field list mirrors the form at /settings/company. tenant_id is absent on
   purpose: despite the name it holds the COMPANY id (see rls_04), so letting a
   request rewrite it would move a profile to a different company. */

export const EDITABLE_PROFILE_FIELDS = [
  "company_name",
  "trading_name",
  "legal_entity_type",
  "industry_type",
  "registration_number",
  "tax_number",
  "vat_number",
  "eori_number",
  "operator_licence_number",
  "us_ein",
  "usdot_number",
  "mc_number",
  "ifta_number",
  "irp_number",
  "scac_code",
  "business_email",
  "business_phone",
  "website",
  "address_line_1",
  "address_line_2",
  "city",
  "region",
  "postcode",
  "country_code",
  "currency_code",
  "timezone",
  "language_code",
  "notes",
] as const;

export type EditableProfileField = (typeof EDITABLE_PROFILE_FIELDS)[number];

const UPPERCASE_FIELDS = new Set<EditableProfileField>(["country_code", "currency_code"]);

export type CompanyEditResult =
  | { ok: true; name: string; profile: Partial<Record<EditableProfileField, string | null>> }
  | { ok: false; error: string; field?: string };

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normalizeCompanyEdit(input: unknown): CompanyEditResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Expected a JSON object." };
  }

  const body = input as { name?: unknown; profile?: unknown };

  if (typeof body.name !== "string" || body.name.trim() === "") {
    return { ok: false, error: "A company name is required.", field: "name" };
  }
  const name = body.name.trim();

  const rawProfile =
    body.profile && typeof body.profile === "object" && !Array.isArray(body.profile)
      ? (body.profile as Record<string, unknown>)
      : {};

  const profile: Partial<Record<EditableProfileField, string | null>> = {};

  for (const field of EDITABLE_PROFILE_FIELDS) {
    if (!(field in rawProfile)) continue;

    const value = rawProfile[field];

    if (value === null || value === undefined) {
      profile[field] = null;
      continue;
    }

    /* Not coerced with String(). A number or object here means the caller sent
       something the form cannot produce, and quietly stringifying it would
       write "[object Object]" into a customer's address. */
    if (typeof value !== "string") {
      return { ok: false, error: `${field} must be text.`, field };
    }

    const trimmed = value.trim();

    // An empty field is absent, not "". Otherwise a cleared VAT number renders
    // as a filled-looking empty box and sorts as a value rather than a blank.
    if (trimmed === "") {
      profile[field] = null;
      continue;
    }

    if (field === "business_email" && !isEmail(trimmed)) {
      return { ok: false, error: "That business email is not a valid address.", field };
    }

    profile[field] = UPPERCASE_FIELDS.has(field) ? trimmed.toUpperCase() : trimmed;
  }

  /* companies.name and company_profiles.company_name are separate rows, both
     shown to users in different parts of the app. The form offers one input,
     so this writes both from it and they cannot drift apart. */
  profile.company_name = name;

  return { ok: true, name, profile };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/superAdmin/companyEdit.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/superAdmin/companyEdit.ts lib/superAdmin/companyEdit.test.ts
git commit -m "Add the company-edit column allowlist and validation"
```

---

## Task 4: The super-admin guard

**Files:**
- Create: `lib/superAdmin/guard.ts`
- Test: `lib/superAdmin/guard.test.ts`

`requireSuperAdmin()` does I/O, so it is not unit tested. The decision it makes is pure and is tested: signed out is 401, wrong role is 403, right role passes. Splitting them this way means the rule can have a test even though the session lookup cannot.

- [ ] **Step 1: Write the failing test**

Create `lib/superAdmin/guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { superAdminDenial } from "./guard";

describe("superAdminDenial", () => {
  it("denies an anonymous caller with 401", () => {
    // 401, not 403: a fetch() that gets 403 has no reason to send the user to
    // sign in, and proxy.ts already answers 401 for an unauthenticated API
    // call. Matching it keeps one meaning for one status across the app.
    expect(superAdminDenial(null, null)).toEqual({ status: 401, error: "You must be signed in." });
  });

  it("denies a signed-in non-super-admin with 403", () => {
    expect(superAdminDenial("u1", "admin")).toEqual({
      status: 403,
      error: "Super admin access is required.",
    });
    expect(superAdminDenial("u1", "staff")?.status).toBe(403);
    expect(superAdminDenial("u1", null)?.status).toBe(403);
  });

  it("allows a super admin", () => {
    expect(superAdminDenial("u1", "super_admin")).toBeNull();
  });

  it("is not fooled by a role that merely contains the string", () => {
    expect(superAdminDenial("u1", "not_super_admin")?.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/superAdmin/guard.test.ts`
Expected: FAIL, "Failed to resolve import ./guard".

- [ ] **Step 3: Write the implementation**

Create `lib/superAdmin/guard.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "../supabase/server";
import { SUPER_ADMIN_ROLE, extractRoleName } from "../roles";

/* The one super-admin check, shared by app/super-admin/layout.tsx and every
   /api/super-admin route. Two copies of an authorization rule drift; this is
   the reason the layout was refactored to call it rather than inline its own. */

export type Denial = { status: 401 | 403; error: string };

/* Pure, so the rule itself is testable without a session. */
export function superAdminDenial(
  userId: string | null | undefined,
  roleName: string | null,
): Denial | null {
  if (!userId) return { status: 401, error: "You must be signed in." };
  if (roleName !== SUPER_ADMIN_ROLE) {
    return { status: 403, error: "Super admin access is required." };
  }
  return null;
}

export type SuperAdminSession = { userId: string; roleName: string | null };

/* Resolves the caller from cookies and reads their role. Reads go through the
   USER's client, not the service role: RLS lets a user read their own profile,
   so no elevated key is needed to answer "who is this". */
export async function resolveSuperAdmin(): Promise<SuperAdminSession> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { userId: "", roleName: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles ( name )")
    .eq("id", user.id)
    .single();

  return { userId: user.id, roleName: extractRoleName(profile?.roles) };
}

/* Route-handler form. Returns either the caller's id or a ready NextResponse.
   The JSON shape matches proxy.ts's { error } so a fetch() sees one shape. */
export async function requireSuperAdmin(): Promise<
  { userId: string; response?: undefined } | { userId?: undefined; response: NextResponse }
> {
  const session = await resolveSuperAdmin();
  const denial = superAdminDenial(session.userId || null, session.roleName);

  if (denial) {
    return {
      response: NextResponse.json({ error: denial.error }, { status: denial.status }),
    };
  }

  return { userId: session.userId };
}

/* Audit trail, such as it is. Field NAMES only, never values: an edit log that
   records postcodes and phone numbers accumulates customer PII in a place
   nobody is auditing for it. A super_admin_audit table is the follow-up. */
export function logSuperAdminEdit(args: {
  actorId: string;
  action: string;
  targetId: string;
  changedFields: readonly string[];
}) {
  console.log(
    JSON.stringify({
      event: "super_admin_edit",
      action: args.action,
      actor_id: args.actorId,
      target_id: args.targetId,
      changed_fields: args.changedFields,
      at: new Date().toISOString(),
    }),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/superAdmin/guard.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the whole suite and types still pass**

Run: `npm test && npm run typecheck`
Expected: all tests pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add lib/superAdmin/guard.ts lib/superAdmin/guard.test.ts
git commit -m "Add the shared super-admin route guard"
```

---

## Task 5: The search input component

**Files:**
- Create: `components/SearchInput.tsx`

- [ ] **Step 1: Write the component**

No test: this is presentational, and vitest is not configured for JSX or DOM in this repo (`vitest.config.ts` includes `lib/**/*.test.ts` only). The behaviour it wraps is tested in Task 1.

Create `components/SearchInput.tsx`:

```tsx
"use client";

import { Search, X } from "lucide-react";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so this
   relies on the scoped reset in app/globals.css for box-sizing and font
   inheritance, exactly as components/Field.tsx does. The input classes are kept
   in step with Field's on purpose: two differently-styled text inputs in one
   console is the kind of drift nobody notices until a screenshot. */

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown beside the box, e.g. "3 of 24". */
  resultHint?: string;
};

export default function SearchInput({
  id,
  label,
  value,
  onChange,
  placeholder = "Search",
  resultHint,
}: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <label htmlFor={id} className="sr-only">
          {label}
        </label>

        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
        >
          <Search size={16} />
        </span>

        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface pl-9 pr-9 text-base text-ink placeholder:text-ink-3"
        />

        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-3 hover:bg-surface-hover hover:text-ink"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {resultHint ? (
        <span role="status" className="text-xs text-ink-3">
          {resultHint}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/SearchInput.tsx
git commit -m "Add the shared SearchInput component"
```

---

## Task 6: Theme activation for the new dynamic route

**Files:**
- Modify: `lib/nav/themeableRoutes.ts`
- Test: `lib/nav/themeableRoutes.test.ts`

`isThemeableRoute` is exact match by design, so `/super-admin/companies/<uuid>` would be pinned dark while the list page beside it follows the theme. A blanket prefix match would also theme `/driver/jobs/[jobId]`, which is excluded on purpose. So: a separate, explicitly scoped prefix list.

- [ ] **Step 1: Write the failing test**

Add to `lib/nav/themeableRoutes.test.ts`, inside the existing top-level `describe`:

```ts
  it("themes the company detail page under /super-admin/companies/", () => {
    expect(isThemeableRoute("/super-admin/companies/2f7cc0dc-0000-4000-8000-000000000000")).toBe(true);
    expect(isThemeableRoute("/super-admin/companies/anything/deeper")).toBe(true);
  });

  it("does not let the prefix rule leak to other dynamic routes", () => {
    // The reason isThemeableRoute is exact-match in the first place:
    // /driver/dashboard is themed, /driver/jobs/[jobId] deliberately is not.
    expect(isThemeableRoute("/driver/jobs/abc")).toBe(false);
    expect(isThemeableRoute("/pod/share/tok")).toBe(false);
    expect(isThemeableRoute("/super-admin/users/abc")).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/nav/themeableRoutes.test.ts`
Expected: FAIL, the company detail assertion returns false.

- [ ] **Step 3: Write the implementation**

In `lib/nav/themeableRoutes.ts`, add above `isThemeableRoute`:

```ts
/* The ONLY prefix rule, and it stays that way. /super-admin/companies/[id] is
   the first dynamic console route that has to follow the theme: pinned dark, it
   would be the one page in the area that ignores the toggle, sitting one click
   from the list page that obeys it.

   A blanket prefix match was the obvious alternative and is wrong. It would
   theme /driver/jobs/[jobId] along with /driver/dashboard, and that page is
   excluded on purpose: it is driver-facing, outside the console shell, on a
   fixed light palette. Listing the one prefix that needs it keeps exact match
   as the default and keeps the deliberate exclusions deliberate. */
const THEMEABLE_ROUTE_PREFIXES = [
  "/super-admin/companies/", // app/super-admin/companies/[id]/page.tsx
];
```

Then change the body of `isThemeableRoute` so its final line reads:

```ts
  return (
    THEMEABLE_ROUTES.includes(normalized) ||
    THEMEABLE_ROUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
```

Leave the existing comment inside the function intact, and append to it:

```ts
  // Exact match, not prefix, with one narrow exception list above.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/nav/themeableRoutes.test.ts`
Expected: PASS. If the "exact list" assertion in that file fails, it is asserting `THEMEABLE_ROUTES` contents, which this task does not change. Do not add the new route to `THEMEABLE_ROUTES`.

- [ ] **Step 5: Commit**

```bash
git add lib/nav/themeableRoutes.ts lib/nav/themeableRoutes.test.ts
git commit -m "Theme the super-admin company detail route"
```

---

## Task 7: The users route

**Files:**
- Create: `app/api/super-admin/users/route.ts`

Email lives in `auth.users`, which no RLS policy exposes to the client, so this needs the service role. The route returns everything the users page shows, replacing that page's client query entirely.

- [ ] **Step 1: Write the route**

Create `app/api/super-admin/users/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { withSuperAdmin } from "../../../../lib/superAdmin/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Exists for exactly one reason: email lives in auth.users, which no RLS policy
   exposes to the browser, and a user whose full_name is null is otherwise
   identified only by a UUID. Everything else here could have stayed a client
   query; keeping it in one place means the page makes one request, not four. */

type ProfileRow = {
  id: string;
  tenant_id: string | null;
  full_name: string | null;
  created_at: string | null;
  roles: { name: string }[] | { name: string } | null;
};

/* withSuperAdmin, not a manual requireSuperAdmin check. This handler never
   reads the actor id, so with the manual form, deleting the check would still
   typecheck and would hand an anonymous caller the service-role client. The
   wrapper has no code path into the handler that skips the check. */
export const GET = withSuperAdmin(async () => {
  const admin = createAdminClient();

  const [{ data: profiles, error: profilesError }, { data: tenants, error: tenantsError }, { data: companies, error: companiesError }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id, tenant_id, full_name, created_at, roles ( name )")
        .order("created_at", { ascending: false }),
      admin.from("tenants").select("id, name, company_id"),
      admin.from("companies").select("id, name"),
    ]);

  if (profilesError || tenantsError || companiesError) {
    return NextResponse.json(
      { error: profilesError?.message || tenantsError?.message || companiesError?.message },
      { status: 500 },
    );
  }

  /* listUsers is paginated and caps out at 1000 per page, so a single call
     silently truncates once the platform passes that. Paging here keeps the
     list honest rather than quietly dropping the oldest accounts. */
  const emailById = new Map<string, string | null>();
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const user of data.users) emailById.set(user.id, user.email ?? null);
    if (data.users.length < perPage) break;
  }

  const tenantById = new Map((tenants ?? []).map((t) => [t.id as string, t]));
  const companyById = new Map((companies ?? []).map((c) => [c.id as string, c]));

  const rows = ((profiles ?? []) as ProfileRow[]).map((profile) => {
    const tenant = profile.tenant_id ? tenantById.get(profile.tenant_id) : null;

    /* A profile's tenant_id sometimes holds a company id directly, on rows
       written before tenants existed. Falling back that way is what stops
       those users rendering with a blank company. */
    const companyId =
      (tenant?.company_id as string | null | undefined) ??
      (profile.tenant_id && companyById.has(profile.tenant_id) ? profile.tenant_id : null);

    const roleName = Array.isArray(profile.roles)
      ? profile.roles[0]?.name ?? null
      : profile.roles?.name ?? null;

    return {
      id: profile.id,
      email: emailById.get(profile.id) ?? null,
      fullName: profile.full_name,
      role: roleName,
      tenantId: profile.tenant_id,
      tenantName: (tenant?.name as string | null | undefined) ?? null,
      companyId: companyId ?? null,
      companyName: companyId ? (companyById.get(companyId)?.name as string | null) ?? null : null,
      createdAt: profile.created_at,
    };
  });

  return NextResponse.json({ users: rows });
});
```

- [ ] **Step 2: Verify types**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/super-admin/users/route.ts
git commit -m "Add the super-admin users route"
```

---

## Task 8: The company edit route

**Files:**
- Create: `app/api/super-admin/companies/[id]/route.ts`

- [ ] **Step 1: Write the route**

Note the Next 16 signature: `params` is a Promise and must be awaited.

Create `app/api/super-admin/companies/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { withSuperAdmin, logSuperAdminEdit } from "../../../../../lib/superAdmin/guard";
import { normalizeCompanyEdit } from "../../../../../lib/superAdmin/companyEdit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Writes companies.name and the company_profiles row.

   This holds the service-role key because it has to: rls_04 gives companies a
   select policy and no write policy at all, with the comment "service role
   provisions". That is a boundary to respect, not a gap to patch with a new
   client-facing policy.

   Everything that reaches .update() comes from normalizeCompanyEdit, which
   rebuilds the patch from an allowlist. Do not add a field to the update call
   without adding it there. */

export const PATCH = withSuperAdmin(
  async (actorId: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id: companyId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const normalized = normalizeCompanyEdit(body);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error, field: normalized.field }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "No such company." }, { status: 404 });
  }

  const { error: nameError } = await admin
    .from("companies")
    .update({ name: normalized.name })
    .eq("id", companyId);

  if (nameError) {
    return NextResponse.json(
      { error: `Could not update the company name: ${nameError.message}` },
      { status: 500 },
    );
  }

  /* company_profiles.tenant_id holds the COMPANY id despite its name
     (rls_04_identity_tables.sql:27). onConflict names it explicitly so an
     upsert for a company with no profile row inserts rather than erroring. */
  const { error: profileError } = await admin
    .from("company_profiles")
    .upsert({ ...normalized.profile, tenant_id: companyId }, { onConflict: "tenant_id" });

  if (profileError) {
    /* The name write already landed. Say so, rather than reporting a clean
       failure the operator would reasonably retry from stale form state, and
       LOG it: a write that really happened must not go unaudited just because
       the request as a whole failed. */
    logSuperAdminEdit({
      actorId,
      action: "company.update",
      targetId: companyId,
      changedFields: ["name"],
      result: "partial",
    });

    return NextResponse.json(
      {
        error: `The company name was saved, but the profile was not: ${profileError.message}`,
        partial: true,
      },
      { status: 500 },
    );
  }

  logSuperAdminEdit({
    actorId,
    action: "company.update",
    targetId: companyId,
    changedFields: Object.keys(normalized.profile),
    result: "ok",
  });

  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 2: Verify types**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/super-admin/companies/[id]/route.ts
git commit -m "Add the super-admin company edit route"
```

---

## Task 9: The tenant rename and re-parent route

**Files:**
- Create: `app/api/super-admin/tenants/[id]/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/super-admin/tenants/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { withSuperAdmin, logSuperAdminEdit } from "../../../../../lib/superAdmin/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Renames a tenant, or moves it to another company.

   Service role for the same reason as the companies route, and one stronger:
   rls_04 calls tenants "the root of trust for can_access_tenant", so it has no
   write policy at all and must never gain one.

   RE-PARENTING MOVES CUSTOMER DATA. Operational tables are keyed by tenant_id,
   so every job, vehicle, POD and invoice under this tenant changes company with
   it, and its vehicles become billable to the new company. This route reports
   the counts so the UI can put them in front of the operator before they
   confirm. It deliberately does NOT write vehicle_cycle_coverage rows to
   suppress the resulting pro-rata charge: inventing coverage the new company
   never paid for would be a silent write-off. */

export const PATCH = withSuperAdmin(
  async (actorId: string, request: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id: tenantId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected a JSON object." }, { status: 400 });
  }

  const { name, company_id: companyId } = body as { name?: unknown; company_id?: unknown };

  const wantsRename = name !== undefined;
  const wantsMove = companyId !== undefined;

  if (!wantsRename && !wantsMove) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  if (wantsRename && (typeof name !== "string" || name.trim() === "")) {
    return NextResponse.json({ error: "A tenant name is required.", field: "name" }, { status: 400 });
  }

  if (wantsMove && (typeof companyId !== "string" || companyId.trim() === "")) {
    return NextResponse.json(
      { error: "A target company is required.", field: "company_id" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, name, company_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantError) return NextResponse.json({ error: tenantError.message }, { status: 500 });
  if (!tenant) return NextResponse.json({ error: "No such tenant." }, { status: 404 });

  const patch: { name?: string; company_id?: string } = {};
  if (wantsRename) patch.name = (name as string).trim();

  let moved: { vehicles: number; users: number } | null = null;

  if (wantsMove) {
    const target = (companyId as string).trim();

    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id")
      .eq("id", target)
      .maybeSingle();

    if (companyError) return NextResponse.json({ error: companyError.message }, { status: 500 });
    if (!company) {
      return NextResponse.json(
        { error: "No such target company.", field: "company_id" },
        { status: 400 },
      );
    }

    patch.company_id = target;

    // Counted before the write, so the response describes what this call moved.
    const [{ count: vehicleCount }, { count: userCount }] = await Promise.all([
      admin.from("vehicles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    ]);

    moved = { vehicles: vehicleCount ?? 0, users: userCount ?? 0 };
  }

  const { error: updateError } = await admin.from("tenants").update(patch).eq("id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  logSuperAdminEdit({
    actorId,
    action: wantsMove ? "tenant.reparent" : "tenant.rename",
    targetId: tenantId,
    changedFields: Object.keys(patch),
    result: "ok",
  });

  return NextResponse.json({ ok: true, moved });
});
```

- [ ] **Step 2: Verify types**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/super-admin/tenants/[id]/route.ts
git commit -m "Add the super-admin tenant rename and re-parent route"
```

---

## Task 10: The live dashboard

**Files:**
- Modify: `app/super-admin/page.tsx` (replace the file)

The page becomes a client component so it can fetch. Keep the existing link-card grid, add a fifth card for Requests, and delete the "Sample figures" warning along with the hardcoded numbers.

- [ ] **Step 1: Replace the file**

Replace the whole of `app/super-admin/page.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Truck, Users, Banknote, FileText, Inbox, type LucideIcon } from "lucide-react";
import { createClient } from "../../lib/supabase/browser";
import { collectedRevenue, isMissingRelationError, type ChargeSource } from "../../lib/superAdmin/summary";
/* format, not money: formatPence is pure presentation. lib/billing/money.ts is
   v1's graduated weekly pricing and must never be applied to a v2 company, so
   importing from it on a page that sums BOTH models would be a standing
   invitation to reach for computeChargeAmounts next. */
import { formatPence } from "../../lib/billing/format";
import Stat from "../../components/Stat";
import MessageBanner from "../../components/MessageBanner";
import Skeleton from "../../components/Skeleton";

type Totals = {
  companies: number;
  activeSubscriptions: number;
  vehicles: number;
  billableVehicles: number;
  users: number;
  superAdmins: number;
  collectedPence: number;
  payingCompanies: number;
  missingSources: string[];
};

export default function SuperAdminPage() {
  const supabase = createClient();

  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  /* Each charge source is read on its own and allowed to fail on its own.
     Several billing_0* migrations are written but not applied on this project,
     so a table that does not exist yet must reduce the tile to "what I could
     count, and what I could not", never to a confident zero. */
  const loadChargeSource = useCallback(
    async (table: string, key: ChargeSource["key"], label: string): Promise<ChargeSource> => {
      const { data, error } = await supabase
        .from(table)
        .select("company_id, gross_pence, status, created_at");

      if (error) {
        if (isMissingRelationError(error)) return { key, label, rows: null };
        throw error;
      }

      return { key, label, rows: (data ?? []) as ChargeSource["rows"] };
    },
    [supabase],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const [
        companyCount,
        billingRows,
        vehicleRows,
        licenceRows,
        userCount,
        superAdminRows,
        v1Cycle,
        v1Addon,
        v2Period,
      ] = await Promise.all([
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("company_billing").select("company_id, status"),
        // No company_id on vehicles; selecting one fails with 42703.
        supabase.from("vehicles").select("id, tenant_id"),
        supabase.from("vehicle_licences").select("vehicle_id, active"),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id, roles ( name )"),
        loadChargeSource("platform_charges", "v1_cycle", "v1 cycles"),
        loadChargeSource("vehicle_addon_charges", "v1_addon", "v1 mid-cycle additions"),
        loadChargeSource("period_charges", "v2_period", "v2 periods"),
      ]);

      if (companyCount.error) throw companyCount.error;
      if (vehicleRows.error) throw vehicleRows.error;
      if (licenceRows.error) throw licenceRows.error;
      if (userCount.error) throw userCount.error;

      const vehicles = (vehicleRows.data ?? []) as { id: string; tenant_id: string | null }[];
      const licences = (licenceRows.data ?? []) as { vehicle_id: string; active: boolean | null }[];

      /* Platform-wide billable count. Not a per-company sum: the caller wants
         "how many vehicles on the platform are billable", and a vehicle with
         two active compliance licences is still one vehicle. */
      const activeVehicleIds = new Set(
        licences.filter((l) => l.active).map((l) => l.vehicle_id),
      );
      const billableVehicles = vehicles.filter((v) => activeVehicleIds.has(v.id)).length;

      const revenue = collectedRevenue([v1Cycle, v1Addon, v2Period], new Date());

      const superAdmins = ((superAdminRows.data ?? []) as { roles: unknown }[]).filter((row) => {
        const roles = row.roles;
        const name = Array.isArray(roles)
          ? (roles[0] as { name?: string } | undefined)?.name
          : (roles as { name?: string } | null)?.name;
        return name === "super_admin";
      }).length;

      const activeSubscriptions = ((billingRows.data ?? []) as { status: string | null }[]).filter(
        (row) => row.status === "active",
      ).length;

      setTotals({
        companies: companyCount.count ?? 0,
        activeSubscriptions,
        vehicles: vehicles.length,
        billableVehicles,
        users: userCount.count ?? 0,
        superAdmins,
        collectedPence: revenue.totalPence,
        payingCompanies: revenue.companyCount,
        missingSources: revenue.missingSources,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load platform figures.");
      setTotals(null);
    }

    setLoading(false);
  }, [supabase, loadChargeSource]);

  useEffect(() => {
    load();
  }, [load]);

  const tileValue = (value: string) => (loading ? <Skeleton w="5ch" h="1.5rem" /> : value);

  const links: Array<{ title: string; description: string; href: string; icon: LucideIcon }> = [
    { title: "Companies", description: "View and edit customer companies", href: "/super-admin/companies", icon: Building2 },
    { title: "Users", description: "Every user across every tenant", href: "/super-admin/users", icon: Users },
    { title: "Billing", description: "Vehicle based billing configuration", href: "/super-admin/billing", icon: Banknote },
    { title: "Invoices", description: "Generate and track invoices", href: "/super-admin/invoices", icon: FileText },
    { title: "Requests", description: "Triage landing-page leads", href: "/super-admin/requests", icon: Inbox },
  ];

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Platform</div>

          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Super Admin Dashboard
          </h1>

          <p className="m-0 text-sm text-ink-3">
            Platform management, billing and company overview.
          </p>
        </header>

        <MessageBanner tone="danger">{message}</MessageBanner>

        <div className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label="Companies"
            value={tileValue(String(totals?.companies ?? 0))}
            sub={totals ? `${totals.activeSubscriptions} with an active subscription` : undefined}
          />

          <Stat
            label="Vehicles"
            value={tileValue(String(totals?.vehicles ?? 0))}
            sub={totals ? `${totals.billableVehicles} billable` : undefined}
          />

          <Stat
            label="Users"
            value={tileValue(String(totals?.users ?? 0))}
            sub={totals ? `${totals.superAdmins} super admins` : undefined}
          />

          <Stat
            label="Collected (28d)"
            value={tileValue(formatPence(totals?.collectedPence ?? 0))}
            sub={totals ? `across ${totals.payingCompanies} companies` : undefined}
          />
        </div>

        {/* Names what could not be counted. A tile that silently reported zero
            for an unapplied migration would be worse than the hardcoded
            placeholder this dashboard replaced: it would look authoritative. */}
        {totals && totals.missingSources.length > 0 ? (
          <div className="mb-6 text-xs font-medium text-warning-strong">
            Collected (28d) excludes {totals.missingSources.join(" and ")}: not available on this
            database.
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="block rounded-lg border border-line bg-surface p-4 no-underline shadow-sm hover:border-primary-tint-border hover:shadow-md"
            >
              <span className="mb-2 block text-ink-3">
                <card.icon size={28} aria-hidden />
              </span>

              <h2 className="m-0 mb-1 text-md font-semibold text-ink">{card.title}</h2>

              <p className="m-0 text-sm text-ink-3">{card.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types and tests**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add app/super-admin/page.tsx
git commit -m "Put live platform figures on the super-admin dashboard"
```

---

## Task 11: The searchable companies list

**Files:**
- Modify: `app/super-admin/companies/page.tsx` (replace the file)

- [ ] **Step 1: Replace the file**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/browser";
import { buildCompanySummaries, type CompanySummary } from "../../../lib/superAdmin/summary";
import { filterBySearch } from "../../../lib/superAdmin/search";
import DataTable, { type Column, type DataTableState } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import MessageBanner from "../../../components/MessageBanner";
import SearchInput from "../../../components/SearchInput";

function modelBadge(model: string | null) {
  if (model === "v2_period") return <Badge tone="info">v2 period</Badge>;
  if (model === "v1_immediate") return <Badge tone="neutral">v1 immediate</Badge>;
  return <Badge tone="neutral">unknown</Badge>;
}

function statusBadge(status: string | null) {
  if (status === "active") return <Badge tone="success">active</Badge>;
  if (status === "past_due") return <Badge tone="danger">past due</Badge>;
  if (!status) return <span className="text-ink-3">none</span>;
  return <Badge tone="warning">{status}</Badge>;
}

export default function SuperAdminCompaniesPage() {
  const supabase = createClient();
  const router = useRouter();

  const [rows, setRows] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

    const [companies, tenants, vehicles, licences, profiles, billing] = await Promise.all([
      supabase.from("companies").select("id, name"),
      supabase.from("tenants").select("id, name, company_id"),
      // vehicles has no company_id column: selecting one fails with 42703.
      supabase.from("vehicles").select("id, tenant_id"),
      supabase.from("vehicle_licences").select("vehicle_id, active"),
      /* company_id as well as tenant_id: nothing in the repo writes
         profiles.company_id, so a row carrying one was seeded by hand and is
         plausibly the account holder. Selecting only tenant_id undercounts
         those companies by exactly that person. */
      supabase.from("profiles").select("id, tenant_id, company_id"),
      supabase.from("company_billing").select("company_id, status, billing_model"),
    ]);

    const firstError =
      companies.error || tenants.error || vehicles.error || licences.error || profiles.error;

    if (firstError) {
      setMessage(firstError.message);
      setRows([]);
      setLoading(false);
      return;
    }

    /* company_billing carries billing_model only once billing_06 is applied.
       Treat the whole read as optional rather than failing the page: the
       company list is useful without a billing badge, and is the page an
       operator reaches for when something else is already broken. */
    setRows(
      buildCompanySummaries({
        companies: (companies.data ?? []) as { id: string; name: string | null }[],
        tenants: (tenants.data ?? []) as { id: string; name: string | null; company_id: string | null }[],
        vehicles: (vehicles.data ?? []) as { id: string; tenant_id: string | null }[],
        licences: (licences.data ?? []) as { vehicle_id: string; active: boolean | null }[],
        profiles: (profiles.data ?? []) as { id: string; tenant_id: string | null; company_id: string | null }[],
        billing: (billing.data ?? []) as { company_id: string; status: string | null; billing_model: string | null }[],
      }),
    );

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () =>
      filterBySearch(query, rows, (row) => [
        row.name,
        row.id,
        row.billingModel,
        row.subscriptionStatus,
      ]),
    [query, rows],
  );

  const columns: Column<CompanySummary>[] = [
    {
      header: "Company",
      cell: (row) => (
        <div>
          <div className="font-medium text-ink">{row.name || "Unnamed company"}</div>
          <div className="font-mono text-xs text-ink-3">{row.id}</div>
        </div>
      ),
    },
    { header: "Tenants", align: "right", cell: (row) => row.tenantCount },
    { header: "Billable vehicles", align: "right", cell: (row) => row.billableVehicleCount },
    { header: "Users", align: "right", cell: (row) => row.userCount },
    { header: "Model", cell: (row) => modelBadge(row.billingModel) },
    { header: "Subscription", cell: (row) => statusBadge(row.subscriptionStatus) },
  ];

  const state: DataTableState = loading
    ? "loading"
    : message
      ? "error"
      : visible.length === 0
        ? "empty"
        : "ready";

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Platform</div>

          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Companies</h1>

          <p className="m-0 text-sm text-ink-3">
            Every company on the platform. Select one to edit its details.
          </p>
        </header>

        <MessageBanner tone="danger">{message}</MessageBanner>

        <SearchInput
          id="company-search"
          label="Search companies"
          value={query}
          onChange={setQuery}
          placeholder="Search by name, id, status"
          resultHint={!loading && query ? `${visible.length} of ${rows.length}` : undefined}
        />

        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          state={state}
          errorMessage={message}
          onRetry={load}
          onRowClick={(row) => router.push(`/super-admin/companies/${row.id}`)}
          /* Says which query matched nothing. The generic "No companies found"
             on a filtered list reads as "you have no customers". */
          emptyTitle={query ? `Nothing matches "${query}"` : "No companies yet"}
          emptyDescription={
            query ? "Clear the search to see every company." : "Companies appear here once provisioned."
          }
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npm run typecheck`
Expected: clean. If `DataTable` does not export `Column` or `DataTableState` as named types, check `components/DataTable.tsx` and import what it does export.

- [ ] **Step 3: Commit**

```bash
git add app/super-admin/companies/page.tsx
git commit -m "Make the super-admin companies list searchable and informative"
```

---

## Task 12: The company detail page, profile editing

**Files:**
- Create: `app/super-admin/companies/[id]/page.tsx`

This task builds the page and the profile form. Task 13 adds the tenants section to the same file.

- [ ] **Step 1: Create the page**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "../../../../lib/supabase/browser";
import { EDITABLE_PROFILE_FIELDS } from "../../../../lib/superAdmin/companyEdit";
import Field from "../../../../components/Field";
import Textarea from "../../../../components/Textarea";
import Button from "../../../../components/Button";
import MessageBanner from "../../../../components/MessageBanner";
import Skeleton from "../../../../components/Skeleton";

type ProfileState = Partial<Record<(typeof EDITABLE_PROFILE_FIELDS)[number], string>>;

/* Grouped for the form only; the allowlist in companyEdit.ts remains the
   authority on what may be written. A field added here but not there is
   silently dropped by the route, which is the safe direction for that mistake
   to fail in. */
const CORE_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "trading_name", label: "Trading name" },
  { key: "legal_entity_type", label: "Legal entity type" },
  { key: "industry_type", label: "Industry type" },
  { key: "registration_number", label: "Registration number" },
  { key: "vat_number", label: "VAT number" },
  { key: "tax_number", label: "Tax number" },
  { key: "eori_number", label: "EORI number" },
  { key: "operator_licence_number", label: "Operator licence number" },
];

const CONTACT_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "business_email", label: "Business email" },
  { key: "business_phone", label: "Business phone" },
  { key: "website", label: "Website" },
];

const ADDRESS_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "address_line_1", label: "Address line 1" },
  { key: "address_line_2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "region", label: "Region" },
  { key: "postcode", label: "Postcode" },
  { key: "country_code", label: "Country code" },
  { key: "currency_code", label: "Currency code" },
  { key: "timezone", label: "Timezone" },
  { key: "language_code", label: "Language code" },
];

/* This is a UK and EU product. The US fields exist in the schema and are kept
   reachable, but collapsed, the same way /settings/company treats them. */
const US_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "us_ein", label: "US EIN" },
  { key: "usdot_number", label: "USDOT number" },
  { key: "mc_number", label: "MC number" },
  { key: "ifta_number", label: "IFTA number" },
  { key: "irp_number", label: "IRP number" },
  { key: "scac_code", label: "SCAC code" },
];

export default function SuperAdminCompanyDetailPage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const companyId = params.id;

  const [name, setName] = useState("");
  const [profile, setProfile] = useState<ProfileState>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [company, profileRow] = await Promise.all([
      supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
      // tenant_id holds the COMPANY id here, despite the column name (rls_04).
      supabase.from("company_profiles").select("*").eq("tenant_id", companyId).maybeSingle(),
    ]);

    if (company.error) {
      setError(company.error.message);
      setLoading(false);
      return;
    }

    if (!company.data) {
      setError("No such company.");
      setLoading(false);
      return;
    }

    setName((company.data.name as string | null) ?? "");

    const row = (profileRow.data ?? {}) as Record<string, unknown>;
    const next: ProfileState = {};
    for (const key of EDITABLE_PROFILE_FIELDS) {
      const value = row[key];
      // null becomes "", so a cleared field shows as an empty box rather than
      // the string "null". The route turns "" back into null on the way in.
      next[key] = typeof value === "string" ? value : "";
    }
    setProfile(next);

    setLoading(false);
  }, [supabase, companyId]);

  useEffect(() => {
    load();
  }, [load]);

  function setProfileField(key: keyof ProfileState, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    setFieldError(null);

    try {
      const response = await fetch(`/api/super-admin/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, profile }),
      });

      const payload = (await response.json()) as { error?: string; field?: string };

      if (!response.ok) {
        if (payload.field) setFieldError({ field: payload.field, message: payload.error ?? "" });
        setError(payload.error ?? "Could not save this company.");
        setSaving(false);
        return;
      }

      setNotice("Saved.");
      await load();
    } catch {
      setError("Could not reach the server.");
    }

    setSaving(false);
  }

  function renderFields(fields: Array<{ key: keyof ProfileState; label: string }>) {
    return fields.map((field) => (
      <Field
        key={String(field.key)}
        id={`profile-${String(field.key)}`}
        label={field.label}
        value={profile[field.key] ?? ""}
        onChange={(event) => setProfileField(field.key, event.target.value)}
        error={fieldError?.field === field.key ? fieldError.message : undefined}
      />
    ));
  }

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-4">
          <Link href="/super-admin/companies" className="text-sm text-ink-3 no-underline hover:text-ink">
            ← All companies
          </Link>

          <h1 className="mb-1 mt-2 text-xl font-semibold tracking-tight text-ink">
            {loading ? <Skeleton w="18ch" h="1.5rem" /> : name || "Unnamed company"}
          </h1>

          <p className="m-0 font-mono text-xs text-ink-3">{companyId}</p>
        </header>

        <MessageBanner tone="danger">{error}</MessageBanner>
        <MessageBanner tone="success">{notice}</MessageBanner>

        {loading ? (
          <div aria-busy className="grid gap-3">
            <span className="sr-only" role="status">
              Loading company
            </span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                <Skeleton w="20ch" h="1rem" />
              </div>
            ))}
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            className="grid gap-4"
          >
            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Identity</h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id="company-name"
                  label="Company name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  hint="Written to both the company record and the profile, so they cannot drift apart."
                  error={fieldError?.field === "name" ? fieldError.message : undefined}
                  wrapperClassName="sm:col-span-2"
                />

                {renderFields(CORE_FIELDS)}
              </div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Contact</h2>
              <div className="grid gap-3 sm:grid-cols-2">{renderFields(CONTACT_FIELDS)}</div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Address and locale</h2>
              <div className="grid gap-3 sm:grid-cols-2">{renderFields(ADDRESS_FIELDS)}</div>
            </section>

            <details className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <summary className="cursor-pointer text-md font-semibold text-ink">
                US registrations
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{renderFields(US_FIELDS)}</div>
            </details>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Notes</h2>
              <Textarea
                id="profile-notes"
                label="Notes"
                value={profile.notes ?? ""}
                onChange={(event) => setProfileField("notes", event.target.value)}
                rows={4}
              />
            </section>

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving" : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" onClick={load} disabled={saving}>
                Discard changes
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Check the Textarea and Field prop names**

Run: `grep -n "type Props" -A 15 components/Textarea.tsx`
Expected: confirms `id`, `label` and standard textarea props. If `Textarea` does not accept `label`, wrap it the way another page in this repo does and match that.

- [ ] **Step 3: Verify types**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/super-admin/companies/[id]/page.tsx"
git commit -m "Add the super-admin company detail and profile editor"
```

---

## Task 13: Tenant rename and re-parent in the detail page

**Files:**
- Modify: `app/super-admin/companies/[id]/page.tsx`

- [ ] **Step 1: Add the tenant state and loader**

In `app/super-admin/companies/[id]/page.tsx`, add these imports:

```tsx
import Modal from "../../../../components/Modal";
import Select from "../../../../components/Select";
```

Add this type above the component:

```tsx
type TenantRow = { id: string; name: string | null; company_id: string | null };
```

Add this state inside the component, beside the existing state:

```tsx
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [allCompanies, setAllCompanies] = useState<{ id: string; name: string | null }[]>([]);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState<TenantRow | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [moveConfirmText, setMoveConfirmText] = useState("");
  const [moveCounts, setMoveCounts] = useState<{ vehicles: number; users: number } | null>(null);
  const [tenantBusy, setTenantBusy] = useState(false);
```

Inside `load`, add these two reads to the existing `Promise.all` and store their results. Replace the existing `Promise.all` destructuring line with:

```tsx
    const [company, profileRow, tenantRows, companyRows] = await Promise.all([
      supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
      supabase.from("company_profiles").select("*").eq("tenant_id", companyId).maybeSingle(),
      supabase.from("tenants").select("id, name, company_id").eq("company_id", companyId).order("name"),
      supabase.from("companies").select("id, name").order("name"),
    ]);
```

And at the end of `load`, before `setLoading(false)`, add:

```tsx
    const loadedTenants = (tenantRows.data ?? []) as TenantRow[];
    setTenants(loadedTenants);
    setTenantNames(Object.fromEntries(loadedTenants.map((t) => [t.id, t.name ?? ""])));
    setAllCompanies((companyRows.data ?? []) as { id: string; name: string | null }[]);
```

- [ ] **Step 2: Add the tenant actions**

Add these functions inside the component:

```tsx
  async function renameTenant(tenant: TenantRow) {
    setTenantBusy(true);
    setError("");
    setNotice("");

    const response = await fetch(`/api/super-admin/tenants/${tenant.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: tenantNames[tenant.id] ?? "" }),
    });

    const payload = (await response.json()) as { error?: string };

    if (!response.ok) setError(payload.error ?? "Could not rename that tenant.");
    else {
      setNotice("Tenant renamed.");
      await load();
    }

    setTenantBusy(false);
  }

  /* Counts are read before the dialog opens, not after confirming, so the
     operator sees the size of what they are about to move while they can still
     back out. */
  async function openMove(tenant: TenantRow) {
    setMoving(tenant);
    setMoveTarget("");
    setMoveConfirmText("");
    setMoveCounts(null);

    const [vehicles, users] = await Promise.all([
      supabase.from("vehicles").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    ]);

    setMoveCounts({ vehicles: vehicles.count ?? 0, users: users.count ?? 0 });
  }

  async function confirmMove() {
    if (!moving) return;

    setTenantBusy(true);
    setError("");
    setNotice("");

    const response = await fetch(`/api/super-admin/tenants/${moving.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: moveTarget }),
    });

    const payload = (await response.json()) as {
      error?: string;
      moved?: { vehicles: number; users: number } | null;
    };

    if (!response.ok) {
      setError(payload.error ?? "Could not move that tenant.");
    } else {
      setNotice(
        `Tenant moved. ${payload.moved?.vehicles ?? 0} vehicles and ${payload.moved?.users ?? 0} users went with it.`,
      );
      setMoving(null);
      await load();
    }

    setTenantBusy(false);
  }
```

- [ ] **Step 3: Add the tenants section to the form**

Insert this section into the returned JSX, after the Notes section and before the save buttons:

```tsx
            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-1 text-md font-semibold text-ink">Tenants</h2>

              <p className="m-0 mb-3 text-sm text-ink-3">
                Operational data is keyed by tenant. Renaming one is cosmetic; moving one is not.
              </p>

              {tenants.length === 0 ? (
                <p className="m-0 text-sm text-ink-3">This company has no tenants.</p>
              ) : (
                <div className="grid gap-3">
                  {tenants.map((tenant) => (
                    <div
                      key={tenant.id}
                      className="grid gap-2 rounded-md border border-line bg-surface-2 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
                    >
                      <Field
                        id={`tenant-name-${tenant.id}`}
                        label="Tenant name"
                        value={tenantNames[tenant.id] ?? ""}
                        onChange={(event) =>
                          setTenantNames((current) => ({ ...current, [tenant.id]: event.target.value }))
                        }
                        hint={tenant.id}
                      />

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={tenantBusy || (tenantNames[tenant.id] ?? "") === (tenant.name ?? "")}
                        onClick={() => renameTenant(tenant)}
                      >
                        Rename
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={tenantBusy}
                        onClick={() => openMove(tenant)}
                      >
                        Move
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
```

- [ ] **Step 4: Add the confirmation dialog**

Insert this just before the closing `</div>` of the outermost wrapper, outside the form:

```tsx
        <Modal
          open={moving !== null}
          onClose={() => setMoving(null)}
          title="Move this tenant to another company"
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setMoving(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={
                  tenantBusy ||
                  !moveTarget ||
                  moveConfirmText.trim() !== (moving?.name ?? "").trim() ||
                  !moving?.name
                }
                onClick={confirmMove}
              >
                Move tenant
              </Button>
            </>
          }
        >
          <p className="mt-0">
            <strong className="text-ink">{moving?.name || moving?.id}</strong> and everything under it
            will belong to the target company.
          </p>

          <p>
            {moveCounts
              ? `${moveCounts.vehicles} vehicles and ${moveCounts.users} users move with it.`
              : "Counting what would move..."}
          </p>

          {/* Stated because it is money. Coverage rows are keyed by company, so
              the arriving vehicles have none at the destination and the next
              billing run charges the new company pro-rata for them. Writing
              coverage rows here to suppress that would be an invisible
              write-off of revenue nobody agreed to. */}
          <p className="text-warning-strong">
            Under v1 billing the destination company will be charged pro-rata for these vehicles at
            the next billing run, because their paid-coverage records stay with the old company.
          </p>

          <Select
            id="move-target"
            label="Target company"
            value={moveTarget}
            onChange={(event) => setMoveTarget(event.target.value)}
          >
            <option value="">Select a company</option>
            {allCompanies
              .filter((company) => company.id !== companyId)
              .map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name || company.id}
                </option>
              ))}
          </Select>

          <div className="mt-3">
            <Field
              id="move-confirm"
              label={`Type "${moving?.name ?? ""}" to confirm`}
              value={moveConfirmText}
              onChange={(event) => setMoveConfirmText(event.target.value)}
            />
          </div>
        </Modal>
```

- [ ] **Step 5: Check the Select prop names**

Run: `grep -n "type Props" -A 15 components/Select.tsx`
Expected: confirms `id`, `label`, and that children `<option>` elements are supported. Adapt the call above to whatever it actually takes.

- [ ] **Step 6: Verify types**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add "app/super-admin/companies/[id]/page.tsx"
git commit -m "Add tenant rename and guarded re-parent to the company detail page"
```

---

## Task 14: The users page

**Files:**
- Modify: `app/super-admin/users/page.tsx` (replace the file)

- [ ] **Step 1: Replace the file**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { filterBySearch } from "../../../lib/superAdmin/search";
import DataTable, { type Column, type DataTableState } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import MessageBanner from "../../../components/MessageBanner";
import SearchInput from "../../../components/SearchInput";

type UserRow = {
  id: string;
  email: string | null;
  fullName: string | null;
  role: string | null;
  tenantId: string | null;
  tenantName: string | null;
  companyId: string | null;
  companyName: string | null;
  createdAt: string | null;
};

export default function SuperAdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");

  /* Server route rather than a client query: email lives in auth.users, which
     no RLS policy exposes to the browser, and without it a user whose
     full_name is null is identified on screen only by a UUID. */
  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/super-admin/users");
      const payload = (await response.json()) as { users?: UserRow[]; error?: string };

      if (!response.ok) {
        setMessage(payload.error ?? "Unable to load users.");
        setUsers([]);
      } else {
        setUsers(payload.users ?? []);
      }
    } catch {
      setMessage("Could not reach the server.");
      setUsers([]);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () =>
      filterBySearch(query, users, (row) => [
        row.fullName,
        row.email,
        row.role,
        row.companyName,
        row.tenantName,
        row.id,
      ]),
    [query, users],
  );

  const columns: Column<UserRow>[] = [
    {
      header: "User",
      cell: (row) => (
        <div>
          <div className="font-medium text-ink">{row.fullName || row.email || "Unnamed user"}</div>
          <div className="text-xs text-ink-3">{row.email || "No email on file"}</div>
        </div>
      ),
    },
    {
      header: "Role",
      cell: (row) =>
        row.role === "super_admin" ? (
          <Badge tone="info">super admin</Badge>
        ) : (
          <span className="text-ink-2">{row.role || "none"}</span>
        ),
    },
    { header: "Company", cell: (row) => row.companyName || <span className="text-ink-3">none</span> },
    { header: "Tenant", cell: (row) => row.tenantName || <span className="text-ink-3">none</span> },
    {
      header: "User ID",
      cell: (row) => <span className="font-mono text-xs text-ink-3">{row.id}</span>,
    },
  ];

  const state: DataTableState = loading
    ? "loading"
    : message
      ? "error"
      : visible.length === 0
        ? "empty"
        : "ready";

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Platform</div>

          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">All Users</h1>

          <p className="m-0 text-sm text-ink-3">Every user profile across every tenant.</p>
        </header>

        <MessageBanner tone="danger">{message}</MessageBanner>

        <SearchInput
          id="user-search"
          label="Search users"
          value={query}
          onChange={setQuery}
          placeholder="Search by name, email, company, role"
          resultHint={!loading && query ? `${visible.length} of ${users.length}` : undefined}
        />

        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          state={state}
          errorMessage={message}
          onRetry={load}
          emptyTitle={query ? `Nothing matches "${query}"` : "No users yet"}
          emptyDescription={query ? "Clear the search to see every user." : undefined}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/super-admin/users/page.tsx
git commit -m "Back the super-admin users page with real identity data and search"
```

---

## Task 15: Search on invoices and requests

**Files:**
- Modify: `app/super-admin/invoices/page.tsx`
- Modify: `app/super-admin/requests/page.tsx`
- Create: `app/super-admin/requests/RequestsTable.tsx`

The two pages are not the same shape, and treating them as if they were will break one of them.

`invoices/page.tsx` is a client component and takes the straightforward change. **`requests/page.tsx` is a server component** (`"use client"` is absent, it imports `lib/supabase/server`, and the default export is `async`). `useState` cannot go in it. It also contains a cross-check worth protecting: when RLS filters every row, PostgREST returns 200 with an empty array, so the page re-counts with the service role to tell "no leads" apart from "a broken read policy". That logic stays exactly where it is; only the table moves into a client child.

Do not convert either page to `DataTable` in this task. That is scope this plan does not cover.

- [ ] **Step 1: Add search to the invoices page**

In `app/super-admin/invoices/page.tsx`:

Add imports:

```tsx
import { useMemo } from "react";
import { filterBySearch } from "../../../lib/superAdmin/search";
import SearchInput from "../../../components/SearchInput";
```

(Merge `useMemo` into the existing `react` import rather than adding a second one.)

Add state beside the existing `useState` calls:

```tsx
  const [query, setQuery] = useState("");
```

Add the filtered list after the state declarations. The four fields below all exist on that file's `Invoice` type (`id`, `company_id`, `vehicle_count`, `amount`, `status`):

```tsx
  const visibleInvoices = useMemo(
    () =>
      filterBySearch(query, invoices, (invoice) => [
        invoice.id,
        invoice.company_id,
        invoice.status,
        invoice.amount != null ? String(invoice.amount) : null,
      ]),
    [query, invoices],
  );
```

Render the search box immediately after the `MessageBanner`, and change the render loop from `invoices.map(` to `visibleInvoices.map(`:

```tsx
        <SearchInput
          id="invoice-search"
          label="Search invoices"
          value={query}
          onChange={setQuery}
          placeholder="Search by id, company, status"
          resultHint={query ? `${visibleInvoices.length} of ${invoices.length}` : undefined}
        />
```

Also update the empty-state condition in that file so it checks `visibleInvoices.length === 0` rather than `invoices.length === 0`, and when `query` is set have it read `No invoices match "{query}".`

- [ ] **Step 2: Extract the requests table into a client component**

Create `app/super-admin/requests/RequestsTable.tsx`. Move the `<table>` markup and the `statusTone` helper out of `page.tsx` verbatim, wrap them in a client component, and add the search box:

```tsx
"use client";

import { useMemo, useState } from "react";
import Badge from "../../../components/Badge";
import SearchInput from "../../../components/SearchInput";
import { filterBySearch } from "../../../lib/superAdmin/search";

/* Client child of the server page next door. The page stays a server component
   because it does a service-role cross-check of the row count that must not
   move to the browser; only the rendering of rows it already fetched lives
   here, so search can be client state. */

export type RegistrationRequest = {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  vehicle_count: number | null;
  notes: string | null;
  status: string | null;
  created_at: string;
};

function statusTone(status: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
    case "accepted":
    case "complete":
    case "completed":
      return "success" as const;
    case "rejected":
    case "declined":
      return "danger" as const;
    case "contacted":
    case "in_progress":
      return "info" as const;
    case "new":
    case "pending":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

export default function RequestsTable({ requests }: { requests: RegistrationRequest[] }) {
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () =>
      filterBySearch(query, requests, (request) => [
        request.company_name,
        request.contact_name,
        request.email,
        request.phone,
        request.status,
      ]),
    [query, requests],
  );

  return (
    <>
      <div className="mt-6">
        <SearchInput
          id="request-search"
          label="Search requests"
          value={query}
          onChange={setQuery}
          placeholder="Search by company, contact, email, status"
          resultHint={query ? `${visible.length} of ${requests.length}` : undefined}
        />
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
          No requests match &quot;{query}&quot;.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2 text-overline uppercase text-ink-3">
                <th className="px-4 py-2 text-left font-semibold">Received</th>
                <th className="px-4 py-2 text-left font-semibold">Company</th>
                <th className="px-4 py-2 text-left font-semibold">Contact</th>
                <th className="px-4 py-2 text-right font-semibold">Vehicles</th>
                <th className="px-4 py-2 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-3">
                    {new Date(r.created_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{r.company_name ?? "-"}</div>
                    {r.notes ? (
                      <div className="mt-1 max-w-md text-xs text-ink-3">{r.notes}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-ink">{r.contact_name ?? "-"}</div>
                    {r.email ? (
                      <a
                        href={`mailto:${r.email}`}
                        className="text-xs text-primary hover:text-primary-hover"
                      >
                        {r.email}
                      </a>
                    ) : null}
                    {r.phone ? <div className="text-xs text-ink-3">{r.phone}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                    {r.vehicle_count ?? "-"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(r.status)}>{r.status ?? "unknown"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Point the requests page at the new component**

In `app/super-admin/requests/page.tsx`:

1. Add `import RequestsTable, { type RegistrationRequest } from "./RequestsTable";`
2. Delete the local `RegistrationRequest` type and the local `statusTone` function, which now live in `RequestsTable.tsx`.
3. Remove the now-unused `Badge` import. Leave the `createClient` and `createAdminClient` imports alone.
4. Replace the final `) : (` branch, the one containing the whole `<div className="mt-6 overflow-x-auto ...">` table block, with:

```tsx
        ) : (
          <RequestsTable requests={requests} />
        )}
```

Leave the `error` branch and the `hiddenByPolicy` branch exactly as they are. They are the RLS cross-check and they must keep firing before the table renders.

- [ ] **Step 4: Verify types**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/super-admin/invoices/page.tsx app/super-admin/requests/page.tsx app/super-admin/requests/RequestsTable.tsx
git commit -m "Add search to the super-admin invoices and requests lists"
```

---

## Task 16: The layout onto the design system

**Files:**
- Modify: `app/super-admin/layout.tsx` (replace the file)

The last inline-styled surface in the area: it hardcodes `background: "#1e1b4b"`, white link text and a `CSSProperties` object, while every page beneath it is tokenised. The role check also moves to the shared guard so it cannot drift from the API routes.

- [ ] **Step 1: Replace the file**

```tsx
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Zap } from "lucide-react";
import { resolveSuperAdmin, superAdminDenial } from "../../lib/superAdmin/guard";

const NAV_LINKS = [
  { href: "/super-admin", label: "Overview" },
  { href: "/super-admin/companies", label: "Companies" },
  { href: "/super-admin/requests", label: "Requests" },
  { href: "/super-admin/users", label: "Users" },
  { href: "/super-admin/billing", label: "Billing" },
  { href: "/super-admin/invoices", label: "Invoices" },
];

export default async function SuperAdminLayout({ children }: { children: ReactNode }) {
  /* Same helper the /api/super-admin routes use. Two hand-written copies of an
     authorization rule drift, and the copy that drifts is always the one
     nobody is looking at. */
  const session = await resolveSuperAdmin();
  const denial = superAdminDenial(session.userId || null, session.roleName);

  if (denial?.status === 401) {
    // /login, not /. The landing page no longer carries a sign-in form, so
    // sending a logged-out user there strands them with no way back in.
    redirect("/login");
  }

  if (denial) redirect("/dashboard");

  return (
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <header className="border-b border-line bg-surface px-4 py-3 md:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2">
          <strong className="inline-flex items-center gap-1.5 text-md font-semibold text-ink">
            <Zap size={16} aria-hidden /> Super Admin
          </strong>

          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-ink-2 no-underline hover:text-ink"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/dashboard"
            className="ml-auto text-sm font-medium text-ink-3 no-underline hover:text-ink"
          >
            ← Back to app
          </Link>
        </div>
      </header>

      <div>{children}</div>
    </div>
  );
}
```

Note: the active-link highlight is deliberately not implemented here. `usePathname` is a client hook and this is a server component, and splitting the nav into a client component to underline one link is not worth a new component boundary. The pages each carry their own `<h1>`, which is what tells the operator where they are.

- [ ] **Step 2: Verify types and the full suite**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add app/super-admin/layout.tsx
git commit -m "Move the super-admin layout onto the design system"
```

---

## Task 17: Documentation and the final gate

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the page inventory**

In `README.md`, update these lines in the Page Inventory (around lines 107 to 112). Replace the existing entries with:

```markdown
- **`/super-admin`** [OK]: live platform figures (companies, vehicles, users, and collected revenue over the trailing 28 days across both billing models). A tile names any charge table it could not read rather than reporting zero.
- **`/super-admin/companies`** [OK]: searchable list of customer companies with tenant, billable-vehicle and user counts, billing model and subscription status; links to a per-company detail page.
- **`/super-admin/companies/[id]`** [OK]: edit a company's profile, rename its tenants, and move a tenant to another company behind a typed confirmation. Writes go through `/api/super-admin/*` on the service role, because `companies` and `tenants` have no RLS write policy by design.
- **`/super-admin/users`** [OK]: searchable list of every platform user with email, resolved company and tenant names, and role. Read-only.
```

- [ ] **Step 2: Update the roadmap**

In `README.md`, in the roadmap section, amend the "Analytics dashboards" bullet so it no longer claims `/super-admin` needs making data-driven, and amend "Admin management" so it reflects that the companies page now manages companies while the users page is still read-only:

```markdown
- **Analytics dashboards:** make `/dashboard` data-driven; add cross-tenant "which tenant is performing best" views on top of the admin tenant selector; charts and SQL-view aggregation at scale.
- **Admin management:** super-admin user management (the users page is read-only), a `super_admin_audit` table to replace the current log-only trail of company and tenant edits, and finish the per-page permissions model (revoke path, controlled state).
```

- [ ] **Step 3: Run the full gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: all three clean. `npm run build` is worth running once at the end because it catches App Router issues, such as a client hook used in a server component, that `tsc` alone does not.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Update the page inventory for the super-admin work"
```

---

## What this plan does not do

Say so out loud when handing back, so nobody assumes otherwise:

- **The changes are unverified against a signed-in browser session.** Every page here is behind an auth gate and a super_admin role check, so typecheck, vitest and build are the only automated evidence available. `node scripts/dev-login.mjs` mints a magic link for local sign-in, but `.env.local` points at the LIVE Supabase project, so anything saved while testing writes production data.
- **No audit table.** Company and tenant edits are logged to the server console with field names only. A `super_admin_audit` table is a follow-up.
- **Billing model and subscription status are not editable.** Switching a company between v1 and v2 stays with `scripts/migrate-company-to-period-billing.mjs`.
- **Tenant create and delete are not built.**
- **The `/settings/company` profile lookup bug is untouched.** It passes `selectedTenantId` where a company id is expected. Real, on a page this feature does not otherwise modify.
- **`app/tachograph/page.tsx:222-230` reads `company_profiles.timezone` without validating it.** It feeds the value straight to `Intl.DateTimeFormat`, which throws `RangeError` during render on a bad IANA name, white-screening the page. `app/planning/page.tsx:365` guards the same column with `isValidIanaTimeZone` (`lib/time.ts:8`) and falls back; tachograph does not. This plan blocks a bad value at the write path (Task 3), which closes the super-admin route into it, but a company admin can still do it to themselves through `/settings/company`, which offers timezone as free text. The read-side guard is the real fix.
- **Non-Latin-1 characters in a company profile break invoice PDF generation.** `lib/invoices/generatePdf.ts:451-457` embeds `StandardFonts.Helvetica`, which is WinAnsi-encoded, and pdf-lib throws on any character it cannot encode. An emoji or CJK character in `city` or `company_name` makes every invoice PDF for that company throw. Pre-existing and reachable today through `/settings/company`; the fix belongs at the font layer, not in a field validator.
- **Two other pages still carry the naive search this plan's module exists to fix.** `app/drivers/page.tsx:1046` and `app/pod/page.tsx:981` both test the whole lowercased query against each field with `.some((value) => String(value).toLowerCase().includes(query))`, so on the drivers page "smith dvla" finds nothing even when a driver named Smith has a DVLA note. Verified, not fixed: those pages are outside this feature. Migrating them is an import change plus a re-test, and `lib/superAdmin/search.ts` can move to `lib/search.ts` at that point if a second area starts using it.
