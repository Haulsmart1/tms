// Pure decision core for a mid-cycle vehicle addition. The route loads rows,
// calls selectAddonAction, performs the Square charge, then writes coverage.
// Nothing here touches the network or the DB.

import { addDays, CYCLE_DAYS, daysBetween } from "./schedule";

export type AddonBillingRow = {
  status: "active" | "past_due" | "canceled";
  next_charge_on: string;
  retry_at: string | null;
};

export type AddonAction =
  | { kind: "free"; reason: "already_covered" | "no_subscription" | "cycle_due" }
  | { kind: "blocked"; reason: "past_due" | "canceled" | "dunning" | "inactive_subscription" }
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
  // and blocking a company from re-activating a vehicle it has already paid
  // for this cycle would be taking money for nothing.
  //
  // But coverage only vouches for a cycle that is still RUNNING. Once
  // next_charge_on is at or before today, the cycle it names has elapsed, and
  // for a past_due company that date is frozen forever (selectDueAction
  // returns none once the dunning ladder is exhausted, so next_charge_on
  // never moves again). Without the date check, currentCycleDate would keep
  // naming that same elapsed cycle and the whole last-paid fleet would read
  // as covered, letting a past_due company deactivate and reactivate it
  // indefinitely for free with the status gates below never firing. A healthy
  // company always has next_charge_on in the future, so this costs them
  // nothing.
  if (
    args.alreadyCovered &&
    args.billingRow !== null &&
    args.todayISO < args.billingRow.next_charge_on
  ) {
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
  // Fails CLOSED on anything outside the union. The union is a compile-time
  // claim about a runtime column, so a future status (paused, trialing) or a
  // NULL would otherwise fall through every check below and charge the card.
  if (args.billingRow.status !== "active") {
    return { kind: "blocked", reason: "inactive_subscription" };
  }

  // Mid-dunning: a cycle charge has already FAILED and is waiting to retry.
  // applyChargeOutcome leaves status "active" and next_charge_on unchanged in
  // that state, so status alone reads as healthy while the card is actively
  // failing. Without this check such a company falls through to the cycle_due
  // branch below and adds vehicles free for the whole dunning window, and if
  // dunning then exhausts that cycle is never charged at all, so the vehicles
  // ride free for a full cycle. retry_at is the cron's own health signal;
  // agreeing with selectDueAction here is the point.
  if (args.billingRow.retry_at !== null) {
    return { kind: "blocked", reason: "dunning" };
  }

  const days = daysBetween(args.todayISO, args.billingRow.next_charge_on);

  // The cycle charge is due or overdue and has not run yet. If it succeeds,
  // the imminent cron run bills this vehicle at full price, so writing
  // coverage here would hand over a free cycle instead. If it fails instead,
  // that is caught above by the retry_at check on the next call, not here.
  if (days <= 0) {
    return { kind: "free", reason: "cycle_due" };
  }

  return {
    kind: "charge",
    cycleDate: currentCycleDate(args.billingRow.next_charge_on),
    days,
  };
}
