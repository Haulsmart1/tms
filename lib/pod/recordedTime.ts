/*
  Offline POD saves carry the time the driver acted (the phone's clock). The
  server takes that time only when it is believable: not in the future beyond
  a small clock skew, not older than 72 hours, inside the shift the item
  names, and not before the job existed (notBefore). Otherwise it uses its
  own receive time and the caller flags the stop (pod_flags
  'pod_time_untrusted'). Without this, every delivery made with no
  signal would look late; with it unchecked, a wrong phone clock could
  backdate a POD. Pure.
*/

export const MAX_RECORDED_FUTURE_MS = 2 * 60 * 1000;
export const MAX_RECORDED_AGE_MS = 72 * 60 * 60 * 1000;

/** ISO 8601 with an explicit offset. Date.parse alone would read "2026-10-07T10:00" as server-local time. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export type RecordedTimeInput = {
  recordedAt: unknown;
  serverNow: Date;
  /** The shift the item names; null for drivers who are not gated (subcontractors). */
  shift: null | { startedAt: string; endedAt: string | null };
  /**
    Earliest believable time, normally the job's created_at: a POD cannot
    predate the job it belongs to. Null or absent means no such bound; an
    unparseable value fails closed (untrusted).
  */
  notBefore?: string | null;
};

export type RecordedTimeDecision = { at: string; trusted: boolean };

export function acceptRecordedTime(input: RecordedTimeInput): RecordedTimeDecision {
  const fallback = { at: input.serverNow.toISOString(), trusted: false };
  if (typeof input.recordedAt !== "string" || !ISO_WITH_OFFSET.test(input.recordedAt)) return fallback;

  const t = Date.parse(input.recordedAt);
  if (Number.isNaN(t)) return fallback;

  const now = input.serverNow.getTime();
  if (t > now + MAX_RECORDED_FUTURE_MS) return fallback;
  if (t < now - MAX_RECORDED_AGE_MS) return fallback;

  if (input.notBefore !== undefined && input.notBefore !== null) {
    const floor = Date.parse(input.notBefore);
    if (Number.isNaN(floor) || t < floor) return fallback;
  }

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

/*
  A trusted recorded time is kept, but a POD that reaches the server long
  after it says it happened is marked for the office (security scan N-4,
  N-5): an honest offline sync and a hand-built backdated request look the
  same, so neither is refused, and both are made visible. 15 minutes clears
  a normal queue retry and a short signal gap.
*/
export const LATE_SYNC_THRESHOLD_MS = 15 * 60 * 1000;

export type PodTimeFlag = "pod_time_untrusted" | "pod_late_sync";

/**
  The job_stops.pod_flags a queued completion carries: pod_time_untrusted
  when server time replaced the phone's, pod_late_sync when a trusted time is
  more than LATE_SYNC_THRESHOLD_MS before the server received it, else none.
*/
export function podTimeFlags(input: { at: string; trusted: boolean; serverNow: Date }): PodTimeFlag[] {
  if (!input.trusted) return ["pod_time_untrusted"];
  const t = Date.parse(input.at);
  if (Number.isNaN(t)) return ["pod_time_untrusted"];
  return input.serverNow.getTime() - t > LATE_SYNC_THRESHOLD_MS ? ["pod_late_sync"] : [];
}
