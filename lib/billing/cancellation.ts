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
  /**
   * True when the card on file has already had a cooling-off refund on ANY
   * company. BILL2-10: once per company alone let the same card sign up again
   * under a new company name.
   */
  coolingOffUsedByCard?: boolean;
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
  /**
   * True when this is the company's first ever billing period. BILL2-10: the
   * spec grants cooling-off at FIRST activation only, and every
   * activation-opened period (a return from dormancy, a re-open) also has
   * prepaid_pence > 0.
   */
  isFirstPeriod: boolean;
};

export type CancellationAction =
  | { kind: "legacy" }
  /** Refund the minimum in full and raise no invoice. */
  | { kind: "cooling_off"; periodId: string; refundNetPence: number }
  /**
   * The open period has not started yet: a migrated company whose first v2
   * period begins at its seam date. Nothing has been used under v2, and v1
   * already covered the days until the seam. BILL2-13.
   */
  | { kind: "void_future_period"; periodId: string }
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

  // BILL2-13. Cutting a period that has not begun would set its end before its
  // start, which billing_periods_end_after_start rejects, and the customer got
  // a 500 telling them to contact support.
  if (args.openPeriod.periodStartISO > args.todayISO) {
    return { kind: "void_future_period", periodId: args.openPeriod.id };
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

  //   first period         the spec's FIRST activation. A later
  //                        activation-opened period is not a signup mistake.
  //   card not used        the refund is per card as well as per company, so
  //                        a new company name on the same card gets nothing.
  if (
    args.openPeriod.prepaidPence > 0 &&
    args.openPeriod.isFirstPeriod &&
    args.billingRow.coolingOffRefundedAt === null &&
    !args.billingRow.coolingOffUsedByCard &&
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

export type V1CancellationAction =
  | { kind: "cancel" }
  | { kind: "blocked"; reason: "already_canceled" | "payment_settling" };

/**
 * Cancelling a company still on v1 (charge in advance). Review BILL1-14.
 *
 * v1 is prepaid, so there is nothing to invoice on the way out and no refund:
 * the cycle in progress was paid for and runs to its end. Cancelling stops the
 * cron charging again (it skips canceled rows) and stops add-on charges (the
 * activate route blocks canceled).
 *
 * A charge whose outcome is unknown blocks it, for the same reason as v2: the
 * card may have been charged, and cancelling across an unrecorded payment
 * leaves nobody able to say what the customer paid for.
 */
export function selectV1CancellationAction(args: {
  status: string;
  hasUnsettledCharge: boolean;
}): V1CancellationAction {
  if (args.status === "canceled") {
    return { kind: "blocked", reason: "already_canceled" };
  }
  if (args.hasUnsettledCharge) {
    return { kind: "blocked", reason: "payment_settling" };
  }
  return { kind: "cancel" };
}
