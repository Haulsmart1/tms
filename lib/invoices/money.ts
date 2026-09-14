/*
  Money arithmetic for quotation and invoice screens (INV-13, INV-10).

  Why not plain floats: most decimal prices have no exact binary form, so
  1.005 * 100 is 100.49999999999999 and Math.round gives 100 pence where
  Postgres round(1.005, 2) gives 1.01. The quotation form also summed
  unrounded floats, so its on-screen total could differ by a penny from the
  saved row and the PDF. Every value here is converted from its shortest
  decimal string into scaled integers, multiplied exactly, and rounded once
  to whole pence.

  Rounding rule, per line:
    net   = round(quantity * unit price)           to the penny
    vat   = round(net * vat rate / 100)            to the penny, on the ROUNDED net
    gross = net + vat
  Totals are sums of the rounded line values, never re-rounded.
  Halves round away from zero, which is what Postgres round(numeric, 2) does.

  ASSUMPTION: this mirrors the per-line convention the credit-note draft in
  app/invoices/page.tsx already used. recalculate_quotation_totals and
  recalculate_invoice_totals are not in the repo; if the live functions round
  differently, change this file and the pinned cases in money.test.ts together.
*/

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);

/* Beyond this a value is not a plausible money figure and loses integer
   precision as a JS number. */
const MAX_ABS_VALUE = 1e13;

type Scaled = { units: bigint; scale: number };

function pow10(exponent: number): bigint {
  let result = ONE;
  for (let i = 0; i < exponent; i += 1) result *= TEN;
  return result;
}

function toScaled(value: unknown): Scaled | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const numeric = typeof value === "number" ? value : Number(String(value).trim());

  if (!Number.isFinite(numeric) || Math.abs(numeric) > MAX_ABS_VALUE) return null;

  /* String(n) is the shortest decimal that round-trips, e.g. "33.335".
     Tiny values print in exponent form, which toFixed expands. */
  let text = String(numeric);
  if (/e/i.test(text)) text = numeric.toFixed(12);

  const negative = text.startsWith("-");
  if (negative) text = text.slice(1);

  const [whole, fraction = ""] = text.split(".");
  const units = BigInt(`${whole}${fraction}`);

  return { units: negative ? -units : units, scale: fraction.length };
}

function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < ZERO !== denominator < ZERO;
  const n = numerator < ZERO ? -numerator : numerator;
  const d = denominator < ZERO ? -denominator : denominator;
  const quotient = (n * TWO + d) / (d * TWO);
  return negative ? -quotient : quotient;
}

/** A money value rounded to whole pence. Non-numeric input is 0. */
export function toPence(value: unknown): number {
  const scaled = toScaled(value);
  if (!scaled) return 0;
  return Number(divideRoundHalfAwayFromZero(scaled.units * HUNDRED, pow10(scaled.scale)));
}

export function penceToAmount(pence: number): number {
  return pence / 100;
}

/** Rounds a money value to 2dp with the same rule as the line maths. */
export function roundMoney(value: unknown): number {
  return penceToAmount(toPence(value));
}

export type LineAmounts = {
  netPence: number;
  vatPence: number;
  grossPence: number;
  net: number;
  vat: number;
  gross: number;
};

export function calculateLineAmounts(quantity: unknown, unitPrice: unknown, vatRate: unknown): LineAmounts {
  const q = toScaled(quantity);
  const p = toScaled(unitPrice);
  const r = toScaled(vatRate) ?? { units: ZERO, scale: 0 };

  let netPence = ZERO;

  if (q && p) {
    netPence = divideRoundHalfAwayFromZero(q.units * p.units * HUNDRED, pow10(q.scale + p.scale));
  }

  const vatPence = divideRoundHalfAwayFromZero(netPence * r.units, HUNDRED * pow10(r.scale));
  const grossPence = netPence + vatPence;

  return {
    netPence: Number(netPence),
    vatPence: Number(vatPence),
    grossPence: Number(grossPence),
    net: penceToAmount(Number(netPence)),
    vat: penceToAmount(Number(vatPence)),
    gross: penceToAmount(Number(grossPence)),
  };
}

export type MoneyTotals = {
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  subtotal: number;
  vat: number;
  total: number;
};

export function calculateTotals(
  lines: Array<{ quantity: unknown; unitPrice: unknown; vatRate: unknown }>
): MoneyTotals {
  let subtotalPence = 0;
  let vatPence = 0;

  for (const line of lines) {
    const amounts = calculateLineAmounts(line.quantity, line.unitPrice, line.vatRate);
    subtotalPence += amounts.netPence;
    vatPence += amounts.vatPence;
  }

  const totalPence = subtotalPence + vatPence;

  return {
    subtotalPence,
    vatPence,
    totalPence,
    subtotal: penceToAmount(subtotalPence),
    vat: penceToAmount(vatPence),
    total: penceToAmount(totalPence),
  };
}

/**
  How much of a receipt to allocate to an invoice (INV-10): never more than
  the invoice's outstanding balance, never negative. The rest stays on the
  customer's account as unallocated cash.
*/
export function splitPaymentAllocation(
  paymentAmount: unknown,
  balanceDue: unknown
): { allocate: number; unallocated: number; allocatePence: number; unallocatedPence: number } {
  const paymentPence = Math.max(0, toPence(paymentAmount));
  const balancePence = Math.max(0, toPence(balanceDue));
  const allocatePence = Math.min(paymentPence, balancePence);
  const unallocatedPence = paymentPence - allocatePence;

  return {
    allocate: penceToAmount(allocatePence),
    unallocated: penceToAmount(unallocatedPence),
    allocatePence,
    unallocatedPence,
  };
}
