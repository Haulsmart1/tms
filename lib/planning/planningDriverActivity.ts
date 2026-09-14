import {
  normalizeDriverActivity,
  type ComplianceActivityKind,
  type RawDriverActivity,
} from "./activity";
import {
  buildDriverHoursState,
  type DriverHoursState,
} from "./driverHoursState";
import {
  isValidIanaTimeZone,
  operatorDayInTimeZone,
  resolveTimeZone,
  utcRegulationWeekStart,
} from "../time";

const DAY_MS = 24 * 60 * 60 * 1000;

export const PLANNING_DRIVER_ACTIVITY_ROW_LIMIT = 5000;

const HISTORY_BUFFER_DAYS = 7;

export type PlanningDriverActivityRow = {
  id: string;
  driver_id: string;
  activity_type: string | null;
  activity_kind: ComplianceActivityKind | null;
  start_time: string;
  end_time: string;
  duration_minutes: number | null;
};

export type PlanningDriverHoursBoundaries = {
  historyCoverageStart: Date;
  previousWeekStart: Date;
  currentWeekStart: Date;
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
};

type LocalDateTimeParts = LocalDateParts & {
  hour: number;
  minute: number;
  second: number;
};

function parseLocalDay(value: string): LocalDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new RangeError(`Invalid local calendar day: ${value}`);
  }

  const result = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };

  const validation = new Date(
    Date.UTC(
      result.year,
      result.month - 1,
      result.day
    )
  );

  if (
    validation.getUTCFullYear() !== result.year ||
    validation.getUTCMonth() !== result.month - 1 ||
    validation.getUTCDate() !== result.day
  ) {
    throw new RangeError(`Invalid local calendar day: ${value}`);
  }

  return result;
}

function parseLocalTime(
  value: string | null
): {
  hour: number;
  minute: number;
  second: number;
} | null {
  if (!value) {
    return null;
  }

  const match =
    /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
      value.trim()
    );

  if (!match) {
    return null;
  }

  const result = {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] ?? "0"),
  };

  if (
    result.hour < 0 ||
    result.hour > 23 ||
    result.minute < 0 ||
    result.minute > 59 ||
    result.second < 0 ||
    result.second > 59
  ) {
    return null;
  }

  return result;
}

function zonedParts(
  instant: Date,
  timeZone: string
): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const values = new Map(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
}

function sameLocalDateTime(
  left: LocalDateTimeParts,
  right: LocalDateTimeParts
): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

/**
 * Resolve a local wall-clock date/time into an absolute instant.
 *
 * A DST gap has no valid result and returns null.
 * A DST overlap has two valid instants; the earlier occurrence is selected.
 */
