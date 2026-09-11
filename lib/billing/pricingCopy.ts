// The single source for every public pricing string.
//
// Six surfaces display pricing: the landing page card, the landing page meta
// description, the landing page JSON-LD, the licences page, the super-admin
// billing page and the settings billing page. Five of them used to hardcode
// what the sixth computed, which is why they could disagree. Everything here
// derives from ./rateCard, so a reprice moves the copy instead of leaving it
// stale in five places.
//
// v2 (v2_period) ONLY. v1's graduated weekly bands are a different pricing
// shape and live in ./money.ts. Do not add v1 strings here; see CLAUDE.md.

import {
  DISCOUNT_BANDS,
  PERIOD_DAYS,
  PERIOD_MINIMUM_PENCE,
  PERIOD_VEHICLE_PENCE,
} from "./rateCard";
import { formatPence } from "./format";

/**
 * How many vehicles the minimum already pays for at the headline rate.
 *
 * This is what lets the public copy say "your first 2 vehicles included"
 * instead of "£129 minimum". They are arithmetically the same offer, and the
 * first is the honest way to lead with a floor: a customer reading "minimum"
 * hears a penalty, and a customer reading "included" hears what they get. It
 * is derived rather than written as 2 so that repricing either number keeps
 * the sentence true.
 */
export function includedVehicleCount(): number {
  return Math.floor(PERIOD_MINIMUM_PENCE / PERIOD_VEHICLE_PENCE);
}

export type PricingHeadline = {
  /** The lowest amount anyone actually pays, which is the real entry price. */
  fromPence: number;
  fromLabel: string;
  perVehiclePence: number;
  perVehicleLabel: string;
  periodDays: number;
  includedVehicles: number;
  summary: string;
};

/**
 * The entry price leads with the MINIMUM, not the per-vehicle rate.
 *
 * The floor exists to select for customers who can afford the product, and
 * that selection has to happen on the pricing page rather than after signup. A
 * customer who works out the floor once they are onboarded costs a refund and
 * a bad conversation; one who works it out on the pricing page costs nothing.
 */
export function pricingHeadline(): PricingHeadline {
  const includedVehicles = includedVehicleCount();
  return {
    fromPence: PERIOD_MINIMUM_PENCE,
    fromLabel: formatPence(PERIOD_MINIMUM_PENCE),
    perVehiclePence: PERIOD_VEHICLE_PENCE,
    perVehicleLabel: formatPence(PERIOD_VEHICLE_PENCE),
    periodDays: PERIOD_DAYS,
    includedVehicles,
    summary:
      `From ${formatPence(PERIOD_MINIMUM_PENCE)} per ${PERIOD_DAYS} days, ` +
      `including your first ${includedVehicles} vehicles.`,
  };
}

export type PricingBandRow = {
  threshold: number;
  discountPercent: number;
  label: string;
  discountLabel: string;
};

/**
 * The volume bands as a customer should read them.
 *
 * WHOLE FLEET, not marginal. v1's bands were graduated, so its copy had to say
 * "vehicles 51+" to avoid implying a 50-vehicle fleet paid £5 across the
 * board. v2 inverts that: the discount genuinely applies to every vehicle, so
 * "10% off your whole fleet" is the accurate phrasing and the v1 wording would
 * now understate the offer.
 *
 * The 0% base band is dropped. It is real in the rate card and meaningless on
 * a pricing page, where "0% off" advertises a discount that is not one.
 */
export function pricingBandRows(): PricingBandRow[] {
  return DISCOUNT_BANDS.filter((band) => band.discountPercent > 0).map(
    (band) => ({
      threshold: band.threshold,
      discountPercent: band.discountPercent,
      label: `${band.threshold} or more vehicles`,
      discountLabel: `${band.discountPercent}% off your whole fleet`,
    })
  );
}

/**
 * How and when the money is taken.
 *
 * v2 bills in ARREARS: the period is computed and charged when it closes. The
 * v1 copy this replaces said "charged every 4 weeks", which describes charging
 * in advance and is the opposite billing direction.
 */
export const BILLING_BASIS_SENTENCE =
  `Billed at the end of each ${PERIOD_DAYS}-day period, for the days each ` +
  `vehicle was licensed. Excludes VAT.`;

/**
 * The consequence of the discount cap, stated plainly.
 *
 * `fleetPeriodPence` prices a fleet at the cheapest band it could buy by
 * pretending to be that band's threshold, which is what makes the curve
 * monotonic. The visible effect is that 19 vehicles and 20 vehicles both cost
 * £1,032.00. That fails toward the customer and is better said than
 * discovered on an invoice.
 */
export const THRESHOLD_PARITY_SENTENCE =
  "A fleet just below a discount threshold pays the threshold price, so " +
  "growing never costs you more.";
