// Find out at Square what happened to a payment whose outcome was never
// recorded. Server-only. The matching rule is pure and tested in
// lib/billing/reconcile.ts; this file only fetches.
//
// Square cannot look a payment up by idempotency key and ListPayments has no
// reference filter, so this lists the location's payments in a window starting
// an hour before the intent was recorded and matches on reference_id, which
// every charge path now derives from its idempotency key.
//
// Never throws. Any failure to look is `unresolved`, which keeps the pending
// row in place and blocks a re-charge: not knowing is never evidence that no
// money moved.

import type { SquareClient } from "square";

import { reconcileFromPayments } from "../billing/reconcile";
import type { ListedPayment, ReconcileOutcome } from "../billing/reconcile";

const LOOKBACK_MS = 60 * 60 * 1000;
const MAX_PAYMENTS_SCANNED = 2000;

export async function reconcilePaymentByReference(
  square: SquareClient,
  args: {
    locationId: string;
    referenceId: string;
    amountPence: number;
    /** When the pending intent was recorded. */
    sinceISO: string | null;
  }
): Promise<ReconcileOutcome> {
  try {
    const sinceMs = args.sinceISO ? Date.parse(args.sinceISO) : Number.NaN;
    const beginTime = new Date(
      (Number.isFinite(sinceMs) ? sinceMs : Date.now() - 7 * 24 * LOOKBACK_MS) -
        LOOKBACK_MS
    ).toISOString();

    const page = await square.payments.list({
      beginTime,
      endTime: new Date().toISOString(),
      locationId: args.locationId,
      limit: 100,
    });

    const matches: ListedPayment[] = [];
    let scanned = 0;
    for await (const payment of page) {
      scanned += 1;
      if (payment.referenceId === args.referenceId) matches.push(payment);
      if (scanned >= MAX_PAYMENTS_SCANNED) {
        // Truncated. A miss here proves nothing.
        if (matches.length === 0) {
          return { kind: "unresolved", reason: "lookup_failed" };
        }
        break;
      }
    }

    return reconcileFromPayments(matches, {
      referenceId: args.referenceId,
      amountPence: args.amountPence,
    });
  } catch (error) {
    console.error(
      "[billing] Square payment lookup failed",
      error instanceof Error ? error.message : String(error)
    );
    return { kind: "unresolved", reason: "lookup_failed" };
  }
}
