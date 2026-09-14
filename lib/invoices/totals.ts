/*
  Outstanding and overdue invoice totals (INV-11).

  The Invoices page KPIs used to be summed in the browser from whatever the
  list endpoint returned, which PostgREST silently caps. The invoices list
  route now pages through EVERY matching invoice and accumulates these totals
  server-side, so the KPIs are complete however many invoices a tenant has.

  Outstanding: a positive balance on an invoice that is not void, credited,
  cancelled or a draft. Overdue: outstanding and past its due date in the
  operator's calendar day (lib/invoices/dates.ts isOverdue).

  Money is summed in integer pence so a long list cannot drift.
*/

import { isOverdue } from "./dates";
import { toPence } from "./money";

export const NOT_OUTSTANDING_INVOICE_STATUSES = ["void", "credited", "cancelled", "draft"] as const;

export type InvoiceTotalsRow = {
  status: string | null;
  due_date: string | null;
  balance_due: unknown;
};

export type InvoiceTotals = {
  openCount: number;
  outstandingTotal: number;
  overdueCount: number;
  overdueTotal: number;
};

export type InvoiceTotalsAccumulator = {
  openCount: number;
  outstandingPence: number;
  overdueCount: number;
  overduePence: number;
};

export function emptyInvoiceTotals(): InvoiceTotalsAccumulator {
  return { openCount: 0, outstandingPence: 0, overdueCount: 0, overduePence: 0 };
}

export function isOutstandingInvoice(row: InvoiceTotalsRow): boolean {
  const status = String(row.status ?? "").trim().toLowerCase();
  if (!status || (NOT_OUTSTANDING_INVOICE_STATUSES as readonly string[]).includes(status)) return false;
  return toPence(row.balance_due) > 0;
}

/** Adds one page of rows to the running totals (mutates and returns `totals`). */
export function addInvoiceTotals(
  totals: InvoiceTotalsAccumulator,
  rows: readonly InvoiceTotalsRow[],
  today: string,
): InvoiceTotalsAccumulator {
  for (const row of rows) {
    if (!isOutstandingInvoice(row)) continue;
    const pence = toPence(row.balance_due);
    totals.openCount += 1;
    totals.outstandingPence += pence;
    if (isOverdue(row.due_date, today)) {
      totals.overdueCount += 1;
      totals.overduePence += pence;
    }
  }
  return totals;
}

export function finishInvoiceTotals(totals: InvoiceTotalsAccumulator): InvoiceTotals {
  return {
    openCount: totals.openCount,
    outstandingTotal: totals.outstandingPence / 100,
    overdueCount: totals.overdueCount,
    overdueTotal: totals.overduePence / 100,
  };
}

export function computeInvoiceTotals(rows: readonly InvoiceTotalsRow[], today: string): InvoiceTotals {
  return finishInvoiceTotals(addInvoiceTotals(emptyInvoiceTotals(), rows, today));
}
