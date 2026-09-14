import { describe, expect, it } from "vitest";
import {
  buildListedUsers,
  canManageListedUser,
  checkRemoval,
  checkRoleEdit,
  inviteResponse,
  isValidEmail,
  parseInvitableRole,
  parseProvisionOutcome,
  userAdminErrorResponse,
} from "./userAdmin";

describe("parseInvitableRole", () => {
  it("accepts only admin, staff and driver", () => {
    expect(parseInvitableRole(" Admin ")).toBe("admin");
    expect(parseInvitableRole("driver")).toBe("driver");
    expect(parseInvitableRole("super_admin")).toBeNull();
    expect(parseInvitableRole("")).toBeNull();
    expect(parseInvitableRole(undefined)).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("rejects obvious junk and overlong input", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@b.co`)).toBe(false);
  });
});

describe("inviteResponse", () => {
  it("answers identically for a fresh invite and an account in another company (no enumeration)", () => {
    expect(inviteResponse("other_company", "x@y.com")).toEqual(inviteResponse("created", "x@y.com"));
  });

  it("refuses to re-invite an existing member instead of changing their role", () => {
    expect(inviteResponse("already_member", "x@y.com").status).toBe(409);
  });

  it("only recognises known outcomes", () => {
    expect(parseProvisionOutcome("created")).toBe("created");
    expect(parseProvisionOutcome("something")).toBeNull();
  });
});

describe("userAdminErrorResponse", () => {
  it("answers 503 when the migration is missing", () => {
    expect(userAdminErrorResponse({ code: "PGRST202", message: "Could not find the function" }).status).toBe(503);
    expect(userAdminErrorResponse({ code: "42883", message: "function does not exist" }).status).toBe(503);
  });

  it("maps the guard tokens", () => {
    expect(userAdminErrorResponse({ code: "P0001", message: "last_admin" }).status).toBe(409);
    expect(userAdminErrorResponse({ code: "P0001", message: "super_admin_protected" }).status).toBe(403);
    expect(userAdminErrorResponse({ code: "P0001", message: "not_in_company" }).status).toBe(404);
  });

  it("never echoes raw database text", () => {
    const result = userAdminErrorResponse({ code: "23505", message: 'duplicate key value violates "profiles_pkey"' });
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("profiles_pkey");
  });
});

describe("checkRoleEdit", () => {
  const caller = "caller";

  it("stops a company admin changing a super admin", () => {
    expect(
      checkRoleEdit({ callerId: caller, callerTier: "admin", target: { userId: "t", roleName: "super_admin" }, newRole: "staff" })?.status,
    ).toBe(403);
  });

  it("lets a super admin change a super admin", () => {
    expect(
      checkRoleEdit({ callerId: caller, callerTier: "super_admin", target: { userId: "t", roleName: "super_admin" }, newRole: "admin" }),
    ).toBeNull();
  });

  it("refuses a change to your own role but allows saving your own details", () => {
    expect(
      checkRoleEdit({ callerId: caller, callerTier: "admin", target: { userId: caller, roleName: "admin" }, newRole: "staff" })?.status,
    ).toBe(403);
    expect(
      checkRoleEdit({ callerId: caller, callerTier: "admin", target: { userId: caller, roleName: "admin" }, newRole: "admin" }),
    ).toBeNull();
  });

  it("allows an admin to change a staff member", () => {
    expect(
      checkRoleEdit({ callerId: caller, callerTier: "admin", target: { userId: "t", roleName: "staff" }, newRole: "driver" }),
    ).toBeNull();
  });
});

describe("checkRemoval", () => {
  it("refuses removing yourself", () => {
    expect(checkRemoval({ callerId: "a", callerTier: "admin", target: { userId: "a", roleName: "admin" } })?.status).toBe(403);
  });

  it("refuses a company admin removing a super admin", () => {
    expect(checkRemoval({ callerId: "a", callerTier: "admin", target: { userId: "b", roleName: "super_admin" } })?.status).toBe(403);
  });

  it("allows removing a colleague", () => {
    expect(checkRemoval({ callerId: "a", callerTier: "admin", target: { userId: "b", roleName: "admin" } })).toBeNull();
  });
});

describe("canManageListedUser", () => {
  it("hides controls from staff and protects super admins", () => {
    expect(canManageListedUser("staff", "driver")).toBe(false);
    expect(canManageListedUser("admin", "driver")).toBe(true);
    expect(canManageListedUser("admin", "super_admin")).toBe(false);
    expect(canManageListedUser("super_admin", "super_admin")).toBe(true);
  });
});

describe("buildListedUsers", () => {
  it("lists only profiles homed in the tenant, reading role from roles and defaulting to staff", () => {
    const rows = buildListedUsers(
      "t1",
      [
        { id: "u2", full_name: "Zed", phone: null, tenant_id: "t1", company_id: "c", role_id: "r", roles: { name: "admin" } },
        { id: "u1", full_name: null, phone: "1", tenant_id: "t1", company_id: "c", role_id: null, roles: null },
        { id: "u3", full_name: "Other", phone: null, tenant_id: "t2", company_id: "c", role_id: null, roles: null },
      ],
      new Map([
        ["u1", "a@x.com"],
        ["u2", "b@x.com"],
      ]),
    );
    expect(rows.map((r) => r.user_id)).toEqual(["u1", "u2"]);
    expect(rows[0].role).toBe("staff");
    expect(rows[1].role).toBe("admin");
    expect(rows[0].membership_id).toBe("u1");
  });
});
