// Platform subscription pricing. All amounts are integer pence, never floats.
//
// The rate is per vehicle per WEEK, collected every 4 weeks (13 cycles a
// year). Billing 4 weeks per calendar month would only collect 48 weeks of
// revenue a year, which is why the cycle is a fixed 28 days rather than a
// calendar month. See lib/billing/schedule.ts.

export const WEEKS_PER_CYCLE = 4;
export const VAT_RATE = 20; // percent

export type PriceTier = {
  /** Inclusive last vehicle position in this band; null means no ceiling. */
  readonly upToVehicle: number | null;
  readonly weeklyPence: number;
};

// GRADUATED bands, not all-units: the Nth vehicle is priced by the band N
// falls in, so the first ten vehicles cost GBP 10 each no matter how large
// the fleet grows. Do not "simplify" this into repricing the whole fleet at
// the band rate: 19 vehicles at GBP 8 is GBP 152/week but 20 at GBP 6 is only
// GBP 120/week, so the bill would FALL when a customer added a vehicle.
// money.test.ts asserts monotonicity to keep that from being reintroduced.
export const PRICE_TIERS: readonly PriceTier[] = [
  { upToVehicle: 10, weeklyPence: 1000 },
  { upToVehicle: 20, weeklyPence: 800 },
  { upToVehicle: 50, weeklyPence: 600 },
  { upToVehicle: null, weeklyPence: 500 },
];

function assertVehicleCount(vehicleCount: number): void {
  if (!Number.isInteger(vehicleCount) || vehicleCount < 0) {
    throw new Error(
      `vehicleCount must be a non-negative integer, got ${vehicleCount}`
    );
  }
}

export type ChargeAmounts = {
  vehicleCount: number;
  /** Whole-fleet net for one week, before VAT. */
  weeklyNetPence: number;
  /** weeklyNetPence spread over the fleet, for "works out at GBP X" copy.
      This is the BLENDED rate, never lower than the marginal band rate.
      Display only: it is rounded, so it does not multiply back to netPence. */
  blendedWeeklyPence: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  vatRate: number;
};

export type TierLine = {
  /** 1-based inclusive vehicle positions this line covers. */
  fromVehicle: number;
  toVehicle: number;
  vehiclesInBand: number;
  weeklyPence: number;
  bandNetPence: number;
};

// One line per band the fleet actually reaches, so the UI can show real
// invoice lines ("Vehicles 11-15 x GBP 8.00/week") instead of a single
// multiplication that is only correct for fleets inside the first band.
export function tierBreakdown(vehicleCount: number): TierLine[] {
  assertVehicleCount(vehicleCount);
  const lines: TierLine[] = [];
  let priced = 0;
  for (const tier of PRICE_TIERS) {
    if (priced >= vehicleCount) break;
    const ceiling = tier.upToVehicle ?? vehicleCount;
    const inBand = Math.min(vehicleCount, ceiling) - priced;
    if (inBand <= 0) continue;
    lines.push({
      fromVehicle: priced + 1,
      toVehicle: priced + inBand,
      vehiclesInBand: inBand,
      weeklyPence: tier.weeklyPence,
      bandNetPence: inBand * tier.weeklyPence,
    });
    priced += inBand;
  }
  return lines;
}

// Derived from tierBreakdown rather than walking PRICE_TIERS a second time:
// if the two ever diverged, the invoice lines shown to a customer would stop
// summing to the amount taken off their card.
export function weeklyNetPence(vehicleCount: number): number {
  return tierBreakdown(vehicleCount).reduce(
    (total, line) => total + line.bandNetPence,
    0
  );
}

export function computeChargeAmounts(vehicleCount: number): ChargeAmounts {
  const weekly = weeklyNetPence(vehicleCount);
  const netPence = weekly * WEEKS_PER_CYCLE;
  // Every band rate is a whole number of pounds and the cycle is 4 weeks, so
  // netPence is always a multiple of 100 and this round is a formality.
  const vatPence = Math.round((netPence * VAT_RATE) / 100);
  return {
    vehicleCount,
    weeklyNetPence: weekly,
    blendedWeeklyPence:
      vehicleCount === 0 ? 0 : Math.round(weekly / vehicleCount),
    netPence,
    vatPence,
    grossPence: netPence + vatPence,
    vatRate: VAT_RATE,
  };
}

// Display formatting for integer pence. No thousands grouping: this matches
// the helper it replaces on /settings/billing, and platform charges are small.
export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

// Square's CreatePayment idempotency_key allows at most 45 characters, so the
// key is compacted: UUID without dashes (32) + date without dashes (8) +
// attempt, joined by underscores. One key per (company, cycle, attempt): a
// crashed-and-rerun cron reuses the same key, so Square deduplicates and a
// double charge is impossible.
export function chargeIdempotencyKey(
  companyId: string,
  cycleDate: string,
  attempt: number
): string {
  const compactCompany = companyId.replace(/-/g, "");
  const compactDate = cycleDate.replace(/-/g, "");
  return `${compactCompany}_${compactDate}_${attempt}`;
}

export type PaymentClassification =
  | { kind: "succeeded" }
  | { kind: "failed"; failureCode: string }
  | { kind: "indeterminate"; status: string };

// COMPLETED is the only success; FAILED and CANCELED are terminal failures
// safe to retry under a new idempotency key. Anything else (PENDING, APPROVED,
// unknown) is not finished: the caller must NOT record an outcome, so the next
// run replays the SAME key and reads the payment's eventual terminal state.
export function classifyPaymentResult(
  payment: { status?: string | null } | undefined
): PaymentClassification {
  if (!payment) {
    return { kind: "failed", failureCode: "NO_PAYMENT_RETURNED" };
  }
  const status = payment.status ?? "NO_STATUS";
  if (status === "COMPLETED") return { kind: "succeeded" };
  if (status === "FAILED" || status === "CANCELED") {
    return { kind: "failed", failureCode: status };
  }
  return { kind: "indeterminate", status };
}
