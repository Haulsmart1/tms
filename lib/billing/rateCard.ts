// The v2 (period billing) rate card. Integer pence throughout, never floats.
// Nothing here touches the network or the DB.
//
// This does NOT replace lib/billing/money.ts. That file is the v1 rate card
// (graduated per-week bands) and stays live for every company still on
// billing_model = 'v1_immediate'. The two coexist until the last company is
// migrated. See docs/superpowers/specs/2026-09-10-period-billing-design.md.
//
// The shape is different, not just the numbers. v1 prices the Nth vehicle by
// the band N falls in (graduated). v2 discounts the WHOLE fleet at the band the
// fleet size reaches. That is what a customer hears in "20% off at 20
// vehicles", and it is why the cap below has to exist.

import { roundHalfUpDiv } from "./pence";

/**
 * Length of one billing period, and the denominator every proration divides
 * by, so a day always costs 1/28 of the rate.
 *
 * Deliberately NOT derived from v1's CYCLE_DAYS, which is
 * WEEKS_PER_CYCLE x 7 and describes how long four weeks of a per-WEEK rate
 * last. This is a per-PERIOD rate, and the two facts are independent even
 * though both are 28 today. Deriving one from the other would mean changing
 * v1's cycle length silently reprices v2 while PERIOD_VEHICLE_PENCE stays put.
 *
 * A period shortened by cancellation caps how many days can be billed. It does
 * NOT change this denominator: cancelling on day 11 must cost eleven days,
 * not a full period.
 */
export const PERIOD_DAYS = 28;

/** Full price of one vehicle for one 28-day period, before any discount. */
export const PERIOD_VEHICLE_PENCE = 6450;

/**
 * Floor on a period's net total. Exactly two vehicles at the headline rate, so
 * "GBP 129 minimum" and "first two vehicles included" describe the same offer
 * and vehicle three costs the full rate under either reading.
 *
 * Applied by the close job against the whole prorated invoice, NOT here: this
 * module prices a fleet, and a fleet of one really does price at GBP 64.50.
 */
export const PERIOD_MINIMUM_PENCE = 12900;

export type DiscountBand = {
  /** Smallest fleet size that reaches this band. */
  readonly threshold: number;
  /** Percent off the whole fleet, not off the vehicles above the threshold. */
  readonly discountPercent: number;
};

/**
 * A whole-fleet discount can only step so far at a threshold before the fleet
 * gets CHEAPER by growing. The extra vehicle at the threshold has to pay for
 * the discount the whole fleet just gained:
 *
 *     (T - 1) x (1 - d_before)  <=  T x (1 - d_after)
 *
 * Counter-intuitively the constraint tightens as the threshold rises, because
 * one more vehicle is a smaller share of a bigger fleet. Solving it for a
 * ten-point step gives T <= 9, so "10% at 10 then 20% at 20" cannot be made
 * monotonic at ANY threshold above nine, and moving the 20% higher makes it
 * worse rather than better. That is why 15 exists: it splits the jump into two
 * steps that each fit.
 *
 * 10% at 10 is the largest possible first step, which is why the tenth vehicle
 * comes free. 15% at 15 then rises properly, and the residual cap falls on 19.
 * No integer percentage makes both 15 and 20 rise strictly: that needs a value
 * between 15.79% and 16%, so one free vehicle is unavoidable and this picks
 * which. Anything steeper anywhere and the cap silently starts flattening
 * whole stretches of the curve, which is what it is there to make safe rather
 * than to make invisible.
 */
export const DISCOUNT_BANDS: readonly DiscountBand[] = [
  { threshold: 1, discountPercent: 0 },
  { threshold: 10, discountPercent: 10 },
  { threshold: 15, discountPercent: 15 },
  { threshold: 20, discountPercent: 20 },
  { threshold: 30, discountPercent: 22 },
];

/**
 * What a fleet of `vehicleCount` costs for one full period, net of VAT, before
 * the minimum is applied.
 *
 * THE CAP IS THE WHOLE TRICK. Applying each band's discount directly is not
 * monotonic: 19 vehicles at 10% off is 110295 while 20 at 20% off is 103200, so
 * the bill would FALL by GBP 70.95 when a customer added their 20th vehicle,
 * and a 20-vehicle fleet would cost the same as an 18-vehicle one. A customer
 * who can cut their bill by adding a vehicle will add phantom ones, and a
 * 19-vehicle customer is simply overcharged relative to their larger neighbour.
 * lib/billing/money.ts carries the same warning about the v1 bands, where the
 * answer was to keep them graduated.
 *
 * Here the answer is to let a fleet buy any band it likes by pretending to be
 * that band's threshold, and charge it the cheapest of those options:
 *
 *     price(N) = min over bands B of ( max(N, threshold_B) x rate x (1 - d_B) )
 *
 * Every term is non-decreasing in N, so their minimum is non-decreasing too.
 * Monotonicity is therefore a property of the formula rather than something the
 * chosen numbers happen to satisfy, and it survives a future reprice. The test
 * asserts it across 0 to 200 vehicles anyway, because "survives a reprice" is
 * exactly the claim worth failing loudly.
 *
 * The visible consequence is that fleets just under a threshold pay the
 * threshold price: 18, 19 and 20 vehicles all cost GBP 1032.00. That is
 * intended. It is the honest form of the promise, and it fails toward the
 * customer.
 */
export function fleetPeriodPence(vehicleCount: number): number {
  if (!Number.isInteger(vehicleCount) || vehicleCount < 0) {
    throw new Error(
      `vehicleCount must be a non-negative integer, got ${vehicleCount}`
    );
  }

  // Guarded before the min, not folded into it. Every band has a threshold of
  // at least 1, so max(0, threshold) would price an empty fleet as one vehicle.
  if (vehicleCount === 0) return 0;

  return Math.min(
    ...DISCOUNT_BANDS.map((band) =>
      roundHalfUpDiv(
        Math.max(vehicleCount, band.threshold) *
          PERIOD_VEHICLE_PENCE *
          (100 - band.discountPercent),
        100
      )
    )
  );
}
