import { describe, it, expect } from "vitest";
import { isThemeableRoute, THEMEABLE_ROUTES, THEMEABLE_ROUTE_PREFIXES } from "./themeableRoutes";

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

  /* This used to assert the opposite for these three. They were the last
     inline-styled pages; converting them to tokens was the point of the change
     that edited this test, so the expectations flipped with them. The guard
     against a NEW page being half-themed lives in the "unknown route" case
     below, which is the one that must never flip. */
  it("returns true for the converted portal and super-admin pages", () => {
    expect(isThemeableRoute("/driver/dashboard")).toBe(true);
    expect(isThemeableRoute("/subcontractor/dashboard")).toBe(true);
    expect(isThemeableRoute("/super-admin/companies")).toBe(true);
    expect(isThemeableRoute("/super-admin")).toBe(true);
    expect(isThemeableRoute("/super-admin/billing")).toBe(true);
  });

  /* The share-token pages and the driver job page are customer- and
     driver-facing, outside the console shell, and styled with a fixed light
     palette on purpose. They are deliberately absent from the allowlist, so a
     recipient opening a delivery receipt does not inherit the operator's
     theme. */
  it("returns false for the public share pages, which keep a fixed palette", () => {
    expect(isThemeableRoute("/pod/share/some-token")).toBe(false);
    expect(isThemeableRoute("/quotation/share/some-token")).toBe(false);
    expect(isThemeableRoute("/driver/jobs/some-job-id")).toBe(false);
  });

  it("returns false for an unknown route, so a new page is legacy-safe by default rather than half-themed", () => {
    expect(isThemeableRoute("/some-page-added-next-year")).toBe(false);
  });

  it("matches exactly and does not treat a sibling as themeable", () => {
    // "/driver/dashboard" is themeable but "/driver/jobs/[jobId]" is not, so a
    // prefix match here would wrongly theme the driver job page along with it.
    expect(isThemeableRoute("/driver/jobs/abc123")).toBe(false);
    expect(isThemeableRoute("/jobsomething")).toBe(false);
  });

  it("ignores a trailing slash, which Next can produce depending on config", () => {
    expect(isThemeableRoute("/jobs/")).toBe(true);
    expect(isThemeableRoute("/")).toBe(true);
  });

  it("themes the company detail page under /super-admin/companies/", () => {
    expect(isThemeableRoute("/super-admin/companies/2f7cc0dc-0000-4000-8000-000000000000")).toBe(true);
    expect(isThemeableRoute("/super-admin/companies/anything/deeper")).toBe(true);
  });

  it("does not let the prefix rule leak to other dynamic routes", () => {
    // The reason isThemeableRoute is exact-match in the first place:
    // /driver/dashboard is themed, /driver/jobs/[jobId] deliberately is not.
    expect(isThemeableRoute("/driver/jobs/abc")).toBe(false);
    expect(isThemeableRoute("/pod/share/tok")).toBe(false);
    expect(isThemeableRoute("/super-admin/users/abc")).toBe(false);
  });

  /* THEMEABLE_ROUTES gets the verbatim-contents test below precisely so nobody
     adds an entry unnoticed. THEMEABLE_ROUTE_PREFIXES is only documented with a
     comment in the source and needs the same protection: the trailing slash on
     "/super-admin/companies/" is the entire reason a future
     /super-admin/companies-archive route does not inherit theming, and nothing
     else guards it. Someone "tidying" the entry to "/super-admin/companies"
     would break that with a green suite if these assertions did not exist. */
  it("pins the prefix invariant: exactly one entry, always slash-terminated", () => {
    expect([...THEMEABLE_ROUTE_PREFIXES]).toEqual(["/super-admin/companies/"]);
    expect(THEMEABLE_ROUTE_PREFIXES.every((p) => p.endsWith("/"))).toBe(true);
    expect(isThemeableRoute("/super-admin/companies-archive")).toBe(false);
  });

  it("lists exactly the pages known to be tokenised today", () => {
    expect([...THEMEABLE_ROUTES].sort()).toEqual(
      [
        "/",
        "/login",
        "/auth/confirm",
        "/super-admin",
        "/super-admin/requests",
        "/super-admin/billing",
        "/super-admin/companies",
        "/super-admin/invoices",
        "/super-admin/users",
        "/driver/dashboard",
        "/subcontractor/dashboard",
        "/dashboard",
        "/jobs",
        "/planning",
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
        "/settings/billing",
        "/settings/documents",
      ].sort(),
    );
  });
});
