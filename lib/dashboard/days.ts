/*
  Operator-day and invoice-status rules shared by /dashboard and /stats
  (review SET-14).

  "Today" is the operator's calendar day from lib/time.ts (operatorDay), not
  new Date().toISOString(), which is the UTC date and still yesterday
  between 00:00 and 01:00 BST. Day keys are plain YYYY-MM-DD strings, so the
  revenue chart and its query cut-off agree on which days they mean.
*/

import type { RevenueDay } from "./aggregate";

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The `count` calendar days ending on `todayKey`, oldest first. */
export function lastNDayKeys(todayKey: string, count: number): string[] {
  const match = DAY_KEY.exec(todayKey);
  if (!match) throw new RangeError(`Invalid day key: ${todayKey}`);
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
  }
  return keys;
}

export function buildRevenueForDays(
  paidInvoices: { issueDate: string; total: number }[],
  dayKeys: readonly string[],
): RevenueDay[] {
  return dayKeys.map((key) => ({
    date: key,
    label: new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    total: paidInvoices
      .filter((invoice) => invoice.issueDate === key)
      .reduce((sum, invoice) => sum + invoice.total, 0),
  }));
}

/*
  Statuses that are never money owed: settled, cancelled out, or not yet
  issued. app/invoices/page.tsx treats void and credited as non-collectable.
  Both spellings of cancelled are listed because nothing constrains the
  column.
*/
export const NON_COLLECTABLE_INVOICE_STATUSES = ["paid", "void", "credited", "cancelled", "canceled", "draft"] as const;

/** For PostgREST: .not("status", "in", NON_COLLECTABLE_STATUS_FILTER) */
export const NON_COLLECTABLE_STATUS_FILTER = `(${NON_COLLECTABLE_INVOICE_STATUSES.join(",")})`;

export function isCollectableInvoiceStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return !(NON_COLLECTABLE_INVOICE_STATUSES as readonly string[]).includes(status.toLowerCase());
}
