// Period boundaries. Pure; no network, no DB.

import { PERIOD_DAYS } from "./rateCard";
import { addDays } from "./schedule";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PeriodBounds = {
  periodStartISO: string;
  /** Exclusive. */
  periodEndISO: string;
};

/**
 * The period beginning on `startISO`.
 *
 * There is no anchor day and no month-length clamping. Every period is the
 * same 28 days, so thirteen of them collect 52 weeks a year where billing four
 * weeks per calendar month would only have collected 48. That is the decision
 * billing_02 made for v1 cycles and it carries over unchanged.
 *
 * Because the end is exclusive, the next period starts exactly where this one
 * ended: `nextPeriodBounds(previous.periodEndISO)`. Periods therefore abut with
 * no gap (days nobody is billed for) and no overlap (days billed twice), which
 * period.test.ts asserts over a run of three.
 *
 * Validated rather than trusted. A malformed date would reach addDays, parse to
 * NaN, and produce a period ending "NaN-NaN-NaN" that every string comparison
 * downstream would silently order wrongly.
 */
export function nextPeriodBounds(startISO: string): PeriodBounds {
  if (!ISO_DATE.test(startISO)) {
    throw new Error(`period start must be YYYY-MM-DD, got ${startISO}`);
  }
  return {
    periodStartISO: startISO,
    periodEndISO: addDays(startISO, PERIOD_DAYS),
  };
}
