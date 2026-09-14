/*
  Retry policy for the driver GPS tracker (review POD-16).

  A dropped signal, a 5xx or a rate limit must not end tracking for the rest
  of the shift. Positions recorded while the send fails are queued (bounded,
  oldest dropped first) and flushed when the connection returns. Only answers
  that retrying cannot fix end the watch: signed out, forbidden, or no usable
  vehicle assignment.
*/

export type LocationFailureAction =
  /** Keep watching, keep the position queued, try again after a backoff. */
  | "retry"
  /** Keep watching, discard this one position (the server rejected its content). */
  | "drop"
  /** End tracking and tell the driver why. */
  | "stop";

/** `status` is the HTTP status, or null when the request never got an answer. */
export function classifyLocationFailure(status: number | null): LocationFailureAction {
  if (status === null) return "retry";
  if (status === 401 || status === 403 || status === 409) return "stop";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  if (status >= 400) return "drop";
  return "retry";
}

export const GPS_BACKOFF_BASE_MS = 5_000;
export const GPS_BACKOFF_MAX_MS = 120_000;

export function nextBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(0, Math.min(Math.trunc(attempt), 16));
  return Math.min(GPS_BACKOFF_BASE_MS * 2 ** safeAttempt, GPS_BACKOFF_MAX_MS);
}

export const GPS_QUEUE_MAX = 40;

export function enqueuePosition<T>(queue: readonly T[], item: T, max = GPS_QUEUE_MAX): T[] {
  const next = [...queue, item];
  const limit = Math.max(1, max);
  return next.length > limit ? next.slice(next.length - limit) : next;
}
