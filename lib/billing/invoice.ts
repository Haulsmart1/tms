// Assembles one period's invoice from the vehicles that were billable in it.
// Integer pence, London calendar days, no network and no DB. The close job
// gathers the rows and hands them here; this decides what the customer owes.
//
// Order of operations, which is the whole design:
//
//   1. One line per vehicle, prorated at the FULL rate.
//   2. One volume discount line against their sum.
//   3. One minimum adjustment line if the result is under the floor.
//   4. VAT on the net total.
//
// The discount is not folded into the per-vehicle lines. A whole-fleet
// discount does not divide evenly across them, so folding it in would need a
// largest-remainder allocation, and the resulting per-vehicle amounts would not
// match the rate a customer was quoted. Keeping it as its own line means every
// vehicle line reads at the headline rate, the discount is visible rather than
// buried, and the arithmetic is checkable by hand.

import { fleetDiscountBand, fleetPeriodPence } from "./rateCard";
import { prorateLine } from "./invoiceLine";
import { roundHalfUpDiv } from "./pence";

export type InvoiceVehicle = {
  vehicleId: string;
  /** Carried onto the line for reporting only; billing is at company grain. */
  tenantId: string;
  vrnNormalised: string;
  /** First billable day, after grace. Clamped to the period here. */
  coverageStartISO: string;
};

export type InvoiceLineKind =
  | "vehicle"
  | "volume_discount"
  | "minimum_adjustment";

export type AssembledLine = {
  kind: InvoiceLineKind;
  /** Null on the discount and minimum lines: they belong to no vehicle. */
  vehicleId: string | null;
  tenantId: string | null;
  vrnNormalised: string | null;
  coverageStartISO: string | null;
  coverageEndISO: string | null;
  actualDays: number;
  billableDays: number;
  unitAmountPence: number;
  /** Negative on the discount line. */
  netPence: number;
  description: string;
};

export type AssembleInvoiceInput = {
  periodStartISO: string;
  /** Exclusive. Earlier than a full period when cancellation cut it short. */
  periodEndISO: string;
  vehicles: readonly InvoiceVehicle[];
  minBillDays: number;
  /** Snapshotted onto every line, so a later reprice cannot rewrite history. */
  unitAmountPence: number;
  minimumPence: number;
  vatRatePercent: number;
};

export type AssembledInvoice = {
  lines: AssembledLine[];
  /** Lines that survived, which is the period's high-water mark of vehicles. */
  vehicleCount: number;
  /** Nominal percent of the band that won, for reporting. */
  discountPercent: number;
  /** Sum of the vehicle lines, before discount and minimum. */
  subtotalPence: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
};

