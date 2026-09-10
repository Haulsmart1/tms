// What happens when a company cancels. Pure decision core; the route loads the
// rows, calls this, then acts.
//
// Cancellation is the customer leaving. It is NOT the same path as suspension,
// which is us cutting off a non-payer and freezing everything in place.

import { addDays } from "./schedule";

/** Grace window for an accidental signup. Once per company. */
export const COOLING_OFF_HOURS = 48;

export type CancellationBillingRow = {
  billingModel: "v1_immediate" | "v2_period";
  status: "active" | "past_due" | "canceled";
  /** Non-null means the one cooling-off refund has been used. */
  coolingOffRefundedAt: string | null;
};

export type CancellablePeriod = {
  id: string;
  periodStartISO: string;
  /** Exclusive. */
  periodEndISO: string;
  openedAtISO: string;
  /** What was collected up front. 0 on a period opened by rollover. */
  prepaidPence: number;
  minimumChargePending: boolean;
};

export type CancellationAction =
  | { kind: "legacy" }
  /** Refund the minimum in full and raise no invoice. */
  | { kind: "cooling_off"; periodId: string; refundNetPence: number }
  /** Cut the period short, invoice what was used, take the balance. */
  | { kind: "close_early"; periodId: string; periodEndISO: string }
  /** Nothing to bill; just end the subscription. */
  | { kind: "cancel_only" }
  | { kind: "blocked"; reason: "already_canceled" | "payment_settling" };

export function selectCancellationAction(args: {
  billingRow: CancellationBillingRow | null;
  openPeriod: CancellablePeriod | null;
  nowISO: string;
  todayISO: string;
}): CancellationAction {
  if (!args.billingRow) return { kind: "legacy" };
  if (args.billingRow.billingModel !== "v2_period") return { kind: "legacy" };

  if (args.billingRow.status === "canceled") {
    return { kind: "blocked", reason: "already_canceled" };
  }

  // No period to close. A dormant company that never activated a vehicle, or
  // one whose last period closed and did not roll over because it had nothing
  // active. There is nothing to bill, but the subscription still has to end.
  if (!args.openPeriod) return { kind: "cancel_only" };

  // The outcome of the up-front charge is unknown, so neither refunding it nor
  // billing around it is defensible. Same reasoning as the activation gate.
  if (args.openPeriod.minimumChargePending) {
    return { kind: "blocked", reason: "payment_settling" };
  }

  // COOLING OFF. A customer who activates and cancels the same day has paid
  // GBP 129 for one day. That is the minimum working as designed and it is
  // defensible, but it is also the most likely complaint this model will ever
  // generate, and the population it affects is people who signed up by
  // mistake.
  //
  // Three guards, and each closes a different hole:
  //
  //   prepaidPence > 0     a rollover period collected nothing, so there is
  //                        nothing to refund. This is also what stops the
  //                        window reopening 28 days into a subscription.
  //   not already used     once per company, or signup-refund-repeat becomes a
  //                        free trial generator.
  //   inside the window    measured from when the period opened, which is the
  //                        moment of first vehicle activation.
  const hoursOpen =
    (Date.parse(args.nowISO) - Date.parse(args.openPeriod.openedAtISO)) /
    3_600_000;

  if (
    args.openPeriod.prepaidPence > 0 &&
    args.billingRow.coolingOffRefundedAt === null &&
    hoursOpen <= COOLING_OFF_HOURS
  ) {
    return {
      kind: "cooling_off",
      periodId: args.openPeriod.id,
      refundNetPence: args.openPeriod.prepaidPence,
    };
  }

  // The cancellation day counts IN FULL, symmetric with the activation day: a
  // vehicle activated at 23:00 buys that whole day, so a cancellation at 09:00
  // pays for that whole day too. Anything else needs a rule for which end of
  // the day wins, and an asymmetry there produces a one-day discrepancy nobody
  // can explain two years later. Hence tomorrow, since the end is exclusive.
  //
  // Never LATER than the period's own end. Cancelling after the close job
  // should already have run must not push the end out and bill days the
  // customer was not covered for.
  const cancelEndISO = addDays(args.todayISO, 1);
  const periodEndISO =
    cancelEndISO > args.openPeriod.periodEndISO
      ? args.openPeriod.periodEndISO
      : cancelEndISO;

  return { kind: "close_early", periodId: args.openPeriod.id, periodEndISO };
}
