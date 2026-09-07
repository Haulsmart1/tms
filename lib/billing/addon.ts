// Pure decision core for a mid-cycle vehicle addition. The route loads rows,
// calls selectAddonAction, performs the Square charge, then writes coverage.
// Nothing here touches the network or the DB.

import { addDays, CYCLE_DAYS, daysBetween } from "./schedule";

export type AddonBillingRow = {
  status: "active" | "past_due" | "canceled";
  next_charge_on: string;
};

export type AddonAction =
  | { kind: "free"; reason: "already_covered" | "no_subscription" | "cycle_due" }
  | { kind: "blocked"; reason: "past_due" | "canceled" }
  | { kind: "charge"; cycleDate: string; days: number };

// The cycle a mid-cycle addition belongs to.
//
// The cron charges ON next_charge_on for the CYCLE_DAYS that follow, and only
// then advances next_charge_on by CYCLE_DAYS. So at any point between charges,
// the cycle that has been PAID FOR started CYCLE_DAYS before next_charge_on.
// Coverage rows must carry that date, not next_charge_on: filing them against
// next_charge_on would put them in the cycle the cron is about to charge, the
// cron would not see them as covered, and every add-on would be billed twice.
export function currentCycleDate(nextChargeOn: string): string {
  return addDays(nextChargeOn, -CYCLE_DAYS);
}

export function selectAddonAction(args: {
  billingRow: AddonBillingRow | null;
  todayISO: string;
  alreadyCovered: boolean;
}): AddonAction {
  // Checked before the status gate on purpose. Coverage is only ever written
  // by a payment that actually succeeded, so honouring it is not exploitable,
  // and blocking a past_due company from re-activating a vehicle it has
  // already paid for this cycle would be taking money for nothing.
  if (args.alreadyCovered) {
    return { kind: "free", reason: "already_covered" };
  }

  // No row means no subscription, so there is no cycle to pro-rate against.
  // The first 4-weekly charge after a card is added picks up the whole fleet.
  if (!args.billingRow) {
    return { kind: "free", reason: "no_subscription" };
  }

  // A dead or ended subscription must not be able to grow. Same reasoning as
  // blocking on decline: otherwise a company with a dead card adds unlimited
  // vehicles and the debt simply accrues.
  if (args.billingRow.status === "canceled") {
    return { kind: "blocked", reason: "canceled" };
  }
  if (args.billingRow.status === "past_due") {
    return { kind: "blocked", reason: "past_due" };
  }

  const days = daysBetween(args.todayISO, args.billingRow.next_charge_on);

  // The cycle charge is due or overdue and has not run yet. The imminent cron
  // run counts live vehicles, so it will bill this one at full price. Writing
  // coverage here would hand over a free cycle instead.
  if (days <= 0) {
    return { kind: "free", reason: "cycle_due" };
  }

  return {
    kind: "charge",
    cycleDate: currentCycleDate(args.billingRow.next_charge_on),
    days,
  };
}
