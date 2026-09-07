import { describe, expect, it } from "vitest";
import { computeAddonAmounts, marginalWeeklyPence } from "./prorata";
import { computeChargeAmounts, VAT_RATE } from "./money";
import { CYCLE_DAYS } from "./schedule";

describe("marginalWeeklyPence", () => {
  it("prices the first vehicle in the first band", () => {
    expect(marginalWeeklyPence(0)).toBe(1000);
  });

  it("prices the last vehicle of a band at that band's rate", () => {
    expect(marginalWeeklyPence(9)).toBe(1000);
    expect(marginalWeeklyPence(19)).toBe(800);
    expect(marginalWeeklyPence(49)).toBe(600);
  });

  it("steps down at each band boundary", () => {
    expect(marginalWeeklyPence(10)).toBe(800);
    expect(marginalWeeklyPence(20)).toBe(600);
    expect(marginalWeeklyPence(50)).toBe(500);
  });

  it("stays on the final band above the last ceiling", () => {
    expect(marginalWeeklyPence(200)).toBe(500);
  });

  // Mirrors the monotonicity assertion in money.test.ts: the bill must never
  // fall when a vehicle is added, so the marginal cost is never zero or less.
  it("is always positive", () => {
    for (let n = 0; n <= 120; n += 1) {
      expect(marginalWeeklyPence(n)).toBeGreaterThan(0);
    }
  });

  it("rejects a non-integer or negative baseline", () => {
    expect(() => marginalWeeklyPence(-1)).toThrow();
    expect(() => marginalWeeklyPence(1.5)).toThrow();
  });
});

describe("computeAddonAmounts", () => {
  it("charges nothing for zero days", () => {
    const amounts = computeAddonAmounts(0, 0);
    expect(amounts.netPence).toBe(0);
    expect(amounts.grossPence).toBe(0);
  });

  it("charges one week for seven days", () => {
    expect(computeAddonAmounts(0, 7).netPence).toBe(1000);
  });

  // The cross-check that matters: a vehicle added for a whole cycle must cost
  // exactly what the cycle charge would have cost for it. If these two ever
  // diverge, the add-on price and the invoice price disagree.
  it("charges a full cycle the same as the cycle charge for that vehicle", () => {
    const addon = computeAddonAmounts(0, CYCLE_DAYS);
    expect(addon.netPence).toBe(computeChargeAmounts(1).netPence);
    expect(addon.grossPence).toBe(computeChargeAmounts(1).grossPence);
  });

  it("charges the marginal band rate, not the first band rate", () => {
    // The 21st vehicle sits in the GBP 6 band.
    expect(computeAddonAmounts(20, CYCLE_DAYS).netPence).toBe(600 * 4);
  });

  it("rounds a part week to the nearest penny", () => {
    // 1000 * 27 / 7 = 3857.14...
    expect(computeAddonAmounts(0, 27).netPence).toBe(3857);
    // 800 * 3 / 7 = 342.857...
    expect(computeAddonAmounts(10, 3).netPence).toBe(343);
  });

  it("applies VAT at the standard rate", () => {
    const amounts = computeAddonAmounts(0, 7);
    expect(amounts.vatRate).toBe(VAT_RATE);
    expect(amounts.vatPence).toBe(200);
    expect(amounts.grossPence).toBe(1200);
  });

  it("reports the inputs it priced", () => {
    const amounts = computeAddonAmounts(4, 10);
    expect(amounts.baselineCount).toBe(4);
    expect(amounts.days).toBe(10);
    expect(amounts.marginalWeeklyPence).toBe(1000);
  });

  it("rejects a day count outside a single cycle", () => {
    expect(() => computeAddonAmounts(0, -1)).toThrow();
    expect(() => computeAddonAmounts(0, CYCLE_DAYS + 1)).toThrow();
    expect(() => computeAddonAmounts(0, 1.5)).toThrow();
  });
});
