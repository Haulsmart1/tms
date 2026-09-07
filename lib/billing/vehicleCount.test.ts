import { describe, expect, it } from "vitest";
import { billableVehicleIds, countBillableVehicles } from "./vehicleCount";

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

  it("matches a vehicle whose tenant_id is the company id itself", () => {
    const count = countBillableVehicles({
      companyId: COMPANY,
      companyTenantIds: [],
      vehicles: [{ id: "v1", tenant_id: COMPANY }],
      licences: [{ vehicle_id: "v1", active: true }],
    });
    expect(count).toBe(1);
  });

  it("ignores a vehicle with no tenant_id", () => {
    const count = countBillableVehicles({
      companyId: COMPANY,
      companyTenantIds: [TENANT_A],
      vehicles: [{ id: "v1", tenant_id: null }],
      licences: [{ vehicle_id: "v1", active: true }],
    });
    expect(count).toBe(0);
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
