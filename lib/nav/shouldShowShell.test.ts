import { describe, it, expect } from "vitest";
import { shouldShowShell } from "./shouldShowShell";
import type { TenantStatus } from "../tenant/context";

describe("shouldShowShell", () => {
  it("hides on the public landing page regardless of status", () => {
    expect(shouldShowShell("/", "ready")).toBe(false);
    expect(shouldShowShell("/", "signed-out")).toBe(false);
  });

  it("hides on /login regardless of status (91fa6b0 closed the signed-in case; the signed-out case was already covered by the status check)", () => {
    expect(shouldShowShell("/login", "ready")).toBe(false);
    expect(shouldShowShell("/login", "signed-out")).toBe(false);
  });

  it("hides on every /super-admin/* route regardless of status", () => {
    expect(shouldShowShell("/super-admin", "ready")).toBe(false);
    expect(shouldShowShell("/super-admin/billing", "ready")).toBe(false);
  });

  it("hides on an app route when status is not ready — the fail-closed backstop", () => {
    expect(shouldShowShell("/jobs", "loading")).toBe(false);
    expect(shouldShowShell("/jobs", "signed-out")).toBe(false);
    expect(shouldShowShell("/jobs", "no-tenant")).toBe(false);
  });

  it("shows on an app route when signed in with a resolved tenant", () => {
    expect(shouldShowShell("/jobs", "ready")).toBe(true);
    expect(shouldShowShell("/dashboard", "ready")).toBe(true);
  });

  /* The gate inversion. A converted route renders its own skeleton during
     tenant resolution, so the sidebar must render alongside it rather than
     popping in afterwards. Uses a literal path rather than importing
     SKELETON_READY_ROUTES so the test still means something when the list is
     emptied out at the end of the migration. */
  // UNSKIP IN TASK 8, when /dashboard joins SKELETON_READY_ROUTES.
  it.skip("shows on a skeleton-ready route while tenant context is still loading", () => {
    expect(shouldShowShell("/dashboard", "loading")).toBe(true);
  });

  it("still hides on a skeleton-ready route when signed out or without a tenant, since only the loading case is relaxed", () => {
    expect(shouldShowShell("/dashboard", "signed-out")).toBe(false);
    expect(shouldShowShell("/dashboard", "no-tenant")).toBe(false);
  });

  it("hides for a status outside the known union — the fail-closed guarantee itself", () => {
    expect(shouldShowShell("/jobs", "some-future-status" as TenantStatus)).toBe(false);
  });
});
