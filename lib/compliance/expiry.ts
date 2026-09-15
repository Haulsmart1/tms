/* Moved verbatim out of app/subcontractors (compliance.tsx and types.ts). The
   reason for the move is not DRY: vitest.config.ts includes tests under lib/
   only, so nothing under app/ can carry a unit test. This is date-boundary
   arithmetic at days 0, 7 and 30 that shipped with no test anywhere; living in
   lib/ is what makes expiry.test.ts possible.

   NOT lib/planning/compliance.ts, which is a different concept: that one is a
   driver's tacho/CPC readiness to be dispatched. This is document expiry dates
   on subcontractors and vehicles. */

import {
  calendarDaysBetween,
  OPERATOR_TIME_ZONE,
  operatorDayInTimeZone,
  todayIsoDateInZone,
} from "../time";

export type ComplianceLevel = "ok" | "amber" | "red";

export type ComplianceResult = {
  level: ComplianceLevel;
  label: string;
  days: number | null;
};

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/* The calendar day an expiry value names, in the operator zone, or null when
   it names none. A bare date is taken as written. A timestamp is an instant,
   so its day is the operator-zone day that instant falls on. Anything else is
   unreadable and must never be reported as valid (review PLAN-19). */
function expiryDay(expiry: string, timeZone: string): string | null {
  const value = expiry.trim();

  if (BARE_DATE.test(value)) {
    return calendarDaysBetween(value, value) === null ? null : value;
  }

  if (TIMESTAMP.test(value)) {
    const instant = new Date(value);
    return Number.isFinite(instant.getTime())
      ? operatorDayInTimeZone(instant, timeZone)
      : null;
  }

  return null;
}

export function getCompliance(
  expiry: string | null,
  now: Date = new Date(),
  timeZone: string = OPERATOR_TIME_ZONE,
): ComplianceResult {
  if (!expiry) {
    return {
      level: "amber",
      label: "DATE NEEDED",
      days: null,
    };
  }

  /* Calendar-day labels compared as labels, not a millisecond delta. The old
     delta was a whole number of days plus or minus an hour whenever the two
     dates straddled a clock change, and Math.ceil turned that hour into an
     extra day, so the 7-day warning fired a day late in autumn (SET-23). */
  const today = todayIsoDateInZone(timeZone, now);
  const day = expiryDay(expiry, timeZone);
  const days = day === null ? null : calendarDaysBetween(today, day);

  if (days === null) {
    return {
      level: "amber",
      label: "DATE INVALID",
      days: null,
    };
  }

  if (days < 0) {
    return {
      level: "red",
      label: `EXPIRED ${Math.abs(days)}d`,
      days,
    };
  }

  if (days <= 7) {
    return {
      level: "red",
      label: days === 0 ? "EXPIRES TODAY" : `NEEDS ATTENTION • ${days}d`,
      days,
    };
  }

  if (days <= 30) {
    return {
      level: "amber",
      label: `EXPIRING SOON • ${days}d`,
      days,
    };
  }

  return {
    level: "ok",
    label: `VALID • ${days}d`,
    days,
  };
}

export function mostUrgent(results: ComplianceResult[]): ComplianceResult {
  /* An empty list has no most-urgent member, so there is no honest value to
     return. This was safe while the function was page-local and every caller
     passed a fixed five, but it is a module API now: say so explicitly rather
     than letting reduce throw an opaque TypeError. */
  if (results.length === 0) {
    throw new Error("mostUrgent requires at least one compliance result");
  }

  const rank: Record<ComplianceLevel, number> = {
    ok: 0,
    amber: 1,
    red: 2,
  };

  return results.reduce((current, next) =>
    rank[next.level] > rank[current.level] ? next : current
  );
}
