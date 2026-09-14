// Authorisation for the billing cron. Review findings BILL1-4 and BILL1-11.
//
// Server-only (node:crypto), pure otherwise, and unit tested.
//
// Two distinct failures used to look identical. A request with the wrong
// secret and a deployment with NO secret both answered 401, so a production
// environment missing CRON_SECRET ran for weeks with no renewals, no period
// closes and no dunning while every log line looked like routine noise. A
// missing secret is a configuration outage and is now reported as one.
//
// The comparison is constant-time. Both sides are hashed first so the buffers
// always have equal length, which timingSafeEqual requires, and so the length
// of the real secret is not observable either.

import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuthResult = "ok" | "unauthorized" | "misconfigured";

export function checkCronAuthorization(
  secret: string | undefined | null,
  authorizationHeader: string | null | undefined
): CronAuthResult {
  if (!secret || secret.trim().length === 0) return "misconfigured";

  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const received = createHash("sha256")
    .update(authorizationHeader ?? "")
    .digest();

  return timingSafeEqual(expected, received) ? "ok" : "unauthorized";
}

/**
 * Whether a run that started at `startedAtMs` may begin another unit of work.
 *
 * BILL1-7. Vercel kills the function at maxDuration, and a kill in the middle
 * of a Square call leaves that payment's outcome unrecorded. Stopping new work
 * once the budget is spent leaves the remainder for tomorrow's run, which the
 * due queries pick up unchanged.
 */
export function withinBudget(
  startedAtMs: number,
  nowMs: number,
  budgetMs: number
): boolean {
  return nowMs - startedAtMs < budgetMs;
}
