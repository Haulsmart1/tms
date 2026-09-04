import { describe, expect, it } from "vitest";
import {
  chargeIdempotencyKey,
  classifyPaymentResult,
  computeChargeAmounts,
  formatPence,
  weeklyNetPence,
  WEEKS_PER_CYCLE,
} from "./money";

describe("weeklyNetPence", () => {
  // Graduated bands: the Nth vehicle is priced by the band N falls in, so the
  // first ten vehicles stay at GBP 10 even for a 500-vehicle fleet.
  it("prices a fleet inside the first band at GBP 10 per vehicle", () => {
    expect(weeklyNetPence(1)).toBe(1000);
    expect(weeklyNetPence(9)).toBe(9000);
    expect(weeklyNetPence(10)).toBe(10000);
  });

  it("prices the 11th to 20th vehicles at GBP 8", () => {
    expect(weeklyNetPence(11)).toBe(10800);
    expect(weeklyNetPence(20)).toBe(18000);
  });

  it("prices the 21st to 50th vehicles at GBP 6", () => {
    expect(weeklyNetPence(21)).toBe(18600);
    expect(weeklyNetPence(50)).toBe(36000);
  });

  it("prices the 51st vehicle onward at GBP 5", () => {
    expect(weeklyNetPence(51)).toBe(36500);
    expect(weeklyNetPence(60)).toBe(41000);
  });

  it("is zero for an empty fleet", () => {
    expect(weeklyNetPence(0)).toBe(0);
  });
});

describe("computeChargeAmounts", () => {
  it("bills 4 weeks per cycle", () => {
    expect(WEEKS_PER_CYCLE).toBe(4);
  });

  // The figure the commercial model was specified in. If this ever changes,
  // someone has changed the price, not refactored the maths.
  it("charges GBP 48 gross for a single vehicle", () => {
    expect(computeChargeAmounts(1)).toEqual({
      vehicleCount: 1,
      weeklyNetPence: 1000,
      blendedWeeklyPence: 1000,
      netPence: 4000,
      vatPence: 800,
      grossPence: 4800,
      vatRate: 20,
    });
  });

  it("charges a mixed-band fleet across all reached bands", () => {
    // 10 x GBP 10 + 10 x GBP 8 + 5 x GBP 6 = GBP 210 per week.
    expect(computeChargeAmounts(25)).toEqual({
      vehicleCount: 25,
      weeklyNetPence: 21000,
      blendedWeeklyPence: 840,
      netPence: 84000,
      vatPence: 16800,
      grossPence: 100800,
      vatRate: 20,
    });
  });

  it("reports the blended weekly rate, not the marginal one", () => {
    // A 50-vehicle fleet pays a blended GBP 7.20, NOT the GBP 6 marginal rate
    // and NOT the GBP 5 rate that only starts at vehicle 51.
    expect(computeChargeAmounts(50).blendedWeeklyPence).toBe(720);
    expect(computeChargeAmounts(60).blendedWeeklyPence).toBe(683);
  });

  it("returns all zeros for zero vehicles", () => {
    expect(computeChargeAmounts(0)).toEqual({
      vehicleCount: 0,
      weeklyNetPence: 0,
      blendedWeeklyPence: 0,
      netPence: 0,
      vatPence: 0,
      grossPence: 0,
      vatRate: 20,
    });
  });

  // This is the guard against anyone converting the bands to all-units
  // pricing, where a fleet crossing a threshold gets its WHOLE fleet
  // repriced and the bill drops when a vehicle is added.
  it("never bills less for more vehicles", () => {
    for (let n = 0; n < 200; n += 1) {
      expect(computeChargeAmounts(n + 1).grossPence).toBeGreaterThan(
        computeChargeAmounts(n).grossPence
      );
    }
  });

  it("lands VAT on an exact penny at every fleet size", () => {
    for (let n = 0; n <= 200; n += 1) {
      const { netPence, vatPence } = computeChargeAmounts(n);
      expect(netPence % 100).toBe(0);
      expect(vatPence * 5).toBe(netPence);
    }
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

describe("classifyPaymentResult", () => {
  it("treats COMPLETED as success", () => {
    expect(classifyPaymentResult({ status: "COMPLETED" })).toEqual({
      kind: "succeeded",
    });
  });

  it("treats FAILED and CANCELED as terminal failures", () => {
    expect(classifyPaymentResult({ status: "FAILED" })).toEqual({
      kind: "failed",
      failureCode: "FAILED",
    });
    expect(classifyPaymentResult({ status: "CANCELED" })).toEqual({
      kind: "failed",
      failureCode: "CANCELED",
    });
  });

  it("treats a missing payment as a terminal failure", () => {
    expect(classifyPaymentResult(undefined)).toEqual({
      kind: "failed",
      failureCode: "NO_PAYMENT_RETURNED",
    });
  });

  it("treats PENDING and APPROVED as indeterminate, never failed", () => {
    expect(classifyPaymentResult({ status: "PENDING" })).toEqual({
      kind: "indeterminate",
      status: "PENDING",
    });
    expect(classifyPaymentResult({ status: "APPROVED" })).toEqual({
      kind: "indeterminate",
      status: "APPROVED",
    });
  });

  it("treats an unknown status as indeterminate", () => {
    expect(classifyPaymentResult({ status: "SOMETHING_NEW" })).toEqual({
      kind: "indeterminate",
      status: "SOMETHING_NEW",
    });
  });
});

describe("formatPence", () => {
  it("formats zero", () => {
    expect(formatPence(0)).toBe("£0.00");
  });

  it("formats whole pounds with two decimals", () => {
    expect(formatPence(1000)).toBe("£10.00");
  });

  it("formats pence", () => {
    expect(formatPence(5)).toBe("£0.05");
    expect(formatPence(14400)).toBe("£144.00");
  });

  it("does not group thousands, matching the page's existing pounds() helper", () => {
    expect(formatPence(123456789)).toBe("£1234567.89");
  });
});
