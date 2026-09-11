// View model for the v2 billing page.
//
// app/settings/billing/V2Billing.tsx renders what this returns and decides
// nothing itself. vitest covers lib/ and not app/, so a decision made in the
// component is a decision nothing asserts.

import { daysBetween } from "./schedule";
import { formatPence } from "./format";

/**
 * One line as /api/billing/preview returns it.
 *
 * The wire contract, NOT a copy of invoice.ts's AssembledLine. The route
 * projects into this shape deliberately rather than serialising the internal
 * type, so a field added to AssembledLine later does not silently become
 * public. Keep the two in step by hand: they are separated on purpose.
 */
export type PreviewLine = {
  kind: "vehicle" | "volume_discount" | "minimum_adjustment";
  vehicleId: string | null;
  vrnNormalised: string | null;
  coverageStartISO: string | null;
  coverageEndISO: string | null;
  actualDays: number;
  billableDays: number;
  unitAmountPence: number;
  netPence: number;
  includedInPlan: boolean;
  description: string;
};

export type PeriodProgress = {
  /** 1 on the first day. */
  dayOfPeriod: number;
  totalDays: number;
  daysRemaining: number;
  label: string;
};

/**
 * Where today falls inside the open period.
 *
 * Clamped at both ends. A period whose end has arrived but which the nightly
 * cron has not yet closed is a normal state that can last most of a day, and
 * "Day 31 of 28" reads as a fault when nothing is wrong.
 *
 * totalDays comes from the stored period_end rather than PERIOD_DAYS, because
 * cancellation cuts a period short and a cancelled period is exactly when
 * someone will be reading this page closely.
 */
export function periodProgress(args: {
  periodStartISO: string;
  /** Exclusive, matching billing_periods.period_end. */
  periodEndISO: string;
  todayISO: string;
}): PeriodProgress {
  const totalDays = Math.max(
    1,
    daysBetween(args.periodStartISO, args.periodEndISO)
  );
  const elapsed = daysBetween(args.periodStartISO, args.todayISO);
  const dayOfPeriod = Math.min(Math.max(elapsed + 1, 1), totalDays);
  return {
    dayOfPeriod,
    totalDays,
    daysRemaining: totalDays - dayOfPeriod,
    label: `Day ${dayOfPeriod} of ${totalDays}`,
  };
}

/**
 * Why the total is what it is, in one sentence, or null when only the vehicle
 * lines are involved.
 *
 * Derived from the lines the invoice actually produced rather than recomputed
 * from the fleet size, so the sentence and the figures beside it cannot
 * disagree. That matters most where they would diverge: a capped fleet is
 * priced by a band it does not nominally sit in, so a sentence written from
 * the vehicle count would quote a percentage the amount does not match.
 *
 * The minimum counts as binding only when its adjustment line is strictly
 * positive. At exactly two vehicles the fleet price EQUALS the GBP 129
 * minimum, assembleInvoice raises no adjustment, and "the minimum applies"
 * would be true of the number and false of the bill.
 */
export function pricingExplanation(args: {
  lines: readonly PreviewLine[];
  vehicleCount: number;
  minimumPence: number;
  discountPercent: number;
}): string | null {
  const minimum = args.lines.find((line) => line.kind === "minimum_adjustment");
  if (minimum && minimum.netPence > 0) {
    const fleetPence = args.lines
      .filter((line) => line.kind !== "minimum_adjustment")
      .reduce((total, line) => total + line.netPence, 0);
    const vehicles =
      args.vehicleCount === 1 ? "1 vehicle" : `${args.vehicleCount} vehicles`;
    return (
      `The ${formatPence(args.minimumPence)} minimum exceeds your ` +
      `${vehicles} at ${formatPence(fleetPence)}, so the minimum applies.`
    );
  }

  const discount = args.lines.find((line) => line.kind === "volume_discount");
  if (discount && discount.netPence < 0) {
    return (
      `${args.discountPercent}% off your whole fleet, saving ` +
      `${formatPence(Math.abs(discount.netPence))}.`
    );
  }

  return null;
}

/**
 * Why a v2 company can have no open period.
 *
 * Every one of these is a legitimate state that the activation route reports
 * as ok:true with no charge, which is indistinguishable from success in a UI
 * that does not say so out loud. This list is the SQL diagnostic from the
 * 2026-09-10 handoff, moved into the product so the page answers the question
 * instead of the reader querying for it.
 *
 * "A period was already open" is deliberately NOT here: it is a cause of an
 * unexpected zero charge, but it cannot be a cause of a MISSING period. It is
 * explained on the open-period view instead.
 */
export const NO_PERIOD_REASONS: readonly string[] = [
  "The licence was not ticked as active for billing. An inactive licence is a compliance record and costs nothing.",
  "The vehicle is already billable through another active licence. Billing is per vehicle, not per licence, and one vehicle can hold several.",
  "This company is not on period billing after all. Check billing_model on company_billing.",
];

/**
 * Why adding a vehicle to an OPEN period takes no money.
 *
 * The other half of the same confusion. v2 bills in arrears, so a mid-period
 * addition is an insert that moves nothing until the period closes. A customer
 * who expects the v1 behaviour reads that silence as a failure.
 */
export const MID_PERIOD_ADDITION_NOTE =
  "Adding a vehicle mid-period takes no payment. It is billed for the days it " +
  "was licensed when this period closes.";
