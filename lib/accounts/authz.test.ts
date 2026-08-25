import { describe, it, expect } from "vitest";
import { isRoleAuthorized, ACCOUNTS_ADMIN_ROLES } from "./authz";

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
