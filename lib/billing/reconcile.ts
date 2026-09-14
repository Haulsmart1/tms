// Working out what happened to a payment whose outcome was never recorded.
// Server-only (node:crypto); pure otherwise and unit tested.
//
// THE PROBLEM. Every charge path records a `pending` intent row before calling
// Square and replays it under the same idempotency key and byte-identical body
// on retry, which is Square's own way of answering "did this go through". That
// replay fails in one case: Square answers IDEMPOTENCY_KEY_REUSED when the
// body no longer matches (a row written by older code, or a body that drifted).
// Until now that meant PAYMENT_INDETERMINATE forever, with nothing but a human
// able to tell whether the customer had paid.
//
// THE LOOKUP. Square cannot fetch a payment by idempotency key, and ListPayments
// has no reference filter. So every payment now carries a reference_id DERIVED
// from its idempotency key, and reconciliation lists the location's payments in
// a time window around the intent and matches on it. Derived, not random,
// because it is part of the request body and must be identical on a replay.
//
// Only positive evidence is recorded, the same rule as classifySquareThrow:
// exactly one completed payment for the right amount is a success, and
// payments that all failed are a failure. Anything else (nothing found, several
// found, an amount that does not match, a payment still in flight) stays
// unresolved, which keeps the pending row in place and blocks a re-charge until
// someone looks.

import { createHash } from "node:crypto";

/**
 * Square's reference_id for a payment, from its idempotency key.
 *
 * Square allows 40 characters. The v1 and add-on keys are longer than that, so
 * it is a hash rather than the key itself, prefixed so the payments are easy to
 * pick out in the Square dashboard. 36 hex characters is 144 bits.
 */
export function paymentReferenceId(idempotencyKey: string): string {
  return `tms_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 36)}`;
}

export type ListedPayment = {
  id?: string | null;
  referenceId?: string | null;
  status?: string | null;
  receiptUrl?: string | null;
  amountMoney?: { amount?: bigint | number | null } | null;
};

export type ReconcileOutcome =
  | { kind: "succeeded"; paymentId: string; receiptUrl: string | null }
  | { kind: "failed"; failureCode: string }
  | {
      kind: "unresolved";
      reason:
        | "not_found"
        | "multiple_completed"
        | "amount_mismatch"
        | "in_progress"
        | "lookup_failed";
    };

export function reconcileFromPayments(
  payments: readonly ListedPayment[],
  args: { referenceId: string; amountPence: number }
): ReconcileOutcome {
  const matches = payments.filter((p) => p.referenceId === args.referenceId);
  if (matches.length === 0) return { kind: "unresolved", reason: "not_found" };

  const completed = matches.filter((p) => p.status === "COMPLETED");
  if (completed.length > 1) {
    // Two captured payments for one intended charge is a double charge that
    // needs a refund by hand, not a success to record.
    return { kind: "unresolved", reason: "multiple_completed" };
  }
  if (completed.length === 1) {
    const payment = completed[0];
    if (Number(payment.amountMoney?.amount ?? -1) !== args.amountPence) {
      return { kind: "unresolved", reason: "amount_mismatch" };
    }
    if (!payment.id) return { kind: "unresolved", reason: "not_found" };
    return {
      kind: "succeeded",
      paymentId: payment.id,
      receiptUrl: payment.receiptUrl ?? null,
    };
  }

  if (matches.every((p) => p.status === "FAILED" || p.status === "CANCELED")) {
    return { kind: "failed", failureCode: String(matches[0].status) };
  }
  return { kind: "unresolved", reason: "in_progress" };
}
