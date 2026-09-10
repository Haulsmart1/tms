// Proration for one vehicle's invoice line. Integer pence, London calendar
// days, no network and no DB.
//
// This is the v2 counterpart to lib/billing/prorata.ts, which prorates a v1
// mid-cycle add-on charge over the days REMAINING in a running cycle at the
// marginal rate of a graduated band. Do not reach for that one here: it
// answers a different question (what does one more vehicle cost right now)
// with a different rate card.

import { PERIOD_DAYS } from "./rateCard";
import { roundHalfUpDiv } from "./pence";
import { daysBetween } from "./schedule";

export type ProrateLineInput = {
  /** Period start, inclusive. YYYY-MM-DD, Europe/London. */
  periodStartISO: string;
  /** Period end, EXCLUSIVE. The day a period closes belongs to the next one. */
  periodEndISO: string;
  /** First day this vehicle is billable, after grace. Clamped to the period. */
  coverageStartISO: string;
  /** Full-period price of one vehicle, before volume discount and VAT. */
  unitAmountPence: number;
  /** Floor on billed days. 1 disables it; see rule 6 in the brief. */
  minBillDays: number;
};

export type ProratedLine = {
  /** Days actually covered. Reported unrounded so the invoice can be honest. */
  actualDays: number;
  /** Days charged for, after the minimum and the period-length cap. */
  billableDays: number;
  amountPence: number;
};

/**
 * Days are whole London calendar days and the end is exclusive, so a vehicle
 * covering 21 March to 18 April is billed 28 days and neither the 18th nor a
 * period boundary is ever billed twice. If both the closing and the opening
 * period counted the boundary day, every customer would pay 13 extra days a
 * year.
 *
 * The day of activation counts in full. Coverage arrives here as a date, so
 * the rounding-up of a partial first day has already happened by construction;
 * a licence activated at 23:00 on the 17th yields a coverage date of the 17th
 * and buys that whole day.
 */
export function prorateLine(input: ProrateLineInput): ProratedLine {
  const {
    periodStartISO,
    periodEndISO,
    coverageStartISO,
    unitAmountPence,
    minBillDays,
  } = input;

  if (!Number.isInteger(unitAmountPence) || unitAmountPence < 0) {
    throw new Error(
      `unitAmountPence must be a non-negative integer, got ${unitAmountPence}`
    );
  }
  if (!Number.isInteger(minBillDays) || minBillDays < 0) {
    throw new Error(
      `minBillDays must be a non-negative integer, got ${minBillDays}`
    );
  }

  const daysInPeriod = daysBetween(periodStartISO, periodEndISO);
  if (daysInPeriod <= 0) {
    throw new Error(
      `periodEndISO must be after periodStartISO, got ${periodStartISO} to ${periodEndISO}`
    );
  }

  // ISO dates compare correctly as strings, which is why billing dates are
  // YYYY-MM-DD rather than timestamps. Same technique as selectAddonAction.
  const clampedStartISO =
    coverageStartISO < periodStartISO ? periodStartISO : coverageStartISO;

  // Negative when coverage starts at or after the period end, which is a
  // vehicle still inside its grace window. Floored at zero so it produces no
  // charge rather than a credit.
  const actualDays = Math.max(
    0,
    Math.min(daysBetween(clampedStartISO, periodEndISO), daysInPeriod)
  );

  // The minimum is a floor on REAL coverage, not a way to bill a vehicle that
  // was never present. Without the zero check a vehicle entirely inside grace
  // would be charged minBillDays for being absent, which is the opposite of
  // what a grace window is for.
  //
  // Capped at the period length so a vehicle added on the last day can never
  // cost more than one present throughout, including when cancellation has
  // cut the period short.
  const billableDays =
    actualDays === 0
      ? 0
      : Math.min(Math.max(actualDays, minBillDays), daysInPeriod);

  return {
    actualDays,
    billableDays,
    // PERIOD_DAYS, not daysInPeriod. A day costs 1/28 of the rate whatever
    // happened to the period, so cancelling on day 11 costs eleven days
    // rather than a whole period's money for eleven days of service.
    amountPence: roundHalfUpDiv(unitAmountPence * billableDays, PERIOD_DAYS),
  };
}
