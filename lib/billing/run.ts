// Pure decision core of the billing cron. The route fetches rows, calls
// selectDueAction, performs the Square charge, then persists
// applyChargeOutcome. Nothing here touches the network or the DB.

import { computeNextChargeOn, nextRetryOn } from "./schedule";

export type CompanyBillingRow = {
  company_id: string;
  status: "active" | "past_due" | "canceled";
  next_charge_on: string;
  retry_at: string | null;
  retry_count: number;
};

export type DueAction =
  | { kind: "none" }
  | { kind: "charge"; cycleDate: string; attempt: number };

export function selectDueAction(
  row: CompanyBillingRow,
  todayISO: string
): DueAction {
  // past_due halts dunning AND new cycles: debt must not stack on a dead card.
  if (row.status === "canceled" || row.status === "past_due") {
    return { kind: "none" };
  }
  if (row.retry_at !== null) {
    if (row.retry_at <= todayISO) {
      return {
        kind: "charge",
        cycleDate: row.next_charge_on,
        attempt: row.retry_count + 1,
      };
    }
    return { kind: "none" };
  }
  if (row.next_charge_on <= todayISO) {
    return { kind: "charge", cycleDate: row.next_charge_on, attempt: 1 };
  }
  return { kind: "none" };
}

// When a new card is stored, is there an outstanding cycle to retry right now?
// past_due or mid-dunning means yes (attempt numbers simply keep counting past
// MAX_ATTEMPTS: the DB constraint allows any attempt >= 1). canceled and
// clean-active companies have nothing to retry.
export function selectRecoveryAction(
  row: Pick<CompanyBillingRow, "status" | "next_charge_on" | "retry_at" | "retry_count"> & {
    billing_model?: string | null;
  }
): DueAction {
  if (row.status === "canceled") return { kind: "none" };
  // Everything below is v1 dunning: it retries a cycle keyed on next_charge_on.
  // A v2 company can be past_due too (closeDuePeriods sets it when period
  // dunning runs out), but its debt is an unpaid period, which the period's own
  // retry ladder collects on the daily cron. Answering "charge" here would send
  // it through runChargeCycle at v1 prices. Missing means v1, matching the
  // column default in billing_06.
  if (row.billing_model === "v2_period") return { kind: "none" };
  if (row.status === "past_due" || row.retry_at !== null) {
    return {
      kind: "charge",
      cycleDate: row.next_charge_on,
      attempt: row.retry_count + 1,
    };
  }
  return { kind: "none" };
}

export type ChargeOutcomeUpdate = {
  status: "active" | "past_due";
  next_charge_on: string;
  retry_at: string | null;
  retry_count: number;
};

export function applyChargeOutcome(args: {
  row: Pick<CompanyBillingRow, "next_charge_on">;
  cycleDate: string;
  attempt: number;
  succeeded: boolean;
  /**
   * London today. When given, a successful charge for a cycle that is already
   * over does not schedule the next one in the past. BILL1-6.
   */
  todayISO?: string;
}): ChargeOutcomeUpdate {
  if (args.succeeded) {
    // BILL1-6. A company recovering from months past_due (or a cron that was
    // down) used to be charged one missed cycle per DAY until caught up, each
    // at today's fleet size. The outstanding cycle is collected once; the next
    // cycle then starts today, so exactly one further charge follows, dated
    // today, and the cycles in between are not invented. Same shape as the v2
    // rule that suspended time is not billed.
    const next = computeNextChargeOn(args.cycleDate);
    return {
      status: "active",
      next_charge_on:
        args.todayISO !== undefined && next < args.todayISO
          ? args.todayISO
          : next,
      retry_at: null,
      retry_count: 0,
    };
  }
  const retryOn = nextRetryOn(args.cycleDate, args.attempt);
  if (retryOn === null) {
    return {
      status: "past_due",
      next_charge_on: args.row.next_charge_on,
      retry_at: null,
      retry_count: args.attempt,
    };
  }
  return {
    status: "active",
    next_charge_on: args.row.next_charge_on,
    retry_at: retryOn,
    retry_count: args.attempt,
  };
}
