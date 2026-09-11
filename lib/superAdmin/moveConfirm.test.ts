import { describe, it, expect } from "vitest";
import { canConfirmMove, requiredMoveConfirmText } from "./moveConfirm";

const tenantA = { id: "tenant-a", name: "Acme North" };
const tenantB = { id: "tenant-b", name: "Bravo South" };

const countsA = { tenantId: "tenant-a", vehicles: 5, billableVehicles: 3, users: 2 };
const countsB = { tenantId: "tenant-b", vehicles: 9, billableVehicles: 7, users: 4 };

function baseArgs(overrides: Partial<Parameters<typeof canConfirmMove>[0]> = {}) {
  return {
    tenant: tenantA,
    counts: countsA,
    countsError: null,
    target: "company-2",
    typed: "Acme North",
    busy: false,
    ...overrides,
  };
}

describe("requiredMoveConfirmText", () => {
  it("returns the tenant's name", () => {
    expect(requiredMoveConfirmText(tenantA)).toBe("Acme North");
  });

  it("falls back to the tenant's id when it has no name", () => {
    expect(requiredMoveConfirmText({ id: "tenant-x", name: null })).toBe("tenant-x");
    expect(requiredMoveConfirmText({ id: "tenant-x", name: "" })).toBe("tenant-x");
  });

  it("returns an empty string for no tenant", () => {
    expect(requiredMoveConfirmText(null)).toBe("");
  });
});

describe("canConfirmMove", () => {
  it("allows a fully matching request", () => {
    expect(canConfirmMove(baseArgs())).toBe(true);
  });

  it("denies with no tenant open", () => {
    expect(canConfirmMove(baseArgs({ tenant: null }))).toBe(false);
  });

  it("denies while a request is already in flight", () => {
    expect(canConfirmMove(baseArgs({ busy: true }))).toBe(false);
  });

  it("denies with no target company chosen", () => {
    expect(canConfirmMove(baseArgs({ target: "" }))).toBe(false);
  });

  it("denies when the count read failed for this tenant", () => {
    expect(
      canConfirmMove(baseArgs({ countsError: { tenantId: "tenant-a", message: "boom" } })),
    ).toBe(false);
  });

  it("ignores a count-read error that belongs to a different tenant", () => {
    // A stale error from a previous Move click on another tenant must not
    // block confirming THIS tenant, the same way stale counts must not
    // enable it.
    expect(
      canConfirmMove(baseArgs({ countsError: { tenantId: "tenant-b", message: "boom" } })),
    ).toBe(true);
  });

  it("denies when counts have not arrived yet", () => {
    expect(canConfirmMove(baseArgs({ counts: null }))).toBe(false);
  });

  it("THE C2 CASE: denies when counts belong to a different tenant than the one open", () => {
    // Move opened on tenant A, cancelled, Move opened on tenant B, then A's
    // slow response lands. moving is B, but the counts describe A. This is
    // exactly the sequence the review flagged: without the tenantId check,
    // the operator could type B's name and confirm while looking at A's
    // fleet, billable and user counts.
    expect(canConfirmMove(baseArgs({ tenant: tenantB, counts: countsA, typed: "Bravo South" }))).toBe(
      false,
    );
  });

  it("allows once fresh counts for the currently open tenant arrive", () => {
    expect(canConfirmMove(baseArgs({ tenant: tenantB, counts: countsB, typed: "Bravo South" }))).toBe(
      true,
    );
  });

  it("denies when the typed text does not match", () => {
    expect(canConfirmMove(baseArgs({ typed: "Acme" }))).toBe(false);
    expect(canConfirmMove(baseArgs({ typed: "" }))).toBe(false);
  });

  it("is case-sensitive, deliberately", () => {
    expect(canConfirmMove(baseArgs({ typed: "acme north" }))).toBe(false);
  });

  it("does not collapse internal whitespace, deliberately", () => {
    expect(canConfirmMove(baseArgs({ typed: "Acme  North" }))).toBe(false);
  });

  it("trims only leading and trailing whitespace on the typed value", () => {
    expect(canConfirmMove(baseArgs({ typed: "  Acme North  " }))).toBe(true);
  });

  it("falls back to the tenant id for a nameless tenant, end to end", () => {
    const nameless = { id: "tenant-z", name: null };
    const namelessCounts = { tenantId: "tenant-z", vehicles: 1, billableVehicles: 1, users: 1 };
    expect(canConfirmMove(baseArgs({ tenant: nameless, counts: namelessCounts, typed: "tenant-z" }))).toBe(
      true,
    );
    expect(canConfirmMove(baseArgs({ tenant: nameless, counts: namelessCounts, typed: "" }))).toBe(false);
  });
});
