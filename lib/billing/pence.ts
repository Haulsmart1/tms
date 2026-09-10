// Integer money arithmetic. Shared by the v2 rate card and the invoice line
// proration, which must round identically or a fleet's lines stop summing to
// the rate card total.

/**
 * Divide two non-negative integers, rounding halves away from zero.
 *
 * Written out rather than `Math.round(a / b)` because that computes the
 * quotient as a float first. At the magnitudes billing deals in today the
 * float is exact, so this is about the rule rather than a live bug: money
 * never goes through a float in this codebase, and a helper that quietly does
 * is the one place a future larger amount would start disagreeing with
 * Postgres.
 *
 * Half-up rather than half-even. Banker's rounding is the better choice when
 * many roundings are summed and bias matters, but an invoice line is rounded
 * once and shown to a customer, and half-up is what a customer checking the
 * arithmetic by hand will do.
 */
export function roundHalfUpDiv(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || numerator < 0) {
    throw new Error(
      `numerator must be a non-negative integer, got ${numerator}`
    );
  }
  if (!Number.isInteger(denominator) || denominator <= 0) {
    throw new Error(
      `denominator must be a positive integer, got ${denominator}`
    );
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}
