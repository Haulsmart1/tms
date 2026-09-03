import { describe, it, expect } from "vitest";
import { tenantDataView } from "./tenantDataView";

describe("tenantDataView", () => {
  /* THE REGRESSION THIS FUNCTION EXISTS FOR. activeTenantId is null while the
     tenant context is still resolving, so an order that tested null first
     would tell every admin to "pick a tenant" for a frame on every cold load. */
  it("returns loading, not no-tenant-selected, while the tenant context is still resolving", () => {
    expect(
      tenantDataView({
        tenantStatus: "loading",
        activeTenantId: null,
        fetching: false,
        hasData: false,
        dataTenantId: undefined,
        failed: false,
      })
    ).toBe("loading");
  });

  it("still returns loading while resolving even when a tenant id is already known", () => {
    expect(
      tenantDataView({
        tenantStatus: "loading",
        activeTenantId: "t1",
        fetching: false,
        hasData: false,
        dataTenantId: undefined,
        failed: false,
      })
    ).toBe("loading");
  });

  /* THE USER-VISIBLE BUG THIS FIXES. A resolved admin on "All tenants" was
     told the tenant had no rows, when the page had never queried at all. */
  it("returns no-tenant-selected for a resolved admin sitting on All tenants", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: null,
        fetching: false,
        hasData: false,
        dataTenantId: undefined,
        failed: false,
      })
    ).toBe("no-tenant-selected");
  });

  /* Pins the !activeTenantId / fetching pair, the one adjacent swap no other
     case distinguishes. The users page's loader clears `fetching` on the null
     branch, so this input is unreachable there today: that guarantee lives in
     the page and would break silently, which is why it is pinned here. */
  it("returns no-tenant-selected, not loading, for a resolved admin on All tenants mid-fetch", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: null,
        fetching: true,
        hasData: false,
        dataTenantId: undefined,
        failed: false,
      })
    ).toBe("no-tenant-selected");
  });

  /* A failed read must never be reported as an empty tenant: that is the same
     false statement this module exists to remove, one branch over. */
  it("returns error, not empty, after a read that threw", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: "t1",
        fetching: false,
        hasData: false,
        dataTenantId: undefined,
        failed: true,
      })
    ).toBe("error");
  });

  /* error before fetching, so a retry in flight does not hide the failure the
     user is still looking at. */
  it("keeps reporting error while a retry is in flight", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: "t1",
        fetching: true,
        hasData: false,
        dataTenantId: undefined,
        failed: true,
      })
    ).toBe("error");
  });

  /* no-tenant-selected before error, so a stale failure carried across a
     switch back to "All tenants" does not outrank the prompt to pick one. */
  it("prefers no-tenant-selected over a stale failure", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: null,
        fetching: false,
        hasData: false,
        dataTenantId: undefined,
        failed: true,
      })
    ).toBe("no-tenant-selected");
  });

  it("returns loading while the page's own query is in flight", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: "t1",
        fetching: true,
        hasData: false,
        dataTenantId: undefined,
        failed: false,
      })
    ).toBe("loading");
  });

  it("returns empty only once a real tenant was queried and came back with nothing", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: "t1",
        fetching: false,
        hasData: false,
        dataTenantId: undefined,
        failed: false,
      })
    ).toBe("empty");
  });

  it("returns list whenever there is data for the currently selected tenant", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: "t1",
        fetching: false,
        hasData: true,
        dataTenantId: "t1",
        failed: false,
      })
    ).toBe("list");
  });

  /* Same short circuit as shouldShowSkeleton: TenantProvider.resolve() resets
     status to "loading" on every auth event, including a routine token
     refresh, and a populated list must not flash back to a skeleton. THE
     TOKEN-REFRESH PROTECTION: same tenant (here, "All tenants" on both
     sides), status dips to "loading", the list must still not be replaced. */
  it("keeps the list on screen when the tenant status re-enters loading (token refresh)", () => {
    expect(
      tenantDataView({
        tenantStatus: "loading",
        activeTenantId: null,
        fetching: true,
        hasData: true,
        dataTenantId: null,
        failed: false,
      })
    ).toBe("list");
  });

  /* THE REGRESSION THIS FIXES. Switching the active tenant leaves the
     previous tenant's rows in hasData, but they no longer belong to the
     tenant now selected, so this must NOT return "list" — it falls through
     to loading/fetching like any other stale region. */
  it("does not return list when the on-screen data belongs to a different tenant than the one now selected", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: "t2",
        fetching: true,
        hasData: true,
        dataTenantId: "t1",
        failed: false,
      })
    ).toBe("loading");
  });

  /* An admin on "All tenants" who reloads must not see a "pick a tenant" or
     loading state over content that is already correctly scoped to "All
     tenants": null on both sides is a match. */
  it("treats a null dataTenantId as a match against a null activeTenantId (All tenants)", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: null,
        fetching: false,
        hasData: true,
        dataTenantId: null,
        failed: false,
      })
    ).toBe("list");
  });

  /* THE CASE THE THREE-VALUED TYPE EXISTS FOR. dataTenantId: undefined means
     "never loaded" and must not be treated as equal to activeTenantId: null
     ("All tenants") — otherwise a never-loaded page on "All tenants" would
     skip straight past its own loading/prompt state. hasData is true here so
     the comparison is what decides the outcome, not the hasData check
     itself; if the type ever collapsed to two values this would wrongly
     return "list". */
  it("does not treat an undefined (never loaded) dataTenantId as a match against a null activeTenantId", () => {
    expect(
      tenantDataView({
        tenantStatus: "ready",
        activeTenantId: null,
        fetching: false,
        hasData: true,
        dataTenantId: undefined,
        failed: false,
      })
    ).toBe("no-tenant-selected");
  });

  /* Defensive: TenantGate renders its own panel for "no-tenant", so this input
     does not reach the function today. The case pins the `!== "ready"` check
     rather than describing anything a user sees. */
  it("pins the status check as !== ready, not === loading", () => {
    expect(
      tenantDataView({
        tenantStatus: "no-tenant",
        activeTenantId: null,
        fetching: false,
        hasData: false,
        dataTenantId: undefined,
        failed: false,
      })
    ).toBe("loading");
  });
});
