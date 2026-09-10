// The payment step of period billing, behind an interface so the close job
// does not know about Square. Pure half only: types, the idempotency key and
// the customer-facing note. The Square implementation lives in
// periodPaymentServer.ts.

import { addDays } from "./schedule";

/**
 * A period produces at most two charges, and they are genuinely different
 * things rather than two attempts at one:
 *
 *   minimum  taken UP FRONT when the period opens, at first vehicle
 *            activation or at reactivation after suspension. Proves the card
 *            with a settled payment and reduces credit exposure by the floor.
 *   balance  taken at close, for whatever the period cost ABOVE the minimum
 *            already collected. Often zero for a small fleet, which is why a
 *            two-vehicle company cancelling mid-period gets no final bill.
 */
export type PeriodChargeKind = "minimum" | "balance";

export type PeriodCharge = {
  companyId: string;
  periodId: string;
  kind: PeriodChargeKind;
  /** 1-based. Increments only when a previous attempt actually failed. */
  attempt: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  currency: string;
  periodStartISO: string;
  /** Exclusive. */
  periodEndISO: string;
};

export type PeriodChargeResult =
  | { status: "succeeded"; providerPaymentId: string; receiptUrl: string | null }
  | { status: "failed"; failureCode: string }
  /** Nothing to charge. No provider call was made. */
  | { status: "skipped" };

/**
 * How the close job pays. Implementations must be idempotent on
 * (periodId, kind, attempt): a crash between the provider call and recording
 * the outcome has to replay rather than charge twice.
 */
export interface PeriodPaymentProvider {
  readonly name: string;
  charge(charge: PeriodCharge): Promise<PeriodChargeResult>;
}

/**
 * Records nothing and charges nothing. Used when no payment provider is
 * configured, and by any environment that must not touch a real card.
 *
 * Deliberately reports `skipped` rather than `succeeded`. A no-op that claimed
 * success would mark periods `invoiced` and make an unpaid company look
 * settled, which is the single worst thing a billing stub can do.
 */
export const noopPeriodPaymentProvider: PeriodPaymentProvider = {
  name: "noop",
  async charge() {
    return { status: "skipped" };
  },
};

/**
 * Idempotency key for one period charge.
 *
 * Unlike addonIdempotencyKey this needs no truncation. A period id is already
 * globally unique, so company and date add nothing, and 32 hex characters plus
 * a kind letter and an attempt number sits well inside Square's 45. Truncation
 * is only safe while collisions stay improbable; not truncating removes the
 * question entirely.
 *
 * The attempt number is what lets a retry after a genuine decline send a new
 * key. A retry after a CRASH must reuse the same one, which is why the caller
 * records the attempt before calling the provider.
 */
export function periodChargeIdempotencyKey(
  periodId: string,
  kind: PeriodChargeKind,
  attempt: number
): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`attempt must be an integer >= 1, got ${attempt}`);
  }
  return `${periodId.replace(/-/g, "")}_${kind === "minimum" ? "m" : "b"}${attempt}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDay(dateISO: string): string {
  const [year, month, day] = dateISO.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/**
 * What the customer sees on their statement and receipt.
 *
 * This is part of the request BODY, and Square only replays a reused
 * idempotency key when the body is byte-identical. So it must be derivable
 * from stored values alone: anything computed from "now" would drift between
 * the first call and a replay and be refused with IDEMPOTENCY_KEY_REUSED.
 * That drift is precisely the bug billing_05 was written to fix on the add-on
 * path, and the fix here is to have nothing that can drift.
 *
 * The date shown is the last day COVERED, one before the exclusive end. A
 * receipt reading "to 18 Apr" for a period that stops covering them on the
 * 18th is a dispute waiting to happen.
 */
export function periodChargeNote(
  kind: PeriodChargeKind,
  periodStartISO: string,
  periodEndISO: string
): string {
  const span = `${formatDay(periodStartISO)} to ${formatDay(addDays(periodEndISO, -1))}`;
  return kind === "minimum"
    ? `TMS Wizzard minimum charge, ${span}`
    : `TMS Wizzard, ${span}`;
}
