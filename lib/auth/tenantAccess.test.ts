import { describe, expect, it } from "vitest";
import {
  canAccessTenant,
  canManageTenant,
  decideTenantAccess,
  hasValidHome,
  requestTenantId,
  roleTier,
  type CallerProfile,
  type TenantRef,
} from "./tenantAccess";

describe("requestTenantId", () => {
  const home = (roleName: string | null) => ({ userId: "u1", roleName, companyId: "company-a", homeTenantId: "tenant-a1" });

  it("uses the tenant the request names, for every role", () => {
    expect(requestTenantId("tenant-a2", home("admin"))).toEqual({ ok: true, tenantId: "tenant-a2" });
    expect(requestTenantId("tenant-a1", home("staff"))).toEqual({ ok: true, tenantId: "tenant-a1" });
  });

  it("falls back to the home tenant for staff, who are pinned to it", () => {
    expect(requestTenantId(null, home("staff"))).toEqual({ ok: true, tenantId: "tenant-a1" });
    expect(requestTenantId(null, home(null))).toEqual({ ok: true, tenantId: "tenant-a1" });
  });

  it("refuses an admin or super admin who named no tenant instead of assuming their home one", () => {
    // Under "All tenants" the page sends no header; silently using the home
    // tenant showed and created customers there while the selector said All.
    expect(requestTenantId(null, home("admin"))).toEqual({ ok: false, reason: "tenant-required" });
    expect(requestTenantId(null, home("super_admin"))).toEqual({ ok: false, reason: "tenant-required" });
  });

  it("reports a staff caller with no home tenant", () => {
    expect(requestTenantId(null, { ...home("staff"), homeTenantId: null })).toEqual({ ok: false, reason: "no-home-tenant" });
  });
});

const COMPANY_A = "company-a";
const COMPANY_B = "company-b";
const A1: TenantRef = { id: "tenant-a1", companyId: COMPANY_A };
const A2: TenantRef = { id: "tenant-a2", companyId: COMPANY_A };
const B1: TenantRef = { id: "tenant-b1", companyId: COMPANY_B };

function caller(roleName: string | null, homeTenantId: string | null = A1.id, companyId: string | null = COMPANY_A): CallerProfile {
  return { userId: "u1", roleName, companyId, homeTenantId };
}

describe("roleTier", () => {
  it("elevates only exact role names, like get_tenant_context", () => {
    expect(roleTier("super_admin")).toBe("super_admin");
    expect(roleTier("admin")).toBe("admin");
    expect(roleTier("Admin")).toBe("staff");
    expect(roleTier(" admin")).toBe("staff");
    expect(roleTier("driver")).toBe("staff");
    expect(roleTier(null)).toBe("staff");
  });
});

describe("canAccessTenant", () => {
  it("lets staff reach only their home tenant", () => {
    expect(canAccessTenant(caller("staff"), A1)).toBe(true);
    expect(canAccessTenant(caller("staff"), A2)).toBe(false);
    expect(canAccessTenant(caller("staff"), B1)).toBe(false);
  });

  it("lets admins reach every tenant in their company and nothing else", () => {
    expect(canAccessTenant(caller("admin"), A2)).toBe(true);
    expect(canAccessTenant(caller("admin"), B1)).toBe(false);
  });

  it("does not match two null company ids", () => {
    expect(canAccessTenant(caller("admin", "x", null), { id: "t", companyId: null })).toBe(false);
  });

  it("lets super_admin reach anything", () => {
    expect(canAccessTenant(caller("super_admin", null, null), B1)).toBe(true);
  });
});

describe("canManageTenant", () => {
  it("has no own-tenant branch for staff", () => {
    expect(canManageTenant(caller("staff"), A1)).toBe(false);
  });

  it("allows admins within their company only", () => {
    expect(canManageTenant(caller("admin"), A1)).toBe(true);
    expect(canManageTenant(caller("admin"), B1)).toBe(false);
  });
});

describe("hasValidHome", () => {
  it("fails closed when the home tenant moved to another company", () => {
    expect(hasValidHome(caller("admin"), { id: A1.id, companyId: COMPANY_B })).toBe(false);
  });

  it("fails closed when there is no home tenant", () => {
    expect(hasValidHome(caller("staff", null), null)).toBe(false);
  });

  it("does not require a home tenant for super_admin", () => {
    expect(hasValidHome(caller("super_admin", null, null), null)).toBe(true);
  });
});

describe("decideTenantAccess", () => {
  it("returns no-tenant before anything else for a half-provisioned profile", () => {
    expect(
      decideTenantAccess({ caller: caller("admin", A1.id, null), homeTenant: A1, target: A1, level: "access" }),
    ).toEqual({ ok: false, reason: "no-tenant" });
  });

  it("narrows with allowedRoles but never widens past RLS", () => {
    expect(
      decideTenantAccess({ caller: caller("staff"), homeTenant: A1, target: A1, level: "access", allowedRoles: ["admin", "super_admin"] }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      decideTenantAccess({ caller: caller("admin"), homeTenant: A1, target: B1, level: "access", allowedRoles: ["admin"] }),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      decideTenantAccess({ caller: caller("admin"), homeTenant: A1, target: A2, level: "manage", allowedRoles: ["admin"] }),
    ).toEqual({ ok: true, tier: "admin" });
  });

  it("accepts an exact non-tier role name in allowedRoles", () => {
    expect(
      decideTenantAccess({ caller: caller("planner"), homeTenant: A1, target: A1, level: "access", allowedRoles: ["planner"] }),
    ).toEqual({ ok: true, tier: "staff" });
  });
});
