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
