import { describe, it, expect } from "vitest";
import { superAdminDenial, superAdminEditLine } from "./guard";

describe("superAdminDenial", () => {
  it("denies an anonymous caller with 401", () => {
    // 401, not 403: a fetch() that gets 403 has no reason to send the user to
    // sign in, and proxy.ts already answers 401 for an unauthenticated API
    // call. Matching it keeps one meaning for one status across the app.
    // resolveSuperAdmin returns userId: null for a signed-out caller, so
    // this is the exact value it produces, not a stand-in for one.
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

describe("superAdminEditLine", () => {
  it("includes exactly the fields the audit trail promises", () => {
    const line = superAdminEditLine({
      actorId: "admin-1",
      action: "company.edit",
      targetId: "company-1",
      changedFields: ["name", "postcode"],
      result: "ok",
    });

    const parsed = JSON.parse(line);
    expect(Object.keys(parsed).sort()).toEqual(
      ["action", "actor_id", "at", "changed_fields", "event", "result", "target_id"].sort(),
    );
  });

  it("records changed fields as names only, never the values that changed", () => {
    // "Field names only, never values" is the security property this
    // function exists to guarantee: an audit line for editing a postcode
    // must contain the word "postcode", not the postcode value itself.
    const line = superAdminEditLine({
      actorId: "admin-1",
      action: "company.edit",
      targetId: "company-1",
      changedFields: ["postcode"],
      result: "ok",
    });

    const parsed = JSON.parse(line);
    expect(parsed.changed_fields).toEqual(["postcode"]);
    expect(Object.keys(parsed)).not.toContain("value");
    expect(Object.keys(parsed)).not.toContain("values");
  });

  it("records the result of the write, including a partial success", () => {
    const line = superAdminEditLine({
      actorId: "admin-1",
      action: "company.edit",
      targetId: "company-1",
      changedFields: ["name"],
      result: "partial",
    });

    expect(JSON.parse(line).result).toBe("partial");
  });
});
