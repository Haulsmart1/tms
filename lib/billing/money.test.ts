import { describe, expect, it } from "vitest";
import {
  chargeIdempotencyKey,
  classifyPaymentResult,
  computeChargeAmounts,
  formatPence,
} from "./money";

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
