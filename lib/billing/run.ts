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
  row: Pick<CompanyBillingRow, "status" | "next_charge_on" | "retry_at" | "retry_count">
): DueAction {
  if (row.status === "canceled") return { kind: "none" };
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
}): ChargeOutcomeUpdate {
  if (args.succeeded) {
    return {
      status: "active",
      next_charge_on: computeNextChargeOn(args.cycleDate),
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
