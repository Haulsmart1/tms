import { describe, it, expect } from "vitest";
import { isThemeableRoute, THEMEABLE_ROUTES } from "./themeableRoutes";

describe("isThemeableRoute", () => {
  it("returns true for the pages that paint their own bg-canvas on a .ds wrapper", () => {
    expect(isThemeableRoute("/")).toBe(true);
    expect(isThemeableRoute("/login")).toBe(true);
    expect(isThemeableRoute("/dashboard")).toBe(true);
    expect(isThemeableRoute("/jobs")).toBe(true);
    expect(isThemeableRoute("/pod")).toBe(true);
    expect(isThemeableRoute("/tracking")).toBe(true);
    expect(isThemeableRoute("/super-admin/requests")).toBe(true);
    expect(isThemeableRoute("/invoices")).toBe(true);
    expect(isThemeableRoute("/telematics")).toBe(true);
    expect(isThemeableRoute("/stats")).toBe(true);
    expect(isThemeableRoute("/settings")).toBe(true);
    expect(isThemeableRoute("/settings/company")).toBe(true);
  });

  it("returns false for the legacy inline-styled pages, which pin themselves dark", () => {
    expect(isThemeableRoute("/driver/dashboard")).toBe(false);
    expect(isThemeableRoute("/subcontractor/dashboard")).toBe(false);
    expect(isThemeableRoute("/super-admin/companies")).toBe(false);
  });

  it("returns false for an unknown route, so a new page is legacy-safe by default rather than half-themed", () => {
    expect(isThemeableRoute("/some-page-added-next-year")).toBe(false);
  });

  it("matches exactly and does not treat a sibling as themeable", () => {
    // "/super-admin/requests" is themeable but "/super-admin/billing" is not,
    // so a prefix match here would wrongly theme the whole super-admin area.
    expect(isThemeableRoute("/super-admin/billing")).toBe(false);
    expect(isThemeableRoute("/super-admin")).toBe(false);
    expect(isThemeableRoute("/jobsomething")).toBe(false);
  });

  it("ignores a trailing slash, which Next can produce depending on config", () => {
    expect(isThemeableRoute("/jobs/")).toBe(true);
    expect(isThemeableRoute("/")).toBe(true);
  });

  it("lists exactly the pages known to be tokenised today", () => {
    expect([...THEMEABLE_ROUTES].sort()).toEqual(
      [
        "/",
        "/login",
        "/super-admin/requests",
        "/dashboard",
        "/jobs",
        "/pod",
        "/tracking",
        "/drivers",
        "/assets",
        "/maintenance",
        "/vehicles",
        "/customers",
        "/subcontractors",
        "/invoices",
        "/stats",
        "/tachograph",
        "/telematics",
        "/settings",
        "/settings/users",
        "/settings/permissions",
        "/settings/invoices",
        "/settings/portal-invites",
        "/settings/licences",
        "/settings/company",
      ].sort(),
    );
  });
});
