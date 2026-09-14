// What happens when a vehicle licence is activated under period billing.
// Pure decision core; the route loads the rows, calls this, then acts.
//
// The v1 counterpart is selectAddonAction in lib/billing/addon.ts, and the
// difference between them is the whole point of this work: that one decides
// how much to charge a card RIGHT NOW for a mid-cycle vehicle, and carries all
// the machinery that a synchronous charge on an unstable request body needs.
// This one charges nothing at all except once, at the very start.

import { nextPeriodBounds } from "./period";

export type ActivationBillingRow = {
  billingModel: "v1_immediate" | "v2_period";
  status: "active" | "past_due" | "canceled";
  hasPaymentMethod: boolean;
};

export type OpenPeriod = {
  id: string;
  periodStartISO: string;
  periodEndISO: string;
};

export type ActivationAction =
  /** Not a v2 company. The caller falls through to the existing v1 path. */
  | { kind: "legacy" }
  /** Insert the licence and nothing else. No payment call. */
  | { kind: "join_open_period"; periodId: string }
  /** Open the company's period and take the minimum up front. */
  | {
      kind: "open_period_and_charge";
      periodStartISO: string;
      periodEndISO: string;
      amountPence: number;
    }
  | {
      kind: "blocked";
      reason:
        | "past_due"
        | "canceled"
        | "inactive_subscription"
        | "no_payment_method"
        | "payment_settling"
        | "dunning";
    };

/**
 * Does this OPEN period still owe its up-front minimum?
 *
 * Review findings BILL2-4 and BILL2-8. Two states used to let a vehicle join
 * a period that had never collected its minimum:
 *
 *   pending    the minimum's Square call has no recorded outcome. Blocking
 *              forever was the old answer, and nothing ever replayed it.
 *   orphaned   the period was inserted and then the request threw before any
 *              charge row existed. Every later activation joined it free.
 *
 * Both now route back through the charge, which REPLAYS a pending row under
 * its stored idempotency key and body (so a charge that did go through is
 * found, not repeated) and takes the minimum for an orphan.
 *
 * A period legitimately has no minimum when the close job rolled it over from
 * the previous period (it starts exactly where that one ended) or when the
 * migration script opened it at a future seam date. Those are recognised from
 * the rows themselves, so no migration is needed to tell them apart.
 */
export function openPeriodNeedsMinimum(args: {
  prepaidPence: number;
  /** Statuses of every `minimum` period_charges row on this period. */
  minimumChargeStatuses: readonly string[];
  periodStartISO: string;
  /** London calendar date the period row was created. */
  createdOnISO: string;
  /** True when an earlier period for the company ends exactly at this start. */
  followsPreviousPeriod: boolean;
}): boolean {
  if (args.minimumChargeStatuses.includes("pending")) return true;
  if (args.minimumChargeStatuses.includes("refunded")) return false;
  // Money was taken but prepaid_pence was never recorded. The charge path
  // repairs prepaid without charging again, and until it does the close job
  // would bill the whole period on top of the minimum.
  if (args.minimumChargeStatuses.includes("succeeded")) {
    return args.prepaidPence <= 0;
  }
  if (args.prepaidPence > 0) return false;
  if (args.followsPreviousPeriod) return false;
  if (args.periodStartISO > args.createdOnISO) return false;
  return true;
}

