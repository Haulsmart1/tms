/*
  Rules for events that arrive from the phone's offline queue. The legal record
  is when something happened (occurredAt), not when it reached the server, so
  late and out-of-order events are ACCEPTED and flagged for the office, never
  silently corrected. Only a time in the future is refused.
*/

export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
export const LATE_SYNC_MS = 72 * 60 * 60_000;

export type EventFlag = "late_sync" | "out_of_order";

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
  if (input.previousOccurredAt !== null && t < Date.parse(input.previousOccurredAt)) flags.push("out_of_order");
  return { ok: true, flags };
}

/** An office correction to a field wins over a late driver event for the same field. */
export function correctedFieldPolicy(correctedFields: ReadonlySet<string>, field: string): "apply" | "attach_flagged" {
  return correctedFields.has(field) ? "attach_flagged" : "apply";
}
