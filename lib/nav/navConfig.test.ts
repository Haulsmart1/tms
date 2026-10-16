import { describe, expect, it } from "vitest";
import { isNavItemActive, NAV_GROUPS } from "./navConfig";

describe("console navigation", () => {
  it("keeps commercial, fleet and daily work in separate groups", () => {
    expect(NAV_GROUPS.find((group) => group.label === "Operations")?.items.map((item) => item.id)).toEqual([
      "planning", "load-transfer", "shifts", "jobs", "pod", "tracking",
    ]);
    expect(NAV_GROUPS.find((group) => group.label === "Commercial")?.items.map((item) => item.id)).toEqual([
      "customers", "subcontractors", "invoices",
    ]);
    expect(NAV_GROUPS.find((group) => group.label === "Fleet")?.items.map((item) => item.id)).toEqual([
      "vehicles", "drivers", "assets", "maintenance",
    ]);
  });

  it("highlights the parent page for nested console routes", () => {
    expect(isNavItemActive("/settings/billing", "/settings")).toBe(true);
    expect(isNavItemActive("/jobs/123", "/jobs")).toBe(true);
  });

  it("does not treat a similarly prefixed route as a child", () => {
    expect(isNavItemActive("/jobs-history", "/jobs")).toBe(false);
    expect(isNavItemActive("/tracking", "/track")).toBe(false);
  });
});
