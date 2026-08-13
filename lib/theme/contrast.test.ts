import { describe, it, expect } from "vitest";
import { contrastRatio } from "./contrast";

describe("contrastRatio", () => {
  it("returns 21:1 for black on white, the WCAG maximum", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
  });

  it("returns 1:1 for a colour against itself", () => {
    expect(contrastRatio("#2953E3", "#2953E3")).toBeCloseTo(1, 5);
  });

  it("is order-independent, since WCAG ratios are symmetric", () => {
    expect(contrastRatio("#0B1220", "#F2F4F8")).toBeCloseTo(
      contrastRatio("#F2F4F8", "#0B1220"), 5,
    );
  });

  it("accepts shorthand hex", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 2);
  });

  it("matches a known third-party value: #2953E3 on white is 6.10:1", () => {
    expect(contrastRatio("#2953E3", "#FFFFFF")).toBeCloseTo(6.10, 2);
  });
});