export function assembleInvoice(
  input: AssembleInvoiceInput
): AssembledInvoice {
  const {
    periodStartISO,
    periodEndISO,
    vehicles,
    minBillDays,
    unitAmountPence,
    minimumPence,
    vatRatePercent,
  } = input;

  // Rule 5, defended here as well as by the unique index on
  // (billing_period_id, vehicle_id). The close job groups licence rows by
  // vehicle precisely so a vehicle removed and re-added inside one period
  // yields a single line; a duplicate arriving here means that grouping has
  // broken, and silently billing the vehicle twice would also inflate the
  // discount band. Fail loudly instead.
  const seen = new Set<string>();
  for (const vehicle of vehicles) {
    if (seen.has(vehicle.vehicleId)) {
      throw new Error(
        `vehicle ${vehicle.vehicleId} appears twice in one period; the close job must group licences by vehicle`
      );
    }
    seen.add(vehicle.vehicleId);
  }

  const priced = vehicles
    .map((vehicle) => {
      // Clamped before pricing AND before sorting. Two vehicles carried over
      // from the previous period both start at the period start, so they must
      // tie here and be separated by registration rather than by whenever
      // they were originally activated.
      const coverageStartISO =
        vehicle.coverageStartISO < periodStartISO
          ? periodStartISO
          : vehicle.coverageStartISO;

      return {
        vehicle,
        coverageStartISO,
        prorated: prorateLine({
          periodStartISO,
          periodEndISO,
          coverageStartISO,
          unitAmountPence,
          minBillDays,
        }),
      };
    })
    // Rule 3: a vehicle whose grace window outlasts the period produces no
    // line at all. A zero line would still count toward the discount band and
    // pad the invoice with something the customer cannot act on.
    .filter((entry) => entry.prorated.billableDays > 0)
    .sort((a, b) => {
      const byStart = a.coverageStartISO.localeCompare(b.coverageStartISO);
      if (byStart !== 0) return byStart;
      return a.vehicle.vrnNormalised.localeCompare(b.vehicle.vrnNormalised);
    });

  const lines: AssembledLine[] = priced.map((entry) => ({
    kind: "vehicle",
    vehicleId: entry.vehicle.vehicleId,
    tenantId: entry.vehicle.tenantId,
    vrnNormalised: entry.vehicle.vrnNormalised,
    coverageStartISO: entry.coverageStartISO,
    coverageEndISO: periodEndISO,
    actualDays: entry.prorated.actualDays,
    billableDays: entry.prorated.billableDays,
    unitAmountPence,
    netPence: entry.prorated.amountPence,
    description: `${entry.vehicle.vrnNormalised}, ${entry.prorated.billableDays} day${
      entry.prorated.billableDays === 1 ? "" : "s"
    }`,
  }));

  const vehicleCount = lines.length;
  const subtotalPence = lines.reduce((sum, line) => sum + line.netPence, 0);

  // An empty fleet is a dormant company. It gets no invoice at all rather than
  // a minimum charge for nothing, which is the whole reason the billing period
  // is anchored at first vehicle activation.
  if (vehicleCount === 0) {
    return {
      lines: [],
      vehicleCount: 0,
      discountPercent: 0,
      subtotalPence: 0,
      netPence: 0,
      vatPence: 0,
      grossPence: 0,
    };
  }

  const band = fleetDiscountBand(vehicleCount, unitAmountPence);
  let netPence = subtotalPence;

  if (unitAmountPence > 0 && band.discountPercent > 0) {
    // The discount is defined on a FULL period, so it is applied to the
    // prorated subtotal as the ratio between the discounted and undiscounted
    // full-period prices rather than as a bare percentage. That is what makes
    // a fleet present all period land exactly on the rate card, which
    // invoice.test.ts asserts across a dozen fleet sizes, while a part-period
    // fleet is discounted in the same proportion.
    const fullPeriodDiscounted = fleetPeriodPence(vehicleCount, unitAmountPence);
    const fullPeriodUndiscounted = vehicleCount * unitAmountPence;
    const discounted = roundHalfUpDiv(
      subtotalPence * fullPeriodDiscounted,
      fullPeriodUndiscounted
    );

    if (discounted !== subtotalPence) {
      lines.push({
        kind: "volume_discount",
        vehicleId: null,
        tenantId: null,
        vrnNormalised: null,
        coverageStartISO: null,
        coverageEndISO: null,
        actualDays: 0,
        billableDays: 0,
        unitAmountPence: 0,
        netPence: discounted - subtotalPence,
        // Only labelled with a percentage when the fleet has actually reached
        // the band. A capped fleet is priced AS a larger one, so its discount
        // is not that percentage of its own subtotal and printing it would put
        // a number on the line that does not match the amount beside it.
        description:
          vehicleCount >= band.threshold
            ? `Volume discount (${band.discountPercent}%)`
            : `Volume discount (priced at ${band.threshold} vehicles)`,
      });
      netPence = discounted;
    }
  }

  if (netPence < minimumPence) {
    lines.push({
      kind: "minimum_adjustment",
      vehicleId: null,
      tenantId: null,
      vrnNormalised: null,
      coverageStartISO: null,
      coverageEndISO: null,
      actualDays: 0,
      billableDays: 0,
      unitAmountPence: 0,
      netPence: minimumPence - netPence,
      description: "Minimum charge adjustment",
    });
    netPence = minimumPence;
  }

  const vatPence = roundHalfUpDiv(netPence * vatRatePercent, 100);

  return {
    lines,
    vehicleCount,
    discountPercent: band.discountPercent,
    subtotalPence,
    netPence,
    vatPence,
    grossPence: netPence + vatPence,
  };
}
