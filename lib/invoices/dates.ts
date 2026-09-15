/*
  Calendar dates for invoices and quotations (INV-15).

  "Today" is the operator's calendar day from lib/time.ts, never
  new Date().toISOString().slice(0, 10), which is the UTC day and is
  yesterday between 00:00 and 01:00 during BST.

  Due dates and validity dates are plain YYYY-MM-DD calendar values, so the
  arithmetic below is done on UTC dates purely as a calendar: no timezone or
  DST change can move the result by a day.

  Cross-area note: lib/time.ts has operatorDay but no date-only add-days
  helper, so it lives here. If one is added to lib/time.ts, switch to it.
*/

import { operatorDay } from "../time";

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The operator's calendar day as YYYY-MM-DD. */
export function operatorToday(now: Date = new Date()): string {
  return operatorDay(now);
}

function parseYmd(value: string): Date | null {
  const match = YMD.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return date;
}

export function isValidYmd(value: unknown): value is string {
  return typeof value === "string" && parseYmd(value) !== null;
}

/** Adds whole calendar days to YYYY-MM-DD. Returns null for invalid input. */
export function addCalendarDays(value: string, days: number): string | null {
  if (!Number.isInteger(days)) return null;

  const date = parseYmd(value);
  if (!date) return null;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** An invoice is overdue from the day AFTER its due date, in the operator's day. */
export function isOverdue(dueDate: string | null | undefined, today: string): boolean {
  if (!dueDate || !isValidYmd(dueDate) || !isValidYmd(today)) return false;
  return dueDate.trim() < today;
}
