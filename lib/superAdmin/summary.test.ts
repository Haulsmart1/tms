import { describe, it, expect } from "vitest";
import {
  collectedRevenue,
  buildCompanySummaries,
  platformBillableVehicleCount,
  isMissingRelationError,
  isMissingColumnError,
  type ChargeSource,
} from "./summary";

const NOW = new Date("2026-09-11T12:00:00Z");

function charge(over: Partial<{ company_id: string; gross_pence: number | string | null; status: string | null; created_at: string | null }> = {}) {
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

  it("coerces a bigint gross_pence that arrives as a string", () => {
    // gross_pence is a Postgres bigint. If it ever arrives as a string,
    // 0 + "10000" is the string "010000" and every later += appends instead
    // of summing, so this must be coerced with Number(...) rather than added
    // directly.
    const sources: ChargeSource[] = [
      { key: "v1_cycle", label: "v1 cycles", rows: [charge({ gross_pence: "10000" })] },
    ];
    expect(collectedRevenue(sources, NOW).totalPence).toBe(10_000);
  });

  it("does not count a zero-pence settled-to-nothing row as a paying company", () => {
    // A v2 balance that settles to nothing owed still inserts a
    // status = 'succeeded', gross_pence = 0 row (lib/billing/periodPaymentServer.ts).
    // That is a normal outcome, not a payment, so it must not make the tile
    // read "collected across N companies" when one of the N paid nothing.
    const sources: ChargeSource[] = [
      { key: "v2_period", label: "v2 periods", rows: [charge({ gross_pence: 0 })] },
    ];
    const result = collectedRevenue(sources, NOW);
    expect(result.totalPence).toBe(0);
    expect(result.companyCount).toBe(0);
  });

  it("includes a charge dated exactly at the window boundary", () => {
    const sources: ChargeSource[] = [
      { key: "v1_cycle", label: "v1 cycles", rows: [charge({ created_at: "2026-08-14T12:00:00Z" })] },
    ];
    expect(collectedRevenue(sources, NOW).totalPence).toBe(10_000);
  });

  it("treats a readable but empty source as present, not missing", () => {
    // rows: [] is "no charges". Only rows: null is "could not read the table".
    const sources: ChargeSource[] = [
      { key: "v2_period", label: "v2 periods", rows: [] },
    ];
    const result = collectedRevenue(sources, NOW);
    expect(result.totalPence).toBe(0);
    expect(result.missingSources).toEqual([]);
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

  it("attributes a profile through company_id when its tenant_id is null", () => {
    // Nothing in the repo writes profiles.company_id today (only read, at
    // app/api/settings/users/invite/route.ts); any row carrying it was
    // seeded by hand, plausibly the account holder, and must still count.
    const rows = buildCompanySummaries({
      ...input,
      profiles: [...input.profiles, { id: "u3", tenant_id: null, company_id: "c1" }],
    });
    expect(rows.find((r) => r.id === "c1")?.userCount).toBe(2);
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

describe("platformBillableVehicleCount", () => {
  it("counts a vehicle with two active licences once", () => {
    const vehicles = [{ id: "v1", tenant_id: "t1" }];
    const licences = [
      { vehicle_id: "v1", active: true },
      { vehicle_id: "v1", active: true },
    ];
    expect(platformBillableVehicleCount(vehicles, licences)).toBe(1);
  });

  it("excludes a vehicle with no active licence", () => {
    const vehicles = [{ id: "v1", tenant_id: "t1" }];
    const licences = [{ vehicle_id: "v1", active: false }];
    expect(platformBillableVehicleCount(vehicles, licences)).toBe(0);
  });

  it("excludes a vehicle with a null tenant_id even with an active licence", () => {
    // Same rule as countBillableVehicles in ../billing/vehicleCount.ts: a
    // vehicle with no tenant_id cannot be attributed to any company, so it
    // must not inflate the platform headline past the sum of every
    // per-company billable count on /super-admin/billing.
    const vehicles = [{ id: "v1", tenant_id: null }];
    const licences = [{ vehicle_id: "v1", active: true }];
    expect(platformBillableVehicleCount(vehicles, licences)).toBe(0);
  });

  it("counts a vehicle whose tenant_id is a company id directly", () => {
    const vehicles = [{ id: "v1", tenant_id: "c1" }];
    const licences = [{ vehicle_id: "v1", active: true }];
    expect(platformBillableVehicleCount(vehicles, licences)).toBe(1);
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

describe("isMissingColumnError", () => {
  it("recognises a Postgres undefined-column error", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
  });

  it("recognises the PostgREST schema-cache miss for a column", () => {
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
  });

  it("does not treat a missing-table error as a missing column", () => {
    // The two failure modes are easy to conflate and mean different things:
    // a whole table absent (42P01 / PGRST205, isMissingRelationError above)
    // is a different migration gap from one column absent on a table that
    // does exist (42703 / PGRST204). Confusing them would let a genuine
    // missing-table error get treated as the narrower, more forgivable case.
    expect(isMissingColumnError({ code: "42P01" })).toBe(false);
    expect(isMissingColumnError({ code: "PGRST205" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});
