import { describe, expect, it } from "vitest";
import { buildSuperAdminAuditRow } from "./audit";
import { MOVE_TENANT_MIGRATION_MISSING, interpretMoveTenantError, readProfilesMoved } from "./tenantMove";

describe("interpretMoveTenantError", () => {
  it.each(["42883", "PGRST202"])("refuses clearly when the RPC is missing (%s)", (code) => {
    expect(interpretMoveTenantError({ code, message: "function does not exist" })).toEqual({
      status: 503,
      error: MOVE_TENANT_MIGRATION_MISSING,
    });
  });

  it("explains a block by company admins, singular and plural", () => {
    const one = interpretMoveTenantError({ code: "P0001", message: "tenant_has_company_admins:1" });
    expect(one.status).toBe(409);
    expect(one.error).toMatch(/^1 company admin has/);

    const many = interpretMoveTenantError({ code: "P0001", message: "tenant_has_company_admins:3" });
    expect(many.error).toMatch(/^3 company admins have/);
  });

  it("maps the lookup failures", () => {
    expect(interpretMoveTenantError({ code: "P0002", message: "no_such_tenant" }).status).toBe(404);
    expect(interpretMoveTenantError({ code: "P0002", message: "no_such_company" })).toMatchObject({
      status: 400,
      field: "company_id",
    });
    expect(interpretMoveTenantError({ code: "42501", message: "actor_not_super_admin" }).status).toBe(403);
  });

  it("never leaks an unknown database message", () => {
    const failure = interpretMoveTenantError({ code: "23503", message: 'violates foreign key "profiles_x"' });
    expect(failure).toEqual({ status: 500, error: "Unable to update this tenant." });
  });

  it("treats a missing error object as a generic failure", () => {
    expect(interpretMoveTenantError(null).status).toBe(500);
  });
});

describe("readProfilesMoved", () => {
  it("reads the count", () => {
    expect(readProfilesMoved({ profiles_moved: 4 })).toBe(4);
  });

  it.each([null, "x", {}, { profiles_moved: "4" }])("returns null for %s", (value) => {
    expect(readProfilesMoved(value)).toBeNull();
  });
});

describe("buildSuperAdminAuditRow", () => {
  it("records field names only and defaults details", () => {
    expect(
      buildSuperAdminAuditRow({
        actorId: "a",
        action: "tenant.rename",
        targetType: "tenant",
        targetId: "t",
        changedFields: ["name"],
        result: "ok",
      }),
    ).toEqual({
      actor_id: "a",
      action: "tenant.rename",
      target_type: "tenant",
      target_id: "t",
      changed_fields: ["name"],
      details: {},
      result: "ok",
    });
  });
});
