/*
  What the customer actually saw when they accepted a quotation (INV-4).

  The share page computes a hash of the prices and lines it rendered and
  sends it with the accept POST. The route recomputes the hash from the
  database and refuses when they differ, so a customer with a stale tab
  cannot accept a price the operator has since changed. The same snapshot
  (as JSON) is passed to the acceptance RPC in prodfix_50, which compares it
  to the locked rows and stores it on the immutable acceptance record.

  Numbers are canonicalised through Number() so "1.50" from PostgREST and 1.5
  hash identically.
*/

import { createHash } from "crypto";

export type AcceptanceSnapshotLine = {
  id: string;
  line_number: number;
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
  line_total: string;
};

export type AcceptanceSnapshot = {
  currency_code: string;
  subtotal: string;
  vat_total: string;
  total: string;
  lines: AcceptanceSnapshotLine[];
};

type QuotationLike = {
  currency_code?: unknown;
  subtotal?: unknown;
  vat_total?: unknown;
  total?: unknown;
  quotation_lines?: unknown;
};

function canonicalNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "0";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric) : "0";
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function buildAcceptanceSnapshot(quotation: QuotationLike): AcceptanceSnapshot {
  const rawLines = Array.isArray(quotation.quotation_lines) ? quotation.quotation_lines : [];

  const lines = rawLines
    .filter((line): line is Record<string, unknown> => typeof line === "object" && line !== null)
    .map((line) => ({
      id: text(line.id),
      line_number: Number.isFinite(Number(line.line_number)) ? Number(line.line_number) : 0,
      description: text(line.description),
      quantity: canonicalNumber(line.quantity),
      unit_price: canonicalNumber(line.unit_price),
      vat_rate: canonicalNumber(line.vat_rate),
      line_total: canonicalNumber(line.line_total),
    }))
    .sort((a, b) => a.line_number - b.line_number || a.id.localeCompare(b.id));

  return {
    currency_code: text(quotation.currency_code || "GBP").toUpperCase(),
    subtotal: canonicalNumber(quotation.subtotal),
    vat_total: canonicalNumber(quotation.vat_total),
    total: canonicalNumber(quotation.total),
    lines,
  };
}

/** sha256 hex of the snapshot. Object keys are built in a fixed order above. */
export function hashAcceptanceSnapshot(snapshot: AcceptanceSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}
