import { describe, it, expect } from "vitest";
import { buildUserRows } from "./users";

describe("buildUserRows", () => {
  it("resolves a tenant and its company normally", () => {
    const rows = buildUserRows({
      profiles: [{ id: "p1", tenant_id: "t1", full_name: "Alice", roles: { name: "staff" } }],
      tenants: [{ id: "t1", name: "Leeds Depot", company_id: "c1" }],
      companies: [{ id: "c1", name: "Acme Haulage" }],
      emailById: new Map([["p1", "alice@example.com"]]),
    });

    expect(rows).toEqual([
      {
        id: "p1",
        email: "alice@example.com",
        fullName: "Alice",
        role: "staff",
        tenantId: "t1",
        tenantName: "Leeds Depot",
        companyId: "c1",
        companyName: "Acme Haulage",
        hasProfile: true,
      },
    ]);
  });

  it("falls back to companies when tenant_id holds a company id directly", () => {
    // Rows written before tenants existed. tenant_id here is not a real
    // tenant, but a company id, and the join has to fall back rather than
    // rendering a blank company.
    const rows = buildUserRows({
      profiles: [{ id: "p1", tenant_id: "c1", full_name: "Legacy Bob", roles: null }],
      tenants: [],
      companies: [{ id: "c1", name: "Acme Haulage" }],
      emailById: new Map(),
    });

    expect(rows[0].tenantId).toBe("c1");
    expect(rows[0].tenantName).toBeNull();
    expect(rows[0].companyId).toBe("c1");
    expect(rows[0].companyName).toBe("Acme Haulage");
  });

  it("leaves tenant and company null when tenant_id is null", () => {
    const rows = buildUserRows({
      profiles: [{ id: "p1", tenant_id: null, full_name: "No Tenant", roles: null }],
      tenants: [{ id: "t1", name: "Leeds Depot", company_id: "c1" }],
      companies: [{ id: "c1", name: "Acme Haulage" }],
      emailById: new Map(),
    });

    expect(rows[0].tenantId).toBeNull();
    expect(rows[0].tenantName).toBeNull();
    expect(rows[0].companyId).toBeNull();
    expect(rows[0].companyName).toBeNull();
  });

  it("leaves company null when the tenant has no company_id", () => {
    const rows = buildUserRows({
      profiles: [{ id: "p1", tenant_id: "t1", full_name: "Orphan Tenant", roles: null }],
      tenants: [{ id: "t1", name: "Leeds Depot", company_id: null }],
      companies: [],
      emailById: new Map(),
    });

    expect(rows[0].tenantName).toBe("Leeds Depot");
    expect(rows[0].companyId).toBeNull();
    expect(rows[0].companyName).toBeNull();
  });

  it("returns a null email for a profile with no matching auth user", () => {
    const rows = buildUserRows({
      profiles: [{ id: "p1", tenant_id: null, full_name: "No Email", roles: null }],
      tenants: [],
      companies: [],
      emailById: new Map(),
    });

    expect(rows[0].email).toBeNull();
  });

  it("surfaces an auth user with no profile row as an orphan", () => {
    // The partial-invite path: inviteUserByEmail creates the auth user, then
    // separate, non-transactional inserts into profiles/memberships can fail
    // with no rollback. That leaves an auth.users row with no profile.
    const rows = buildUserRows({
      profiles: [{ id: "p1", tenant_id: "t1", full_name: "Alice", roles: { name: "staff" } }],
      tenants: [],
      companies: [],
      emailById: new Map([
        ["p1", "alice@example.com"],
        ["orphan-1", "half-invited@example.com"],
      ]),
    });

    expect(rows).toHaveLength(2);
    const orphan = rows.find((row) => row.id === "orphan-1");
    expect(orphan).toEqual({
      id: "orphan-1",
      email: "half-invited@example.com",
      fullName: null,
      role: null,
      tenantId: null,
      tenantName: null,
      companyId: null,
      companyName: null,
      hasProfile: false,
    });
  });

  it("marks a profile row hasProfile: true even with a null name and no role", () => {
    // app/api/settings/users/invite/route.ts inserts a profile with only
    // { id, tenant_id }, and profiles_privileged_columns_guard.sql forbids
    // setting role_id on insert at all, so a freshly invited, never-edited
    // user has full_name and role both null. That must not read as an
    // orphan: it has a profiles row, so hasProfile is derived from having
    // taken this branch, not from the null fields it happens to carry.
    const rows = buildUserRows({
      profiles: [{ id: "p1", tenant_id: "t1", full_name: null, roles: null }],
      tenants: [{ id: "t1", name: "Leeds Depot", company_id: "c1" }],
      companies: [{ id: "c1", name: "Acme Haulage" }],
      emailById: new Map([["p1", "invited@example.com"]]),
    });

    expect(rows[0].hasProfile).toBe(true);
  });

  it("marks an orphan row hasProfile: false", () => {
    const rows = buildUserRows({
      profiles: [],
      tenants: [],
      companies: [],
      emailById: new Map([["orphan-1", "half-invited@example.com"]]),
    });

    expect(rows[0].hasProfile).toBe(false);
  });
});
