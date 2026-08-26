// Billing calendar maths. Dates are YYYY-MM-DD strings; "today" is always the
// Europe/London calendar date, because billing days are business days in the
// UK, not UTC days.

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

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month. UTC avoids DST.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(dateISO: string, days: number): string {
  const { year, month, day } = parseISO(dateISO);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Next cycle: one calendar month after the cycle just charged, on the anchor
// day, clamped to the target month's length. Computed from anchor_day (not
// from the possibly-clamped cycle date) so a 31 anchor bounces back to the
// 31st after a short month.
export function computeNextChargeOn(cycleDate: string, anchorDay: number): string {
  const { year, month } = parseISO(cycleDate);
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const day = Math.min(anchorDay, daysInMonth(nextYear, nextMonth));
  return `${nextYear}-${pad(nextMonth)}-${pad(day)}`;
}

// After failedAttempt attempts have failed, when is the next try? Two days per
// failed attempt from the cycle date puts attempts on days 1, 3, 5 and 7.
// Null means dunning is exhausted and the company goes past_due.
// Precondition: failedAttempt >= 1 (attempt numbers start at 1).
export function nextRetryOn(cycleDate: string, failedAttempt: number): string | null {
  if (failedAttempt >= MAX_ATTEMPTS) return null;
  return addDays(cycleDate, 2 * failedAttempt);
}
