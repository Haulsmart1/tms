import { describe, it, expect } from "vitest";
import { shouldShowSkeleton } from "./skeletonVisibility";

describe("shouldShowSkeleton", () => {
  it("shows while tenant context is still resolving on a first load", () => {
    expect(shouldShowSkeleton({ tenantStatus: "loading", fetching: false, hasData: false })).toBe(true);
  });

  it("shows while the page's own query is in flight", () => {
    expect(shouldShowSkeleton({ tenantStatus: "ready", fetching: true, hasData: false })).toBe(true);
  });

  it("hides once the data is on screen", () => {
    expect(shouldShowSkeleton({ tenantStatus: "ready", fetching: false, hasData: true })).toBe(false);
  });

  /* THE REGRESSION THIS FUNCTION EXISTS FOR. TenantProvider.resolve() resets
     status to "loading" on every auth event, including a routine token
     refresh. Without the hasData short circuit, a populated page would flash
     back to a skeleton for no reason the user can perceive. */
  it("does not flash a skeleton over content already on screen when tenant status re-enters loading", () => {
    expect(shouldShowSkeleton({ tenantStatus: "loading", fetching: false, hasData: true })).toBe(false);
  });

  it("does not flash over existing content while a background refetch runs", () => {
    expect(shouldShowSkeleton({ tenantStatus: "ready", fetching: true, hasData: true })).toBe(false);
  });

  it("hides when the tenant could not be resolved, since the gate handles that case", () => {
    expect(shouldShowSkeleton({ tenantStatus: "signed-out", fetching: false, hasData: true })).toBe(false);
  });

  it("shows for an unresolved tenant with nothing to display yet", () => {
    expect(shouldShowSkeleton({ tenantStatus: "no-tenant", fetching: false, hasData: false })).toBe(true);
  });
});
