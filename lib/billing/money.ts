// Platform subscription pricing. All amounts are integer pence, never floats.

export const NET_PENCE_PER_VEHICLE = 1000; // GBP 10.00
export const VAT_RATE = 20; // percent

export type ChargeAmounts = {
  vehicleCount: number;
  netPence: number;
  vatPence: number;
  grossPence: number;
  vatRate: number;
};

export function computeChargeAmounts(vehicleCount: number): ChargeAmounts {
  if (!Number.isInteger(vehicleCount) || vehicleCount < 0) {
    throw new Error(
      `vehicleCount must be a non-negative integer, got ${vehicleCount}`
    );
  }
  const netPence = vehicleCount * NET_PENCE_PER_VEHICLE;
  const vatPence = Math.round((netPence * VAT_RATE) / 100);
  return {
    vehicleCount,
    netPence,
    vatPence,
    grossPence: netPence + vatPence,
    vatRate: VAT_RATE,
  };
}

// One key per (company, cycle, attempt): a crashed-and-rerun cron reuses the
// same key, so Square deduplicates and a double charge is impossible.
export function chargeIdempotencyKey(
  companyId: string,
  cycleDate: string,
  attempt: number
): string {
  return `chg_${companyId}_${cycleDate}_${attempt}`;
}
