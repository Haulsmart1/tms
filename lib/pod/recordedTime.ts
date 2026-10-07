/*
  Offline POD saves carry the time the driver acted (the phone's clock). The
  server takes that time only when it is believable: not in the future beyond
  a small clock skew, not older than 72 hours, and inside the shift the item
  names. Otherwise it uses its own receive time and the caller flags the stop
  (pod_flags 'pod_time_untrusted'). Without this, every delivery made with no
  signal would look late; with it unchecked, a wrong phone clock could
  backdate a POD. Pure.
*/

export const MAX_RECORDED_FUTURE_MS = 2 * 60 * 1000;
export const MAX_RECORDED_AGE_MS = 72 * 60 * 60 * 1000;

export type RecordedTimeInput = {
  recordedAt: unknown;
  serverNow: Date;
  /** The shift the item names; null for drivers who are not gated (subcontractors). */
  shift: null | { startedAt: string; endedAt: string | null };
};

export type RecordedTimeDecision = { at: string; trusted: boolean };

export function acceptRecordedTime(input: RecordedTimeInput): RecordedTimeDecision {
  const fallback = { at: input.serverNow.toISOString(), trusted: false };
  if (typeof input.recordedAt !== "string" || input.recordedAt.trim() === "") return fallback;

  const t = Date.parse(input.recordedAt);
  if (Number.isNaN(t)) return fallback;

  const now = input.serverNow.getTime();
  if (t > now + MAX_RECORDED_FUTURE_MS) return fallback;
  if (t < now - MAX_RECORDED_AGE_MS) return fallback;

  if (input.shift) {
    const start = Date.parse(input.shift.startedAt);
    if (Number.isNaN(start) || t < start) return fallback;
    if (input.shift.endedAt !== null) {
      const end = Date.parse(input.shift.endedAt);
      if (Number.isNaN(end) || t > end) return fallback;
    }
  }

  return { at: new Date(t).toISOString(), trusted: true };
}
