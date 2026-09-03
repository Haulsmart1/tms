import { describe, it, expect } from "vitest";
import { shouldShowSkeleton } from "./skeletonVisibility";

describe("shouldShowSkeleton", () => {
  it("shows while tenant context is still resolving on a first load", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "loading",
        fetching: false,
        hasData: false,
        activeTenantId: "t1",
        dataTenantId: undefined,
      })
    ).toBe(true);
  });

  it("shows while the page's own query is in flight", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "ready",
        fetching: true,
        hasData: false,
        activeTenantId: "t1",
        dataTenantId: undefined,
      })
    ).toBe(true);
  });

  it("hides once the data is on screen for the selected tenant", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "ready",
        fetching: false,
        hasData: true,
        activeTenantId: "t1",
        dataTenantId: "t1",
      })
    ).toBe(false);
  });

  /* THE REGRESSION THIS FUNCTION EXISTS FOR. TenantProvider.resolve() resets
     status to "loading" on every auth event, including a routine token
     refresh. Without the hasData short circuit, a populated page would flash
     back to a skeleton for no reason the user can perceive. This is the
     token-refresh protection: same tenant, status dips to "loading", the
     skeleton must still not show. */
  it("does not flash a skeleton over content already on screen when tenant status re-enters loading (token refresh)", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "loading",
        fetching: false,
        hasData: true,
        activeTenantId: "t1",
        dataTenantId: "t1",
      })
    ).toBe(false);
  });

  it("does not flash over existing content while a background refetch runs", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "ready",
        fetching: true,
        hasData: true,
        activeTenantId: "t1",
        dataTenantId: "t1",
      })
    ).toBe(false);
  });

  it("hides when the tenant could not be resolved, since the gate handles that case", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "signed-out",
        fetching: false,
        hasData: true,
        activeTenantId: "t1",
        dataTenantId: "t1",
      })
    ).toBe(false);
  });

  it("shows for an unresolved tenant with nothing to display yet", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "no-tenant",
        fetching: false,
        hasData: false,
        activeTenantId: null,
        dataTenantId: undefined,
      })
    ).toBe(true);
  });

  /* THE REGRESSION THIS TEST CATCHES. Switching the active tenant left the
     previous tenant's rows on screen (hasData true), and without a tenant
     comparison the skeleton never showed while the new tenant's fetch was in
     flight: the page kept rendering the previous tenant's data under the new
     tenant's selection. */
  it("shows the skeleton when the on-screen data belongs to a different tenant than the one now selected", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "ready",
        fetching: true,
        hasData: true,
        activeTenantId: "t2",
        dataTenantId: "t1",
      })
    ).toBe(true);
  });

  /* An admin on "All tenants" (activeTenantId: null) who reloads, or hits a
     token refresh, must not get a skeleton over content that is already
     correctly scoped to "All tenants". */
  it("treats a null dataTenantId as a match against a null activeTenantId (All tenants)", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "loading",
        fetching: false,
        hasData: true,
        activeTenantId: null,
        dataTenantId: null,
      })
    ).toBe(false);
  });

  /* THE CASE THE THREE-VALUED TYPE EXISTS FOR. A page that has never
     completed a load has dataTenantId: undefined, which must NOT be treated
     as equal to activeTenantId: null ("All tenants") — otherwise a
     never-loaded page on "All tenants" would skip its loading state. hasData
     is true here (e.g. content seeded some other way) specifically so the
     hasData branch is reached and the undefined/null comparison is what
     decides the outcome; if the type ever collapsed to two values this
     would wrongly return false. */
  it("does not treat an undefined (never loaded) dataTenantId as a match against a null activeTenantId", () => {
    expect(
      shouldShowSkeleton({
        tenantStatus: "loading",
        fetching: false,
        hasData: true,
        activeTenantId: null,
        dataTenantId: undefined,
      })
    ).toBe(true);
  });
});
