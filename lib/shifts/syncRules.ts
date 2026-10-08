/*
  Rules for events that arrive from the phone's offline queue. The legal record
  is when something happened (occurredAt), not when it reached the server, so
  late and out-of-order events are ACCEPTED and flagged for the office, never
  silently corrected. Only a time in the future is refused.

  delayed_sync (security scan S-6) marks any event that reached the server
  more than 15 minutes after its recorded time, the same threshold as a POD's
  pod_late_sync, so a check dated before driving began is visible to the
  office. late_sync (over 72 hours) replaces it for very old events.
*/

import { LATE_SYNC_THRESHOLD_MS } from "../pod/recordedTime";

export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
export const LATE_SYNC_MS = 72 * 60 * 60_000;
export const DELAYED_SYNC_MS = LATE_SYNC_THRESHOLD_MS;

export type EventFlag = "late_sync" | "delayed_sync" | "out_of_order";

export function occurrenceCheck(input: {
  occurredAt: string;
  receivedAt: Date;
  previousOccurredAt: string | null;
}): { ok: true; flags: EventFlag[] } | { ok: false; error: string } {
  const t = Date.parse(input.occurredAt);
  if (!Number.isFinite(t)) return { ok: false, error: "The event time is not a valid date." };
  const received = input.receivedAt.getTime();
  if (t > received + MAX_FUTURE_SKEW_MS) return { ok: false, error: "The event time is in the future. Check the phone's clock." };

  const flags: EventFlag[] = [];
  if (received - t > LATE_SYNC_MS) flags.push("late_sync");
  else if (received - t > DELAYED_SYNC_MS) flags.push("delayed_sync");
  if (input.previousOccurredAt !== null && t < Date.parse(input.previousOccurredAt)) flags.push("out_of_order");
  return { ok: true, flags };
}

/** An office correction to a field wins over a late driver event for the same field. */
export function correctedFieldPolicy(correctedFields: ReadonlySet<string>, field: string): "apply" | "attach_flagged" {
  return correctedFields.has(field) ? "attach_flagged" : "apply";
}
