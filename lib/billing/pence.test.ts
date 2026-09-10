import { describe, expect, it } from "vitest";
import { roundHalfUpDiv } from "./pence";

describe("roundHalfUpDiv", () => {
  it("returns an exact quotient unchanged", () => {
    expect(roundHalfUpDiv(180600, 28)).toBe(6450);
    expect(roundHalfUpDiv(0, 28)).toBe(0);
  });

  // 2.5 is the case that separates the two rules: half-up gives 3, banker's
  // rounding gives 2. 3.5 would not distinguish them, since both give 4.
  it("rounds a half up rather than down or to even", () => {
    expect(roundHalfUpDiv(45150, 28)).toBe(1613); // 1612.5
    expect(roundHalfUpDiv(5, 2)).toBe(3);
  });

  it("rounds below a half down", () => {
    expect(roundHalfUpDiv(58050, 28)).toBe(2073); // 2073.21
    expect(roundHalfUpDiv(6450, 28)).toBe(230); // 230.36
  });

  it("rounds above a half up", () => {
    expect(roundHalfUpDiv(70950, 28)).toBe(2534); // 2533.93
  });

  it("rejects a zero denominator", () => {
    expect(() => roundHalfUpDiv(1, 0)).toThrow(/positive integer/);
  });

  it("rejects a negative denominator", () => {
    expect(() => roundHalfUpDiv(1, -28)).toThrow(/positive integer/);
  });

  it("rejects a negative numerator", () => {
    expect(() => roundHalfUpDiv(-1, 28)).toThrow(/non-negative integer/);
  });

  it("rejects a fractional numerator", () => {
    expect(() => roundHalfUpDiv(1.5, 28)).toThrow(/non-negative integer/);
  });
});
