/*
  Geocode failure backoff (review PLAN-13).

  A stop whose address was definitely not found is not retried until
  GEOCODE_RETRY_BASE_HOURS have passed, doubling with each further failure and
  capped at a week. Only a definite miss is recorded; an upstream error or
  timeout is not, so an outage never blacklists good addresses.
*/

export const GEOCODE_RETRY_BASE_HOURS = 6;
export const GEOCODE_RETRY_MAX_HOURS = 7 * 24;

export function geocodeRetryAfterHours(attempts: number): number {
  const failures = Math.max(1, Math.floor(Number.isFinite(attempts) ? attempts : 1));
  return Math.min(
    GEOCODE_RETRY_MAX_HOURS,
    GEOCODE_RETRY_BASE_HOURS * 2 ** (failures - 1),
  );
}

export function shouldRetryGeocode(
  failedAt: string | null | undefined,
  attempts: number | null | undefined,
  now: Date,
): boolean {
  if (!failedAt) return true;

  const failedMs = new Date(failedAt).getTime();
  if (!Number.isFinite(failedMs)) return true;

  const waitMs = geocodeRetryAfterHours(attempts ?? 1) * 60 * 60 * 1000;
  return now.getTime() - failedMs >= waitMs;
}
