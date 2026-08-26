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
