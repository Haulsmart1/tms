import type {
  ComplianceActivityKind,
  NormalizedDriverActivity,
} from "./activity";

const HOUR_SECONDS = 60 * 60;
const MINUTE_SECONDS = 60;

export const ASSIMILATED_DRIVER_HOURS_LIMITS = Object.freeze({
  maxContinuousDrivingSeconds: 4.5 * HOUR_SECONDS,
  qualifyingBreakSeconds: 45 * MINUTE_SECONDS,
  splitBreakFirstSeconds: 15 * MINUTE_SECONDS,
  splitBreakSecondSeconds: 30 * MINUTE_SECONDS,
  standardDailyDrivingSeconds: 9 * HOUR_SECONDS,
  extendedDailyDrivingSeconds: 10 * HOUR_SECONDS,
  maxExtendedDailyDrivingDaysPerWeek: 2,
  weeklyDrivingSeconds: 56 * HOUR_SECONDS,
  fortnightDrivingSeconds: 90 * HOUR_SECONDS,
  regularDailyRestSeconds: 11 * HOUR_SECONDS,
  reducedDailyRestSeconds: 9 * HOUR_SECONDS,
  regularWeeklyRestSeconds: 45 * HOUR_SECONDS,
  reducedWeeklyRestSeconds: 24 * HOUR_SECONDS,
});

export type DriverHoursHistoryInput = {
  activities: NormalizedDriverActivity[];
  planningStart: Date;
  historyCoverageStart: Date;
  previousWeekStart: Date;
  currentWeekStart: Date;

  /**
   * True only when the caller can prove that historyCoverageStart is itself
   * immediately after a qualifying daily/weekly rest. A bounded database query
   * is not enough evidence on its own.
   */
  historyStartsAfterKnownRest?: boolean;
};

export type DriverHoursState = {
  complete: boolean;
  planningStart: Date;

  currentStateBoundaryKnown: boolean;

  continuousDrivingSeconds: number;
  dailyDrivingSeconds: number;

  previousWeekDrivingSeconds: number;
  currentWeekDrivingSeconds: number;
  fortnightDrivingSeconds: number;

  currentWeekWorkingSeconds: number;

  continuousDrivingRemainingSeconds: number;
  standardDailyDrivingRemainingSeconds: number;
  extendedDailyDrivingRemainingSeconds: number;
  weeklyDrivingRemainingSeconds: number;
  fortnightDrivingRemainingSeconds: number;

  splitBreakFirstPartSatisfied: boolean;
  reducedDailyRestsSinceRegularWeeklyRest: number;

  unknownActivityCount: number;
  durationMismatchCount: number;

  warnings: string[];
};

type ProcessedActivity = {
  id: string;
  kind: ComplianceActivityKind;
  startMs: number;
  endMs: number;
  durationMismatch: boolean;
};

type Interval = {
  startMs: number;
  endMs: number;
};

function finiteDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function secondsBetween(startMs: number, endMs: number): number {
  return Math.max(0, (endMs - startMs) / 1000);
}

function clippedSeconds(
  activity: ProcessedActivity,
  interval: Interval,
): number {
  const start = Math.max(activity.startMs, interval.startMs);
  const end = Math.min(activity.endMs, interval.endMs);

  return end > start ? secondsBetween(start, end) : 0;
}

function isWorkingTime(kind: ComplianceActivityKind): boolean {
  return kind === "driving" || kind === "other_work";
}

function addUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function remaining(limit: number, used: number): number {
  return Math.max(0, limit - used);
}

function normalizeActivities(
  activities: NormalizedDriverActivity[],
  historyStartMs: number,
  planningStartMs: number,
  warnings: string[],
): {
  activities: ProcessedActivity[];
  unknownActivityCount: number;
  durationMismatchCount: number;
  complete: boolean;
} {
  const seenIds = new Set<string>();
  const normalized: ProcessedActivity[] = [];

  let unknownActivityCount = 0;
  let durationMismatchCount = 0;
  let complete = true;

  for (const activity of activities) {
    const startMs = activity.start.getTime();
    const endMs = activity.end.getTime();

    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    ) {
      complete = false;
      addUnique(
        warnings,
        `Driver activity ${activity.id} has invalid timestamps`,
      );
      continue;
    }

    if (seenIds.has(activity.id)) {
      complete = false;
      addUnique(
        warnings,
        `Duplicate driver activity id: ${activity.id}`,
      );
      continue;
    }

    seenIds.add(activity.id);

    if (activity.kind === "unknown") {
      unknownActivityCount += 1;
      complete = false;
    }

    if (activity.durationMismatch) {
      durationMismatchCount += 1;
      complete = false;
    }

    if (
      endMs <= historyStartMs ||
      startMs >= planningStartMs
    ) {
      continue;
    }

    normalized.push({
      id: activity.id,
      kind: activity.kind,
      startMs: Math.max(startMs, historyStartMs),
      endMs: Math.min(endMs, planningStartMs),
      durationMismatch: activity.durationMismatch,
    });
  }

  normalized.sort((left, right) => {
    if (left.startMs !== right.startMs) {
      return left.startMs - right.startMs;
    }

    if (left.endMs !== right.endMs) {
      return left.endMs - right.endMs;
    }

    return left.id.localeCompare(right.id);
  });

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];

    if (current.startMs < previous.endMs) {
      complete = false;
      addUnique(
        warnings,
        `Driver activities overlap: ${previous.id} and ${current.id}`,
      );
    }
  }

  if (unknownActivityCount > 0) {
    addUnique(
      warnings,
      `${unknownActivityCount} driver activity record(s) have unknown activity kind`,
    );
  }

  if (durationMismatchCount > 0) {
    addUnique(
      warnings,
      `${durationMismatchCount} driver activity record(s) have duration mismatches`,
    );
  }

  return {
    activities: normalized,
    unknownActivityCount,
    durationMismatchCount,
    complete,
  };
}

