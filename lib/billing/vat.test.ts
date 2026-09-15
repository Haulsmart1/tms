import { describe, expect, it } from "vitest";
import { VAT_RATE, computeChargeAmounts } from "./money";
import { VAT_RATE_PERCENT, vatOnNetPence } from "./vat";

describe("vatOnNetPence", () => {
  it("charges 20 per cent on the minimum exactly", () => {
    expect(vatOnNetPence(12900)).toBe(2580);
  });

  it("rounds half up", () => {
    expect(vatOnNetPence(2)).toBe(0);
    expect(vatOnNetPence(3)).toBe(1);
  });

  // One rate, not two that happen to agree.
  it("is the rate v1 charges too", () => {
    expect(VAT_RATE).toBe(VAT_RATE_PERCENT);
    const amounts = computeChargeAmounts(3);
    expect(amounts.vatPence).toBe(vatOnNetPence(amounts.netPence));
  });
});
