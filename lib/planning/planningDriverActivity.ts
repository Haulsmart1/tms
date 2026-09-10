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
} from "../time";

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

function parseLocalDay(value: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new RangeError(`Invalid local calendar day: ${value}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function addCalendarDays(value: string, days: number): string {
  const parsed = parseLocalDay(value);

  const date = new Date(
    Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day + days
    )
  );

  return date.toISOString().slice(0, 10);
}

function localWeekday(value: string): number {
  const parsed = parseLocalDay(value);

  return new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day)
  ).getUTCDay();
}

function zonedParts(
  instant: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
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

function zonedMidnight(value: string, timeZone: string): Date {
  const target = parseLocalDay(value);

  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day
  );

  let candidate = targetAsUtc;

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = zonedParts(new Date(candidate), timeZone);

    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );

    const offset = representedAsUtc - candidate;
    const next = targetAsUtc - offset;

    if (next === candidate) {
      break;
    }

    candidate = next;
  }

  const result = new Date(candidate);

  if (!Number.isFinite(result.getTime())) {
    throw new RangeError(
      `Unable to resolve ${value} in timezone ${timeZone}`
    );
  }

  return result;
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

  const localDay = operatorDayInTimeZone(
    planningStart,
    timeZone
  );

  const weekday = localWeekday(localDay);
  const daysSinceMonday = (weekday + 6) % 7;

  const currentWeekLocalStart = addCalendarDays(
    localDay,
    -daysSinceMonday
  );

  const previousWeekLocalStart = addCalendarDays(
    currentWeekLocalStart,
    -7
  );

  const historyLocalStart = addCalendarDays(
    previousWeekLocalStart,
    -HISTORY_BUFFER_DAYS
  );

  return {
    historyCoverageStart: zonedMidnight(
      historyLocalStart,
      timeZone
    ),
    previousWeekStart: zonedMidnight(
      previousWeekLocalStart,
      timeZone
    ),
    currentWeekStart: zonedMidnight(
      currentWeekLocalStart,
      timeZone
    ),
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

    const result = normalizeDriverActivity(raw, timeZone);

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
    previousWeekStart: boundaries.previousWeekStart,
    currentWeekStart: boundaries.currentWeekStart,
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
