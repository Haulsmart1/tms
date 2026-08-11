import { describe, it, expect } from "vitest";
import { shouldShowShell } from "./shouldShowShell";

describe("shouldShowShell", () => {
  it("hides on the public landing page regardless of status", () => {
    expect(shouldShowShell("/", "ready")).toBe(false);
    expect(shouldShowShell("/", "signed-out")).toBe(false);
  });

  it("hides on /login regardless of status — this is the exact case 91fa6b0 fixed", () => {
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
});
