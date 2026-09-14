import { describe, expect, it } from "vitest";
import { companyIdFromTenantRow, companyLookupTenantId } from "./companyScope";

const tenants = [{ id: "t1" }, { id: "t2" }];

describe("companyLookupTenantId", () => {
  it("uses the selected tenant", () => {
    expect(companyLookupTenantId({ role: "admin", activeTenantId: "t2", writeTenantId: "t2", tenants })).toBe("t2");
    expect(companyLookupTenantId({ role: "staff", activeTenantId: null, writeTenantId: "t1", tenants })).toBe("t1");
  });

  it("lets a company admin on All tenants resolve through any of their tenants", () => {
    expect(companyLookupTenantId({ role: "admin", activeTenantId: null, writeTenantId: null, tenants })).toBe("t1");
  });

  it("makes a super admin on All tenants pick a tenant, since that view spans companies", () => {
    expect(companyLookupTenantId({ role: "super_admin", activeTenantId: null, writeTenantId: null, tenants })).toBeNull();
  });

  it("answers null when there is nothing to resolve from", () => {
    expect(companyLookupTenantId({ role: "admin", activeTenantId: null, writeTenantId: null, tenants: [] })).toBeNull();
  });
});

describe("companyIdFromTenantRow", () => {
  it("reads company_id and treats missing or blank values as null", () => {
    expect(companyIdFromTenantRow({ company_id: "c1" })).toBe("c1");
    expect(companyIdFromTenantRow({ company_id: null })).toBeNull();
    expect(companyIdFromTenantRow({ company_id: "" })).toBeNull();
    expect(companyIdFromTenantRow(null)).toBeNull();
  });
});
