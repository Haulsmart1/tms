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
        | "no_payment_method";
    };

export function selectActivationAction(args: {
  billingRow: ActivationBillingRow | null;
  openPeriod: OpenPeriod | null;
  todayISO: string;
  minimumPence: number;
}): ActivationAction {
  // The model flag lives on company_billing, so no row means the company
  // cannot be on v2. Falling through rather than blocking is what keeps every
  // existing customer working while v2 rolls out one company at a time.
  if (!args.billingRow) return { kind: "legacy" };
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