export function buildDriverHoursState(
  input: DriverHoursHistoryInput,
): DriverHoursState {
  const warnings: string[] = [];

  const planningStartMs = input.planningStart.getTime();
  const historyCoverageStartMs =
    input.historyCoverageStart.getTime();
  const previousWeekStartMs =
    input.previousWeekStart.getTime();
  const currentWeekStartMs =
    input.currentWeekStart.getTime();

  if (
    [
      input.planningStart,
      input.historyCoverageStart,
      input.previousWeekStart,
      input.currentWeekStart,
    ].some((value) => !finiteDate(value))
  ) {
    throw new RangeError(
      "Driver-hours history boundaries must contain valid dates.",
    );
  }

  if (
    !(
      historyCoverageStartMs <= previousWeekStartMs &&
      previousWeekStartMs < currentWeekStartMs &&
      currentWeekStartMs <= planningStartMs
    )
  ) {
    throw new RangeError(
      "Driver-hours history boundaries are not chronologically valid.",
    );
  }

  const normalized = normalizeActivities(
    input.activities,
    historyCoverageStartMs,
    planningStartMs,
    warnings,
  );

  let complete = normalized.complete;

  const previousWeek: Interval = {
    startMs: previousWeekStartMs,
    endMs: currentWeekStartMs,
  };

  const currentWeek: Interval = {
    startMs: currentWeekStartMs,
    endMs: planningStartMs,
  };

  let previousWeekDrivingSeconds = 0;
  let currentWeekDrivingSeconds = 0;
  let currentWeekWorkingSeconds = 0;

  for (const activity of normalized.activities) {
    if (activity.kind === "driving") {
      previousWeekDrivingSeconds += clippedSeconds(
        activity,
        previousWeek,
      );

      currentWeekDrivingSeconds += clippedSeconds(
        activity,
        currentWeek,
      );
    }

    if (isWorkingTime(activity.kind)) {
      currentWeekWorkingSeconds += clippedSeconds(
        activity,
        currentWeek,
      );
    }
  }

  let currentStateBoundaryKnown =
    input.historyStartsAfterKnownRest === true;

  let continuousDrivingSeconds = 0;
  let dailyDrivingSeconds = 0;
  let splitBreakFirstPartSatisfied = false;

  let reducedDailyRestsSinceRegularWeeklyRest = 0;

  for (const activity of normalized.activities) {
    const durationSeconds = secondsBetween(
      activity.startMs,
      activity.endMs,
    );

    switch (activity.kind) {
      case "driving":
        continuousDrivingSeconds += durationSeconds;
        dailyDrivingSeconds += durationSeconds;
        break;

      case "break":
        if (
          durationSeconds >=
          ASSIMILATED_DRIVER_HOURS_LIMITS.qualifyingBreakSeconds
        ) {
          continuousDrivingSeconds = 0;
          splitBreakFirstPartSatisfied = false;
          break;
        }

        if (
          splitBreakFirstPartSatisfied &&
          durationSeconds >=
            ASSIMILATED_DRIVER_HOURS_LIMITS.splitBreakSecondSeconds
        ) {
          continuousDrivingSeconds = 0;
          splitBreakFirstPartSatisfied = false;
          break;
        }

        if (
          durationSeconds >=
          ASSIMILATED_DRIVER_HOURS_LIMITS.splitBreakFirstSeconds
        ) {
          splitBreakFirstPartSatisfied = true;
        }

        break;

      case "rest":
        if (
          durationSeconds >=
          ASSIMILATED_DRIVER_HOURS_LIMITS.regularWeeklyRestSeconds
        ) {
          currentStateBoundaryKnown = true;
          continuousDrivingSeconds = 0;
          dailyDrivingSeconds = 0;
          splitBreakFirstPartSatisfied = false;
          reducedDailyRestsSinceRegularWeeklyRest = 0;
          break;
        }

        if (
          durationSeconds >=
          ASSIMILATED_DRIVER_HOURS_LIMITS.regularDailyRestSeconds
        ) {
          currentStateBoundaryKnown = true;
          continuousDrivingSeconds = 0;
          dailyDrivingSeconds = 0;
          splitBreakFirstPartSatisfied = false;
          break;
        }

        if (
          durationSeconds >=
          ASSIMILATED_DRIVER_HOURS_LIMITS.reducedDailyRestSeconds
        ) {
          currentStateBoundaryKnown = true;
          continuousDrivingSeconds = 0;
          dailyDrivingSeconds = 0;
          splitBreakFirstPartSatisfied = false;
          reducedDailyRestsSinceRegularWeeklyRest += 1;
          break;
        }

        if (
          durationSeconds >=
          ASSIMILATED_DRIVER_HOURS_LIMITS.qualifyingBreakSeconds
        ) {
          continuousDrivingSeconds = 0;
          splitBreakFirstPartSatisfied = false;
        }

        break;

      case "other_work":
      case "availability":
      case "unknown":
        break;
    }
  }

  if (!currentStateBoundaryKnown) {
    complete = false;
    addUnique(
      warnings,
      "Driver activity history does not establish a qualifying rest boundary before the planning start.",
    );
  }

  const fortnightDrivingSeconds =
    previousWeekDrivingSeconds + currentWeekDrivingSeconds;

  if (
    continuousDrivingSeconds >
    ASSIMILATED_DRIVER_HOURS_LIMITS.maxContinuousDrivingSeconds
  ) {
    complete = false;
    addUnique(
      warnings,
      "Recorded continuous driving exceeds the baseline 4 h 30 m limit.",
    );
  }

  if (
    dailyDrivingSeconds >
    ASSIMILATED_DRIVER_HOURS_LIMITS.extendedDailyDrivingSeconds
  ) {
    complete = false;
    addUnique(
      warnings,
      "Recorded driving since the latest qualifying daily rest exceeds 10 hours.",
    );
  }

  if (
    currentWeekDrivingSeconds >
    ASSIMILATED_DRIVER_HOURS_LIMITS.weeklyDrivingSeconds
  ) {
    complete = false;
    addUnique(
      warnings,
      "Recorded current-week driving exceeds 56 hours.",
    );
  }

  if (
    fortnightDrivingSeconds >
    ASSIMILATED_DRIVER_HOURS_LIMITS.fortnightDrivingSeconds
  ) {
    complete = false;
    addUnique(
      warnings,
      "Recorded two-week driving exceeds 90 hours.",
    );
  }

  if (reducedDailyRestsSinceRegularWeeklyRest > 3) {
    complete = false;
    addUnique(
      warnings,
      "More than three reduced daily rests were detected since the latest observed regular weekly rest.",
    );
  }

  return {
    complete,
    planningStart: new Date(planningStartMs),

    currentStateBoundaryKnown,

    continuousDrivingSeconds,
    dailyDrivingSeconds,

    previousWeekDrivingSeconds,
    currentWeekDrivingSeconds,
    fortnightDrivingSeconds,

    currentWeekWorkingSeconds,

    continuousDrivingRemainingSeconds: remaining(
      ASSIMILATED_DRIVER_HOURS_LIMITS.maxContinuousDrivingSeconds,
      continuousDrivingSeconds,
    ),

    standardDailyDrivingRemainingSeconds: remaining(
      ASSIMILATED_DRIVER_HOURS_LIMITS.standardDailyDrivingSeconds,
      dailyDrivingSeconds,
    ),

    extendedDailyDrivingRemainingSeconds: remaining(
      ASSIMILATED_DRIVER_HOURS_LIMITS.extendedDailyDrivingSeconds,
      dailyDrivingSeconds,
    ),

    weeklyDrivingRemainingSeconds: remaining(
      ASSIMILATED_DRIVER_HOURS_LIMITS.weeklyDrivingSeconds,
      currentWeekDrivingSeconds,
    ),

    fortnightDrivingRemainingSeconds: remaining(
      ASSIMILATED_DRIVER_HOURS_LIMITS.fortnightDrivingSeconds,
      fortnightDrivingSeconds,
    ),

    splitBreakFirstPartSatisfied,
    reducedDailyRestsSinceRegularWeeklyRest,

    unknownActivityCount: normalized.unknownActivityCount,
    durationMismatchCount: normalized.durationMismatchCount,

    warnings,
  };
}
