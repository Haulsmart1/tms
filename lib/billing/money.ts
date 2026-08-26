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
