import { describe, it, expect } from "vitest";
import { usersView } from "./usersView";

const NOBODY: readonly unknown[] = [];
const SOMEBODY: readonly unknown[] = [{ membership_id: "m1" }];

describe("usersView", () => {
  /* THE REGRESSION THIS FUNCTION EXISTS FOR. activeTenantId is null while the
     tenant context is still resolving, so an order that tested null first
     would tell every admin to "pick a tenant" for a frame on every cold load. */
  it("returns loading, not no-tenant-selected, while the tenant context is still resolving", () => {
    expect(
      usersView({
        tenantStatus: "loading",
        activeTenantId: null,
        fetching: false,
        users: NOBODY,
      })
    ).toBe("loading");
  });

  it("still returns loading while resolving even when a tenant id is already known", () => {
    expect(
      usersView({
        tenantStatus: "loading",
        activeTenantId: "t1",
        fetching: false,
        users: NOBODY,
      })
    ).toBe("loading");
  });

  /* THE USER-VISIBLE BUG THIS FIXES. A resolved admin on "All tenants" was
     told the tenant had no users, when the page had never queried at all. */
  it("returns no-tenant-selected for a resolved admin sitting on All tenants", () => {
    expect(
      usersView({
        tenantStatus: "ready",
        activeTenantId: null,
        fetching: false,
        users: NOBODY,
      })
    ).toBe("no-tenant-selected");
  });

  it("returns loading while the page's own query is in flight", () => {
    expect(
      usersView({
        tenantStatus: "ready",
        activeTenantId: "t1",
        fetching: true,
        users: NOBODY,
      })
    ).toBe("loading");
  });

  it("returns empty only once a real tenant was queried and came back with nobody", () => {
    expect(
      usersView({
        tenantStatus: "ready",
        activeTenantId: "t1",
        fetching: false,
        users: NOBODY,
      })
    ).toBe("empty");
  });

  it("returns list whenever there are users", () => {
    expect(
      usersView({
        tenantStatus: "ready",
        activeTenantId: "t1",
        fetching: false,
        users: SOMEBODY,
      })
    ).toBe("list");
  });

  /* Same short circuit as shouldShowSkeleton: TenantProvider.resolve() resets
     status to "loading" on every auth event, including a routine token
     refresh, and a populated list must not flash back to a skeleton. */
  it("keeps the list on screen when the tenant status re-enters loading", () => {
    expect(
      usersView({
        tenantStatus: "loading",
        activeTenantId: null,
        fetching: true,
        users: SOMEBODY,
      })
    ).toBe("list");
  });

  it("returns loading rather than empty for a tenant that could not be resolved", () => {
    expect(
      usersView({
        tenantStatus: "no-tenant",
        activeTenantId: null,
        fetching: false,
        users: NOBODY,
      })
    ).toBe("loading");
  });
});
