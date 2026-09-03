import { describe, it, expect } from "vitest";
import { isSkeletonReadyRoute, SKELETON_READY_ROUTES } from "./skeletonReadyRoutes";

describe("isSkeletonReadyRoute", () => {
  it("returns true for a converted route", () => {
    expect(isSkeletonReadyRoute("/dashboard")).toBe(true);
  });

  it("ignores a trailing slash, which Next can produce depending on config", () => {
    expect(isSkeletonReadyRoute("/dashboard/")).toBe(true);
  });

  it("returns false for an unlisted route, so a new page is gate-blocked by default rather than showing a false empty state", () => {
    expect(isSkeletonReadyRoute("/jobs")).toBe(false);
    expect(isSkeletonReadyRoute("/some-page-added-next-year")).toBe(false);
  });

  it("returns false for the legacy pages, which cannot render a ds skeleton at all", () => {
    expect(isSkeletonReadyRoute("/driver/dashboard")).toBe(false);
    expect(isSkeletonReadyRoute("/super-admin/companies")).toBe(false);
  });

  it("matches exactly and does not treat a sibling or a prefix as ready", () => {
    expect(isSkeletonReadyRoute("/customersomething")).toBe(false);
    expect(isSkeletonReadyRoute("/settings")).toBe(false);
  });

  it("returns true for the billing settings page", () => {
    expect(isSkeletonReadyRoute("/settings/billing")).toBe(true);
    expect(isSkeletonReadyRoute("/settings/billing/")).toBe(true);
  });

  it("lists exactly the routes converted so far, and nothing aspirational", () => {
    expect([...SKELETON_READY_ROUTES].sort()).toEqual(
      ["/dashboard", "/customers", "/settings/billing", "/subcontractors", "/vehicles"].sort()
    );
  });
});
