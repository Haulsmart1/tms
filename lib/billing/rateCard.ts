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

export const DISCOUNT_BANDS: readonly DiscountBand[] = [
  { threshold: 1, discountPercent: 0 },
  { threshold: 10, discountPercent: 10 },
  { threshold: 20, discountPercent: 20 },
  { threshold: 30, discountPercent: 22 },
];

// Round half up on a positive integer division. Written out rather than using
// Math.round(a / b) because that goes through a float, and the whole point of
// this file is that money never does.
function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

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
      roundHalfUp(
        Math.max(vehicleCount, band.threshold) *
          PERIOD_VEHICLE_PENCE *
          (100 - band.discountPercent),
        100
      )
    )
  );
}
