import { describe, expect, it } from "vitest";
import { chargeIdempotencyKey, computeChargeAmounts } from "./money";

describe("computeChargeAmounts", () => {
  it("charges 1000 pence net per vehicle plus 20% VAT", () => {
    expect(computeChargeAmounts(12)).toEqual({
      vehicleCount: 12,
      netPence: 12000,
      vatPence: 2400,
      grossPence: 14400,
      vatRate: 20,
    });
  });

  it("handles a single vehicle", () => {
    expect(computeChargeAmounts(1)).toEqual({
      vehicleCount: 1,
      netPence: 1000,
      vatPence: 200,
      grossPence: 1200,
      vatRate: 20,
    });
  });

  it("returns all zeros for zero vehicles", () => {
    expect(computeChargeAmounts(0)).toEqual({
      vehicleCount: 0,
      netPence: 0,
      vatPence: 0,
      grossPence: 0,
      vatRate: 20,
    });
  });

  it("rejects negative counts", () => {
    expect(() => computeChargeAmounts(-1)).toThrow();
  });

  it("rejects fractional counts", () => {
    expect(() => computeChargeAmounts(2.5)).toThrow();
  });
});

describe("chargeIdempotencyKey", () => {
  it("is deterministic and compact over company, cycle and attempt", () => {
    expect(
      chargeIdempotencyKey(
        "0c8b6a1e-4f2d-4e7b-9a3c-1d5e7f9b2a4c",
        "2026-08-26",
        2
      )
    ).toBe("0c8b6a1e4f2d4e7b9a3c1d5e7f9b2a4c_20260826_2");
  });

  it("stays within Square's 45-character idempotency key limit", () => {
    const key = chargeIdempotencyKey(
      "0c8b6a1e-4f2d-4e7b-9a3c-1d5e7f9b2a4c",
      "2026-08-26",
      99
    );
    expect(key.length).toBeLessThanOrEqual(45);
  });
});