function resolveZonedDateTime(
  target: LocalDateTimeParts,
  timeZone: string
): Date | null {
  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second
  );

  let candidate = targetAsUtc;

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const represented = zonedParts(
      new Date(candidate),
      timeZone
    );

    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second
    );

    const offset = representedAsUtc - candidate;
    const next = targetAsUtc - offset;

    if (next === candidate) {
      break;
    }

    candidate = next;
  }

  /*
   * Search around the calculated instant in 15-minute offset increments.
   * This covers modern IANA zones whose offsets use whole, half or
   * quarter-hours, and lets us deliberately choose the earlier occurrence
   * during an overlap.
   */
  const matches: number[] = [];

  for (
    let offsetMinutes = -180;
    offsetMinutes <= 180;
    offsetMinutes += 15
  ) {
    const instantMs =
      candidate + offsetMinutes * 60 * 1000;

    const parts = zonedParts(
      new Date(instantMs),
      timeZone
    );

    if (sameLocalDateTime(parts, target)) {
      matches.push(instantMs);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  return new Date(Math.min(...matches));
}

/**
 * Turn the selected Planning day plus the driver's configured normal start
 * time into the absolute scheduling instant in the operator timezone.
 *
 * normal_start_time is a planning preference. It is not evidence of actual
 * driver work or rest.
 */
export function planningStartForLocalDate(
  localDate: string,
  normalStartTime: string | null,
  timeZone: string
): Date | null {
  if (!isValidIanaTimeZone(timeZone)) {
    return null;
  }

  let day: LocalDateParts;

  try {
    day = parseLocalDay(localDate);
  } catch {
    return null;
  }

  const time = parseLocalTime(normalStartTime);

  if (!time) {
    return null;
  }

  return resolveZonedDateTime(
    {
      ...day,
      ...time,
    },
    timeZone
  );
}

export type PlanningStartIssue =
  | "invalid_time_zone"
  | "invalid_date"
  | "missing_start_time"
  | "clock_change_gap";

/**
 * Why planningStartForLocalDate returned null, so the page can say the right
 * thing (review PLAN-20). A start time inside the spring-forward gap (for
 * example 01:30 on the last Sunday of March in London) is a real, valid
 * driver setting that simply does not exist on that one day; blaming the
 * driver profile for it is wrong.
 */
export function planningStartIssue(
  localDate: string,
  normalStartTime: string | null,
  timeZone: string
): PlanningStartIssue | null {
  if (!isValidIanaTimeZone(timeZone)) {
    return "invalid_time_zone";
  }

  let day: LocalDateParts;

  try {
    day = parseLocalDay(localDate);
  } catch {
    return "invalid_date";
  }

  const time = parseLocalTime(normalStartTime);

  if (!time) {
    return "missing_start_time";
  }

  return resolveZonedDateTime({ ...day, ...time }, timeZone)
    ? null
    : "clock_change_gap";
}

export type PlanningHoursInstant =
  | {
      /** Hours can be evaluated as at `instant`, which has already happened. */
      kind: "known";
      instant: Date;
      /** True when the planning day is today and the start time has passed. */
      rebasedToNow: boolean;
    }
  | {
      /** The planning start is still in the future, so the hours in between are unknown. */
      kind: "future";
      planningStart: Date;
    };

/**
 * The instant the driver's hours state is evaluated at, and the schedule
 * starts from (review PLAN-2).
 *
 * planningStart is the selected day at the driver's normal start time. When
 * the planner is working on TODAY after that time, the driver may already
 * have driven. Evaluating at planningStart would drop everything recorded
 * since, so an 06:00 start re-planned at 15:00 after 8 h 30 m of driving
 * would show 9 h available. So for today, once the start has passed, the
 * instant is "now": all recorded driving and duty up to now counts, including
 * continuous driving since the last qualifying break, and ETAs start from now.
 *
 * A past day keeps its planned start (a historical view), and a future start
 * is reported as such because the hours between now and then are unknown.
 */
export function planningHoursInstant(
  planningDate: string,
  planningStart: Date,
  now: Date,
  timeZone: string
): PlanningHoursInstant {
  if (planningStart.getTime() > now.getTime()) {
    return { kind: "future", planningStart };
  }

  const today = operatorDayInTimeZone(
    now,
    resolveTimeZone(timeZone).timeZone
  );

  if (planningDate === today) {
    return { kind: "known", instant: new Date(now.getTime()), rebasedToNow: true };
  }

  return { kind: "known", instant: planningStart, rebasedToNow: false };
}


export function planningDriverHoursBoundaries(
  planningStart: Date,
  timeZone: string
): PlanningDriverHoursBoundaries {
  if (!Number.isFinite(planningStart.getTime())) {
    throw new RangeError("Planning start must be a valid date.");
  }

  if (!isValidIanaTimeZone(timeZone)) {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }

  /*
   * Weekly and two-week driving buckets use the UTC regulation week, Monday
   * 00:00 to Sunday 24:00 UTC (EC 561/2006 Art 4(i), as recorded by digital
   * tachographs), not Monday midnight in the operator zone. During BST the
   * local week starts an hour earlier and would count that hour in a
   * different week from enforcement analysis (review PLAN-17). The timezone
   * still governs how local activity rows are read and how times display.
   */
  const currentWeekStart = utcRegulationWeekStart(planningStart);
  const previousWeekStart = new Date(
    currentWeekStart.getTime() - 7 * DAY_MS
  );
  const historyCoverageStart = new Date(
    previousWeekStart.getTime() - HISTORY_BUFFER_DAYS * DAY_MS
  );

  return {
    historyCoverageStart,
    previousWeekStart,
    currentWeekStart,
  };
}

export function buildPlanningDriverHoursState(
  rows: PlanningDriverActivityRow[],
  planningStart: Date,
  timeZone: string
): DriverHoursState {
  const boundaries = planningDriverHoursBoundaries(
    planningStart,
    timeZone
  );

  const normalized = [];
  const normalizationWarnings: string[] = [];

  for (const row of rows) {
    const raw: RawDriverActivity = {
      id: row.id,
      activityType: row.activity_type ?? "unknown",
      activityKind: row.activity_kind,
      startTime: row.start_time,
      endTime: row.end_time,
      durationMinutes: row.duration_minutes,
    };

    const result = normalizeDriverActivity(
      raw,
      timeZone
    );

    if (!result.ok) {
      normalizationWarnings.push(
        `Driver activity ${row.id}: ${result.reason}`
      );
      continue;
    }

    normalized.push(result.activity);
  }

  const state = buildDriverHoursState({
    activities: normalized,
    planningStart,
    historyCoverageStart:
      boundaries.historyCoverageStart,
    previousWeekStart:
      boundaries.previousWeekStart,
    currentWeekStart:
      boundaries.currentWeekStart,

    /*
     * A bounded database query is not itself proof that history started
     * immediately after qualifying rest.
     */
    historyStartsAfterKnownRest: false,
  });

  if (normalizationWarnings.length === 0) {
    return state;
  }

  return {
    ...state,
    complete: false,
    warnings: [
      ...state.warnings,
      ...normalizationWarnings,
    ],
  };
}
