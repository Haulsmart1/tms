import { describe, it, expect } from "vitest";
import {
  parseTenantContext,
  pickInitialActiveTenant,
  computeWriteTenantId,
  tenantStorageKey,
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
