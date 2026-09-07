// Pro-rata pricing for a vehicle added part way through a billing cycle.
// Integer pence throughout, like money.ts. Nothing here touches the network
// or the DB.

import { VAT_RATE, weeklyNetPence } from "./money";
import { CYCLE_DAYS } from "./schedule";

// The cost of ONE more vehicle on top of a fleet of `baselineCount`.
//
// Bands are graduated, so this is NOT simply the rate of the band the new
// vehicle lands in read off PRICE_TIERS: it is the difference between the
// whole-fleet weekly price before and after. Deriving it from weeklyNetPence
// rather than walking PRICE_TIERS a second time is the same discipline that
// weeklyNetPence itself follows over tierBreakdown, and for the same reason:
// two copies of the pricing rules would eventually disagree, and the customer
// would be quoted one number and charged another.
export function marginalWeeklyPence(baselineCount: number): number {
  if (!Number.isInteger(baselineCount) || baselineCount < 0) {
    throw new Error(
      `baselineCount must be a non-negative integer, got ${baselineCount}`
    );
  }
  return weeklyNetPence(baselineCount + 1) - weeklyNetPence(baselineCount);
}

export type AddonAmounts = {
  /** Fleet size the new vehicle was priced on top of. */
  baselineCount: number;
  /** Weekly cost of this one extra vehicle, before VAT. */
  marginalWeeklyPence: number;
  /** Days of the current cycle this charge covers. */
  days: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  vatRate: number;
};

// Pro-rate the marginal weekly rate over the days left in the cycle. Never
// more than one cycle: a longer span would mean the caller computed the cycle
// boundary wrongly, and silently charging for it would overbill.
export function computeAddonAmounts(
  baselineCount: number,
  days: number
): AddonAmounts {
  if (!Number.isInteger(days) || days < 0 || days > CYCLE_DAYS) {
    throw new Error(
      `days must be an integer between 0 and ${CYCLE_DAYS}, got ${days}`
    );
  }
  const marginal = marginalWeeklyPence(baselineCount);
  const netPence = Math.round((marginal * days) / 7);
  const vatPence = Math.round((netPence * VAT_RATE) / 100);
  return {
    baselineCount,
    marginalWeeklyPence: marginal,
    days,
    netPence,
    vatPence,
    grossPence: netPence + vatPence,
    vatRate: VAT_RATE,
  };
}
