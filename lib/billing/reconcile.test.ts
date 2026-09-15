import { describe, expect, it } from "vitest";
import { paymentReferenceId, reconcileFromPayments } from "./reconcile";

const REF = paymentReferenceId("0123456789abcdef0123456789abcdef_b1");

describe("paymentReferenceId", () => {
  it("fits Square's 40 character limit for every key shape", () => {
    for (const key of [
      "0123456789abcdef0123456789abcdef_m1",
      "0123456789abcdef0123456789abcdef_20260826_12",
      "a_0123456789abcd_20260826_0123456789abcd_3",
    ]) {
      expect(paymentReferenceId(key).length).toBeLessThanOrEqual(40);
    }
  });

  // Part of the request body, so a replay must produce the same value.
  it("is deterministic and distinct per key", () => {
    expect(paymentReferenceId("k1")).toBe(paymentReferenceId("k1"));
    expect(paymentReferenceId("k1")).not.toBe(paymentReferenceId("k2"));
  });
});

describe("reconcileFromPayments", () => {
  const completed = {
    id: "pay-1",
    referenceId: REF,
    status: "COMPLETED",
    receiptUrl: "https://r",
    amountMoney: { amount: BigInt(15480) },
  };

  it("records one completed payment for the right amount as a success", () => {
    expect(
      reconcileFromPayments([completed], { referenceId: REF, amountPence: 15480 })
    ).toEqual({ kind: "succeeded", paymentId: "pay-1", receiptUrl: "https://r" });
  });

  it("ignores payments for other references", () => {
    expect(
      reconcileFromPayments([{ ...completed, referenceId: "tms_other" }], {
        referenceId: REF,
        amountPence: 15480,
      })
    ).toEqual({ kind: "unresolved", reason: "not_found" });
  });

  it("records a failure only when every match failed", () => {
    expect(
      reconcileFromPayments([{ ...completed, status: "FAILED" }], {
        referenceId: REF,
        amountPence: 15480,
      })
    ).toEqual({ kind: "failed", failureCode: "FAILED" });
  });

  it("leaves two captured payments for a human", () => {
    expect(
      reconcileFromPayments([completed, { ...completed, id: "pay-2" }], {
        referenceId: REF,
        amountPence: 15480,
      })
    ).toEqual({ kind: "unresolved", reason: "multiple_completed" });
  });

  it("refuses a completed payment for a different amount", () => {
    expect(
      reconcileFromPayments([completed], { referenceId: REF, amountPence: 100 })
    ).toEqual({ kind: "unresolved", reason: "amount_mismatch" });
  });

  it("waits on a payment still in flight", () => {
    expect(
      reconcileFromPayments([{ ...completed, status: "APPROVED" }], {
        referenceId: REF,
        amountPence: 15480,
      })
    ).toEqual({ kind: "unresolved", reason: "in_progress" });
  });
});
