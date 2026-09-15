import { describe, it, expect } from "vitest";
import { accountsAccessAllowed, isRoleAuthorized, ACCOUNTS_ADMIN_ROLES } from "./authz";

describe("accountsAccessAllowed", () => {
  const office = { tier: "staff" as const, roleName: "staff", hasActiveDriverLink: false };

  it("admits office staff when the route has no allow-list", () => {
    expect(accountsAccessAllowed(office)).toBe(true);
  });

  it("refuses a driver profile even when the route has no allow-list", () => {
    expect(accountsAccessAllowed({ ...office, roleName: "driver" })).toBe(false);
    expect(accountsAccessAllowed({ ...office, roleName: "subcontractor_driver" })).toBe(false);
  });

  it("refuses staff who hold an active driver portal link", () => {
    expect(accountsAccessAllowed({ ...office, hasActiveDriverLink: true })).toBe(false);
  });

  it("keeps admins in even if they also hold a driver link", () => {
    expect(accountsAccessAllowed({ tier: "admin", roleName: "admin", hasActiveDriverLink: true })).toBe(true);
  });

  it("still applies an allow-list on top of the office rule", () => {
    expect(accountsAccessAllowed(office, ACCOUNTS_ADMIN_ROLES)).toBe(false);
    expect(accountsAccessAllowed({ tier: "admin", roleName: "admin", hasActiveDriverLink: false }, ACCOUNTS_ADMIN_ROLES)).toBe(true);
    expect(accountsAccessAllowed({ tier: "super_admin", roleName: "super_admin", hasActiveDriverLink: false }, ACCOUNTS_ADMIN_ROLES)).toBe(true);
  });
});

describe("isRoleAuthorized", () => {
  it("allows any member when no allow-list is given (read semantics preserved)", () => {
    expect(isRoleAuthorized("driver", undefined)).toBe(true);
    expect(isRoleAuthorized("staff", undefined)).toBe(true);
    expect(isRoleAuthorized("admin", undefined)).toBe(true);
  });

  it("admits only listed roles when an allow-list is given", () => {
    expect(isRoleAuthorized("admin", ACCOUNTS_ADMIN_ROLES)).toBe(true);
    expect(isRoleAuthorized("super_admin", ACCOUNTS_ADMIN_ROLES)).toBe(true);
    expect(isRoleAuthorized("staff", ACCOUNTS_ADMIN_ROLES)).toBe(false);
    expect(isRoleAuthorized("driver", ACCOUNTS_ADMIN_ROLES)).toBe(false);
  });

  it("treats empty, null, and unknown roles as unauthorized under an allow-list", () => {
    expect(isRoleAuthorized("", ACCOUNTS_ADMIN_ROLES)).toBe(false);
    expect(isRoleAuthorized(null, ACCOUNTS_ADMIN_ROLES)).toBe(false);
    expect(isRoleAuthorized("owner", ACCOUNTS_ADMIN_ROLES)).toBe(false);
  });

  it("normalizes case and surrounding whitespace before matching", () => {
    expect(isRoleAuthorized("  Admin  ", ACCOUNTS_ADMIN_ROLES)).toBe(true);
  });
});
