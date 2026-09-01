import {
  elapsedMilliseconds,
  isValidIanaTimeZone,
  operatorDayInTimeZone,
} from "../time";

export type ComplianceActivityKind =
  | "driving"
  | "other_work"
  | "availability"
  | "break"
  | "rest"
  | "unknown";

export type TransportMode = "ferry" | "train";

export type TransportRestType =
  | "regular_daily"
  | "split_daily"
  | "regular_weekly"
  | "none"
  | "unknown";

export type TransportInterruptionReason =
  | "embark"
  | "disembark"
  | "vehicle_movement"
  | "border"
  | "other";

export type RawDriverActivity = {
  id: string;
  activityType: string;
  activityKind: ComplianceActivityKind | null;
  startTime: string;
  endTime: string;
  durationMinutes?: number | null;
  source?: string | null;
};

export type NormalizedDriverActivity = {
  id: string;
  rawActivityType: string;
  kind: ComplianceActivityKind;
  start: Date;
  end: Date;
  elapsedMilliseconds: number;
  localStartDay: string;
  localEndDay: string;
  source: string | null;
  durationMismatch: boolean;
};

export type NormalizeActivityResult =
  | {
      ok: true;
      activity: NormalizedDriverActivity;
    }
  | {
      ok: false;
      reason: string;
    };

const DURATION_TOLERANCE_MS = 60_000;

const EXPLICIT_TIME_ZONE =
  /(?:Z|[+-](?:0\d|1\d|2[0-3]):[0-5]\d)$/i;

export function parseComplianceTimestamp(value: string): Date {
  const timestamp = value.trim();

  if (!EXPLICIT_TIME_ZONE.test(timestamp)) {
    throw new RangeError(
      "Compliance timestamps must include Z or an explicit UTC offset",
    );
  }

  const parsed = new Date(timestamp);

  if (!Number.isFinite(parsed.getTime())) {
    throw new RangeError(`Invalid compliance timestamp: ${value}`);
  }

  return parsed;
}

export type TransportInterruptionWindow = {
  startTime: string;
  endTime: string;
};

export type TransportEventWindow = {
  boardingTime: string;
  disembarkTime: string;
};

export function validateTransportInterruption(
  event: TransportEventWindow,
  interruption: TransportInterruptionWindow,
): void {
  const boarding = parseComplianceTimestamp(event.boardingTime);
  const disembark = parseComplianceTimestamp(event.disembarkTime);
  const start = parseComplianceTimestamp(interruption.startTime);
  const end = parseComplianceTimestamp(interruption.endTime);

  elapsedMilliseconds(boarding, disembark);
  elapsedMilliseconds(start, end);

  if (
    start.getTime() < boarding.getTime() ||
    end.getTime() > disembark.getTime()
  ) {
    throw new RangeError(
      "Transport interruption must fall within the ferry/train event",
    );
  }
}

export function normalizeDriverActivity(
  raw: RawDriverActivity,
  timeZone: string,
): NormalizeActivityResult {
  if (!isValidIanaTimeZone(timeZone)) {
    return {
      ok: false,
      reason: `Invalid IANA timezone: ${timeZone}`,
    };
  }

  const start = new Date(raw.startTime);
  const end = new Date(raw.endTime);

  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime())
  ) {
    return {
      ok: false,
      reason: "Activity contains an invalid timestamp.",
    };
  }

  let elapsed: number;

  try {
    elapsed = elapsedMilliseconds(start, end);
  } catch {
    return {
      ok: false,
      reason: "Activity end must be after activity start.",
    };
  }

  const importedDurationMs =
    raw.durationMinutes == null
      ? null
      : raw.durationMinutes * 60_000;

  const durationMismatch =
    importedDurationMs !== null &&
    Math.abs(importedDurationMs - elapsed) > DURATION_TOLERANCE_MS;

  return {
    ok: true,
    activity: {
      id: raw.id,
      rawActivityType: raw.activityType,
      kind: raw.activityKind ?? "unknown",
      start,
      end,
      elapsedMilliseconds: elapsed,
      localStartDay: operatorDayInTimeZone(start, timeZone),
      localEndDay: operatorDayInTimeZone(end, timeZone),
      source: raw.source ?? null,
      durationMismatch,
    },
  };
}

export function activitiesOverlap(
  left: NormalizedDriverActivity,
  right: NormalizedDriverActivity,
): boolean {
  return left.start < right.end && right.start < left.end;
}
