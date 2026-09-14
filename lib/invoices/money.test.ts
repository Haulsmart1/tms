import { describe, expect, it } from "vitest";
import { calculateLineAmounts, calculateTotals, roundMoney, splitPaymentAllocation, toPence } from "./money";

describe("calculateLineAmounts", () => {
  it("rounds the exact decimal value, not the binary float", () => {
    /* The float route loses the half penny; Postgres round(1.005, 2) is 1.01. */
    expect(Math.round(1.005 * 100)).toBe(100);
    expect(calculateLineAmounts(1, 1.005, 0)).toMatchObject({ netPence: 101 });
  });

  it("prices 3 x 33.335 at 20% as Postgres numeric would", () => {
    expect(calculateLineAmounts(3, 33.335, 20)).toEqual({
      netPence: 10001,
      vatPence: 2000,
      grossPence: 12001,
      net: 100.01,
      vat: 20,
      gross: 120.01,
    });
  });

  it("takes VAT on the rounded net and rounds halves away from zero", () => {
    expect(calculateLineAmounts("1.5", "0.333", "20")).toMatchObject({ net: 0.5, vat: 0.1, gross: 0.6 });
    expect(calculateLineAmounts(1, "0.10", "17.5")).toMatchObject({ vatPence: 2 });
    expect(calculateLineAmounts(-1, 10.005, 0)).toMatchObject({ netPence: -1001 });
  });

  it("treats blank or non-numeric input as zero instead of NaN", () => {
    expect(calculateLineAmounts("", "12.50", 20)).toMatchObject({ grossPence: 0 });
    expect(calculateLineAmounts(1, "abc", 20)).toMatchObject({ grossPence: 0 });
    expect(calculateLineAmounts(2, "12.50", "")).toMatchObject({ net: 25, vat: 0, gross: 25 });
  });
});

describe("calculateTotals", () => {
  it("sums per-line rounded values rather than rounding the grand total", () => {
    const line = { quantity: 1, unitPrice: 0.005, vatRate: 0 };
    /* Each line is 0.01; rounding the unrounded sum 0.015 would give 0.02. */
    expect(calculateTotals([line, line, line])).toMatchObject({ subtotal: 0.03, total: 0.03 });
  });

  it("matches on-screen, saved and PDF totals for a mixed quotation", () => {
    expect(
      calculateTotals([
        { quantity: 3, unitPrice: 33.335, vatRate: 20 },
        { quantity: "2.5", unitPrice: "19.99", vatRate: "20" },
        { quantity: 1, unitPrice: 100, vatRate: 0 },
      ])
    ).toEqual({
      /* 100.01 + 49.98 (2.5 x 19.99 = 49.975) + 100.00 */
      subtotalPence: 24999,
      /* 20.00 + 10.00 (20% of 49.98 = 9.996) + 0 */
      vatPence: 3000,
      totalPence: 27999,
      subtotal: 249.99,
      vat: 30,
      total: 279.99,
    });
  });
});

describe("toPence and roundMoney", () => {
  it("rounds typed amounts to pence", () => {
    expect(toPence("1200.005")).toBe(120001);
    expect(toPence(1e-7)).toBe(0);
    expect(toPence(Number.NaN)).toBe(0);
    expect(roundMoney("19.995")).toBe(20);
  });
});

describe("splitPaymentAllocation", () => {
  it("caps the allocation at the outstanding balance and leaves the rest unallocated", () => {
    expect(splitPaymentAllocation(3000, 1200)).toMatchObject({ allocate: 1200, unallocated: 1800 });
    expect(splitPaymentAllocation("500", "1200.00")).toMatchObject({ allocate: 500, unallocated: 0 });
  });

  it("never allocates a negative or NaN amount", () => {
    expect(splitPaymentAllocation(100, -5)).toMatchObject({ allocate: 0, unallocated: 100 });
    expect(splitPaymentAllocation("abc", 100)).toMatchObject({ allocate: 0, unallocated: 0 });
  });
});
