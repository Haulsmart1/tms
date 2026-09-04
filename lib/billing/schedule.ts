// Billing calendar maths. Dates are YYYY-MM-DD strings; "today" is always the
// Europe/London calendar date, because billing days are business days in the
// UK, not UTC days.

import { WEEKS_PER_CYCLE } from "./money";

export const MAX_ATTEMPTS = 4;

export function londonDateISO(now: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseISO(dateISO: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateISO.split("-").map(Number);
  return { year, month, day };
}

export function addDays(dateISO: string, days: number): string {
  const { year, month, day } = parseISO(dateISO);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Derived, not a second literal: money.ts bills WEEKS_PER_CYCLE weeks per
// charge, and this is how long that cycle actually lasts. Writing 28 here
// instead would let someone lengthen the cycle in one file while the other
// kept billing 4 weeks, with no test in either file failing and the amount
// charged silently diverging from the period covered.
export const CYCLE_DAYS = WEEKS_PER_CYCLE * 7;

// Cycles are a fixed 4 weeks. There is no anchor day and no month-length
// clamping: every cycle is the same length, the billing weekday never drifts,
// and 13 cycles a year collects all 52 weeks. Billing 4 weeks per CALENDAR
// month would only have collected 48.
export function computeNextChargeOn(cycleDate: string): string {
  return addDays(cycleDate, CYCLE_DAYS);
}

// After failedAttempt attempts have failed, when is the next try? Two days per
// failed attempt from the cycle date puts attempts on days 1, 3, 5 and 7.
// Null means dunning is exhausted and the company goes past_due.
// Precondition: failedAttempt >= 1 (attempt numbers start at 1).
export function nextRetryOn(cycleDate: string, failedAttempt: number): string | null {
  if (failedAttempt >= MAX_ATTEMPTS) return null;
  return addDays(cycleDate, 2 * failedAttempt);
}