export function selectActivationAction(args: {
  billingRow: ActivationBillingRow | null;
  openPeriod: OpenPeriod | null;
  /** True when the open period's up-front minimum has a `pending` charge row. */
  openPeriodMinimumPending: boolean;
  /**
   * True when the open period never collected its minimum (see
   * openPeriodNeedsMinimum). A pending minimum implies this.
   */
  openPeriodNeedsMinimum?: boolean;
  /**
   * True when the company has a period that closed and has not been paid
   * (closing, closed or failed). BILL2-6.
   */
  hasUncollectedPeriod?: boolean;
  /**
   * True while a period is being invoiced or its balance has an unrecorded
   * outcome (closing or closed). Not a decline, so not `dunning`.
   */
  hasPeriodBeingClosed?: boolean;
  todayISO: string;
  minimumPence: number;
  /**
   * NEW_COMPANY_BILLING_MODEL, passed in rather than imported so each test
   * states which world it is in and none silently changes meaning when the
   * default does.
   */
  newCompanyBillingModel: "v1_immediate" | "v2_period";
}): ActivationAction {
  // No row means the company has not added a card. On a v1 default it falls
  // through to the v1 path, whose first card save charges the whole fleet.
  //
  // On a v2 default that would be a leak. The v1 path treats no row as a free
  // no_subscription activation, but v2's card save takes nothing and only an
  // activation opens a period, so vehicles activated before the card would
  // never be billed. Refused instead, with the reason v2 already uses for a
  // company that has no card: its first activation charges the minimum, and
  // needs one.
  if (!args.billingRow) {
    return args.newCompanyBillingModel === "v2_period"
      ? { kind: "blocked", reason: "no_payment_method" }
      : { kind: "legacy" };
  }
  if (args.billingRow.billingModel !== "v2_period") return { kind: "legacy" };

  // Suspension gates, mirroring selectAddonAction's. Under arrears a company
  // that has not paid must not be able to grow its fleet, or the debt accrues
  // against a card that is already failing.
  //
  // Checked before the payment-method gate because these carry the message the
  // customer actually needs. A past due company HAS a card; it declined.
  if (args.billingRow.status === "canceled") {
    return { kind: "blocked", reason: "canceled" };
  }
  if (args.billingRow.status === "past_due") {
    return { kind: "blocked", reason: "past_due" };
  }
  // Fails CLOSED on anything outside the union, exactly as selectAddonAction
  // does. The union is a compile-time claim about a runtime column, so a status
  // added later (paused, trialing) must not fall through to a branch that
  // charges a card.
  if (args.billingRow.status !== "active") {
    return { kind: "blocked", reason: "inactive_subscription" };
  }

  // DUNNING, the v2 equivalent of selectAddonAction's retry_at gate (BILL2-6).
  // While a closed period's balance is being retried the company is still
  // `active`, and without this it could open a NEW period with a small
  // minimum, leave the days between the two periods unbilled, and let the debt
  // compound past one period if the old one later exhausts. The same rule is
  // enforced in the database by docs/sql/prodfix_33.
  if (args.hasUncollectedPeriod) {
    return { kind: "blocked", reason: "dunning" };
  }
  // A close in progress, or a balance whose outcome is not yet known. Opening a
  // new period now would be refused by the same database guard, and joining
  // the old one is impossible because it is no longer open. Resolves when the
  // close job records the outcome.
  if (args.hasPeriodBeingClosed) {
    return { kind: "blocked", reason: "payment_settling" };
  }

  // RULE 10, and the reason this whole model is simpler than v1: adding a
  // vehicle inside a running period moves no money. No Square call, no
  // coverage row, no pro-rata arithmetic on a request body that changes every
  // midnight. It is an insert, and the vehicle is billed when the period
  // closes.
  //
  // An open period whose end has already passed is one the close job has not
  // reached yet, and the cron runs daily so that window is hours. Joining it
  // is still right: the licence activates at or after that period's end, so it
  // contributes no line there and is covered in full from the start of the
  // next one. Opening a second period instead would collide with the
  // one-open-period-per-company index in billing_06.
  if (args.openPeriod) {
    // A pending charge row means a Square call was made whose outcome was
    // never recorded, so the card may well have been charged. Joining anyway
    // would be expensive in a way that is hard to spot: the vehicle goes in
    // free, prepaid_pence stays 0, and at close the customer is billed for the
    // whole period on top of a minimum they may already have paid.
    //
    // It used to BLOCK, permanently, because nothing ever replayed the row.
    // It now goes back through the charge for THIS period: the pending row is
    // replayed under its own idempotency key and stored body, so Square hands
    // back the original outcome instead of taking a second payment. An orphaned
    // period with no minimum at all takes the same path (BILL2-8).
    if (args.openPeriodMinimumPending || args.openPeriodNeedsMinimum) {
      // A replay resends the card stored on the pending row, so it does not
      // need a card on file. A minimum that was never attempted does.
      if (!args.openPeriodMinimumPending && !args.billingRow.hasPaymentMethod) {
        return { kind: "blocked", reason: "no_payment_method" };
      }
      return {
        kind: "open_period_and_charge",
        periodStartISO: args.openPeriod.periodStartISO,
        periodEndISO: args.openPeriod.periodEndISO,
        amountPence: args.minimumPence,
      };
    }
    return { kind: "join_open_period", periodId: args.openPeriod.id };
  }

  // No open period, so this is either the company's first ever vehicle or a
  // reactivation after suspension. Both take the minimum up front, and both
  // anchor the period HERE rather than at signup: the gap between creating an
  // account and adding a first vehicle is not a billing period at all, which
  // is what stops a dormant company ever seeing a zero-pound invoice.
  //
  // This is the single deliberate exception to rule 10. It is not a proration
  // charge; it is an amount the company owes for the period regardless, and
  // its request body is a fixed sum keyed on (company, period), so none of the
  // idempotency-replay problems billing_05 exists to solve apply to it.
  if (!args.billingRow.hasPaymentMethod) {
    return { kind: "blocked", reason: "no_payment_method" };
  }

  const bounds = nextPeriodBounds(args.todayISO);
  return {
    kind: "open_period_and_charge",
    periodStartISO: bounds.periodStartISO,
    periodEndISO: bounds.periodEndISO,
    amountPence: args.minimumPence,
  };
}
