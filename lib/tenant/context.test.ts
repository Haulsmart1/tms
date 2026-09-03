import { describe, it, expect } from "vitest";
import {
  parseTenantContext,
  pickInitialActiveTenant,
  computeWriteTenantId,
  tenantStorageKey,
  type ReadyTenantContext,
  type UnresolvedTenantContext,
} from "./context";

const T = (id: string, name: string) => ({ id, name });

describe("parseTenantContext", () => {
  it("normalizes a ready admin context", () => {
    const d = parseTenantContext({
      status: "ready", role: "admin", company_id: "c1",
      home_tenant_id: "t1", tenants: [T("t1", "Depot A"), T("t2", "Depot B")],
    });
    expect(d.status).toBe("ready");
    expect(d.role).toBe("admin");
    expect(d.homeTenantId).toBe("t1");
    expect(d.tenants).toHaveLength(2);
  });

  it("maps an unknown role to staff", () => {
    const d = parseTenantContext({ status: "ready", role: "tenant", home_tenant_id: "t1", tenants: [] });
    expect(d.role).toBe("staff");
  });

  it("passes through signed-out and no-tenant", () => {
    expect(parseTenantContext({ status: "signed-out" }).status).toBe("signed-out");
    expect(parseTenantContext({ status: "no-tenant" }).status).toBe("no-tenant");
  });

  it("treats null/garbage input as no-tenant, never throws", () => {
    expect(parseTenantContext(null).status).toBe("no-tenant");
    expect(parseTenantContext({}).status).toBe("no-tenant");
  });
});

describe("pickInitialActiveTenant", () => {
  const tenants = [T("t1", "A"), T("t2", "B")];
  it("locks staff to their home tenant", () => {
    expect(pickInitialActiveTenant("staff", "t1", [T("t1", "A")], "t2")).toBe("t1");
  });
  it("defaults admin/super to All (null)", () => {
    expect(pickInitialActiveTenant("admin", "t1", tenants, null)).toBeNull();
  });
  it("restores a valid persisted admin choice", () => {
    expect(pickInitialActiveTenant("admin", "t1", tenants, "t2")).toBe("t2");
  });
  it("ignores a persisted choice not in the list", () => {
    expect(pickInitialActiveTenant("admin", "t1", tenants, "tX")).toBeNull();
  });
});

describe("computeWriteTenantId", () => {
  it("staff always writes to home", () => {
    expect(computeWriteTenantId("staff", "t1", "t1")).toBe("t1");
  });
  it("specific active tenant is the write target", () => {
    expect(computeWriteTenantId("admin", "t1", "t2")).toBe("t2");
  });
  it("All (null) yields null so create is blocked", () => {
    expect(computeWriteTenantId("admin", "t1", null)).toBeNull();
    expect(computeWriteTenantId("super_admin", null, null)).toBeNull();
  });
});

describe("tenantStorageKey", () => {
  it("is namespaced per user", () => {
    expect(tenantStorageKey("u1")).toBe("tms.activeTenant.u1");
    expect(tenantStorageKey("u1")).not.toBe(tenantStorageKey("u2"));
  });
});

/* These assertions are enforced by `npm run typecheck`, NOT by vitest, which
   strips types without checking them. The @ts-expect-error lines are the real
   test: if filterByTenant ever reappears on the unresolved variant, the
   directive becomes unused and tsc fails with "Unused '@ts-expect-error'".
   The runtime expects below only stop vitest reporting an empty test. */
describe("TenantContextValue as a discriminated union", () => {
  const base = {
    role: "admin" as const,
    userEmail: "a@b.co",
    tenants: [T("t1", "Depot A")],
    activeTenantId: "t1",
    setActiveTenantId: () => {},
    writeTenantId: "t1",
  };

  it("exposes filterByTenant on the ready variant", () => {
    const ready: ReadyTenantContext = {
      ...base,
      status: "ready",
      filterByTenant: (query) => query,
    };
    expect(typeof ready.filterByTenant).toBe("function");
  });

  it("does not expose filterByTenant while the tenant is unresolved", () => {
    const unresolved: UnresolvedTenantContext = { ...base, status: "loading" };
    // @ts-expect-error filterByTenant is the whole point of the union: an
    // unresolved tenant must not be able to build a query at all.
    void unresolved.filterByTenant;
    expect(unresolved.status).toBe("loading");
  });

  it("keeps writeTenantId on both variants, since it is already null while loading", () => {
    const unresolved: UnresolvedTenantContext = { ...base, status: "loading" };
    expect(unresolved.writeTenantId).toBe("t1");
  });
});
