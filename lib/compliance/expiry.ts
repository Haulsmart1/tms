/* Moved verbatim out of app/subcontractors (compliance.tsx and types.ts). The
   reason for the move is not DRY: vitest.config.ts includes tests under lib/
   only, so nothing under app/ can carry a unit test. This is date-boundary
   arithmetic at days 0, 7 and 30 that shipped with no test anywhere; living in
   lib/ is what makes expiry.test.ts possible.

   NOT lib/planning/compliance.ts, which is a different concept: that one is a
   driver's tacho/CPC readiness to be dispatched. This is document expiry dates
   on subcontractors and vehicles. */

export type ComplianceLevel = "ok" | "amber" | "red";

export type ComplianceResult = {
  level: ComplianceLevel;
  label: string;
  days: number | null;
};

export function getCompliance(expiry: string | null): ComplianceResult {
  if (!expiry) {
    return {
      level: "amber",
      label: "DATE NEEDED",
      days: null,
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  /* KNOWN BUG, deliberately not fixed here: this millisecond delta is a whole
     number of days plus or minus an hour whenever the two dates straddle a BST
     transition, and Math.ceil turns that hour into a whole extra day. Warnings
     fire a day late across the autumn change. Reproduction, blast radius and
     the reasoning for leaving it are in
     docs/superpowers/specs/2026-09-03-loading-skeletons-batch-2-design.md.

     The shape of a fix: lib/planning/compliance.ts takes the operator day as a
     `today: string` and compares calendar days as strings, which sidesteps the
     arithmetic entirely. */
  const expiryDate = new Date(`${expiry}T00:00:00`);
  const days = Math.ceil((expiryDate.getTime() - today.getTime()) / 86_400_000);

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
