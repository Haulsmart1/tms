// The one VAT rate platform billing charges, and the one way to apply it.
// Review findings BILL2-19 and BILL1-15.
//
// Before this, v1 read VAT_RATE from money.ts, the period code read
// `settings.vat_rate ?? 20` from a column company_billing does not have (so it
// was always 20), and the activate route and the quote each recomputed VAT
// with their own inline formula. All correct today and all silently wrong the
// day the rate changes in one place. Client-safe: no I/O.

import { roundHalfUpDiv } from "./pence";

/** UK standard rate, percent. */
export const VAT_RATE_PERCENT = 20;

/** VAT on a net amount, rounded half up to the penny. */
export function vatOnNetPence(
  netPence: number,
  ratePercent: number = VAT_RATE_PERCENT
): number {
  return roundHalfUpDiv(netPence * ratePercent, 100);
}
