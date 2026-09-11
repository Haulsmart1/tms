import {
  describe,
  expect,
  it,
} from "vitest";
import {
  isTachographAdminRole,
} from "./serverAuth";

describe("isTachographAdminRole", () => {
  it("accepts tenant administrators", () => {
    expect(
      isTachographAdminRole("admin")
    ).toBe(true);

    expect(
      isTachographAdminRole("super_admin")
    ).toBe(true);
  });

  it("rejects other tenant roles", () => {
    expect(
      isTachographAdminRole("staff")
    ).toBe(false);

    expect(
      isTachographAdminRole("driver")
    ).toBe(false);

    expect(
      isTachographAdminRole(null)
    ).toBe(false);
  });
});
