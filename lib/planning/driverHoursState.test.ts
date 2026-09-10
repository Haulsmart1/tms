import { describe, expect, it } from "vitest";

import type {
  ComplianceActivityKind,
  NormalizedDriverActivity,
} from "./activity";
import {
  ASSIMILATED_DRIVER_HOURS_LIMITS,
  buildDriverHoursState,
} from "./driverHoursState";

const MINUTE = 60;
const HOUR = 60 * MINUTE;

function date(value: string): Date {
  return new Date(value);
}

function activity(
  id: string,
  kind: ComplianceActivityKind,
  start: string,
  end: string,
  overrides: Partial<NormalizedDriverActivity> = {},
): NormalizedDriverActivity {
  const startDate = date(start);
  const endDate = date(end);

  return {
    id,
    rawActivityType: kind,
    kind,
    start: startDate,
    end: endDate,
    elapsedMilliseconds:
      endDate.getTime() - startDate.getTime(),
    localStartDay: start.slice(0, 10),
    localEndDay: end.slice(0, 10),
    source: "test",
    durationMismatch: false,
    ...overrides,
  };
}

function state(
  activities: NormalizedDriverActivity[],
  historyStartsAfterKnownRest = false,
) {
  return buildDriverHoursState({
    activities,
    historyCoverageStart: date("2026-08-31T00:00:00Z"),
    previousWeekStart: date("2026-08-31T00:00:00Z"),
    currentWeekStart: date("2026-09-07T00:00:00Z"),
    planningStart: date("2026-09-10T12:00:00Z"),
    historyStartsAfterKnownRest,
  });
}

describe("buildDriverHoursState", () => {
  it("requires a proven current-state boundary for empty history", () => {
    const result = state([]);

    expect(result.complete).toBe(false);
    expect(result.currentStateBoundaryKnown).toBe(false);

    expect(
      result.warnings.some((warning) =>
        warning.includes("qualifying rest boundary"),
      ),
    ).toBe(true);
  });

  it("can accept an explicitly proven fresh history boundary", () => {
    const result = state([], true);

    expect(result.complete).toBe(true);
    expect(result.currentStateBoundaryKnown).toBe(true);
    expect(result.continuousDrivingSeconds).toBe(0);
    expect(result.dailyDrivingSeconds).toBe(0);
    expect(result.weeklyDrivingRemainingSeconds).toBe(56 * HOUR);
  });

  it("accumulates previous/current week and fortnight driving", () => {
    const result = state([
      activity(
        "previous",
        "driving",
        "2026-09-01T08:00:00Z",
        "2026-09-01T11:00:00Z",
      ),
      activity(
        "regular-weekly-rest",
        "rest",
        "2026-09-04T09:00:00Z",
        "2026-09-06T06:00:00Z",
      ),
      activity(
        "today",
        "driving",
        "2026-09-10T08:00:00Z",
        "2026-09-10T10:00:00Z",
      ),
    ]);

    expect(result.complete).toBe(true);
    expect(result.previousWeekDrivingSeconds).toBe(3 * HOUR);
    expect(result.currentWeekDrivingSeconds).toBe(2 * HOUR);
    expect(result.fortnightDrivingSeconds).toBe(5 * HOUR);
    expect(result.continuousDrivingSeconds).toBe(2 * HOUR);
    expect(result.dailyDrivingSeconds).toBe(2 * HOUR);
  });

  it("resets continuous driving after a 45 minute break", () => {
    const result = state([
      activity(
        "daily-rest",
        "rest",
        "2026-09-09T18:00:00Z",
        "2026-09-10T05:00:00Z",
      ),
      activity(
        "drive-a",
        "driving",
        "2026-09-10T06:00:00Z",
        "2026-09-10T09:00:00Z",
      ),
      activity(
        "break",
        "break",
        "2026-09-10T09:00:00Z",
        "2026-09-10T09:45:00Z",
      ),
      activity(
        "drive-b",
        "driving",
        "2026-09-10T09:45:00Z",
        "2026-09-10T11:45:00Z",
      ),
    ]);

    expect(result.continuousDrivingSeconds).toBe(2 * HOUR);
    expect(result.dailyDrivingSeconds).toBe(5 * HOUR);
  });

  it("recognises a 15 plus 30 minute split break", () => {
    const result = state([
      activity(
        "daily-rest",
        "rest",
        "2026-09-09T18:00:00Z",
        "2026-09-10T05:00:00Z",
      ),
      activity(
        "drive-a",
        "driving",
        "2026-09-10T06:00:00Z",
        "2026-09-10T08:00:00Z",
      ),
      activity(
        "break-15",
        "break",
        "2026-09-10T08:00:00Z",
        "2026-09-10T08:15:00Z",
      ),
      activity(
        "drive-b",
        "driving",
        "2026-09-10T08:15:00Z",
        "2026-09-10T09:45:00Z",
      ),
      activity(
        "break-30",
        "break",
        "2026-09-10T09:45:00Z",
        "2026-09-10T10:15:00Z",
      ),
      activity(
        "drive-c",
        "driving",
        "2026-09-10T10:15:00Z",
        "2026-09-10T11:15:00Z",
      ),
    ]);

    expect(result.continuousDrivingSeconds).toBe(HOUR);
    expect(result.splitBreakFirstPartSatisfied).toBe(false);
  });

  it("retains a pending 15 minute first break part", () => {
    const result = state([
      activity(
        "daily-rest",
        "rest",
        "2026-09-09T18:00:00Z",
        "2026-09-10T05:00:00Z",
      ),
      activity(
        "drive",
        "driving",
        "2026-09-10T06:00:00Z",
        "2026-09-10T08:00:00Z",
      ),
      activity(
        "break-15",
        "break",
        "2026-09-10T08:00:00Z",
        "2026-09-10T08:15:00Z",
      ),
    ]);

    expect(result.continuousDrivingSeconds).toBe(2 * HOUR);
    expect(result.splitBreakFirstPartSatisfied).toBe(true);
  });

  it("resets daily driving after regular daily rest", () => {
    const result = state([
      activity(
        "drive-yesterday",
        "driving",
        "2026-09-09T06:00:00Z",
        "2026-09-09T10:00:00Z",
      ),
      activity(
        "daily-rest",
        "rest",
        "2026-09-09T18:00:00Z",
        "2026-09-10T05:00:00Z",
      ),
      activity(
        "drive-today",
        "driving",
        "2026-09-10T06:00:00Z",
        "2026-09-10T08:00:00Z",
      ),
    ]);

    expect(result.currentStateBoundaryKnown).toBe(true);
    expect(result.dailyDrivingSeconds).toBe(2 * HOUR);
    expect(result.continuousDrivingSeconds).toBe(2 * HOUR);
    expect(result.currentWeekDrivingSeconds).toBe(6 * HOUR);
  });

  it("tracks reduced daily rest", () => {
    const result = state([
      activity(
        "drive",
        "driving",
        "2026-09-09T08:00:00Z",
        "2026-09-09T12:00:00Z",
      ),
      activity(
        "reduced-rest",
        "rest",
        "2026-09-09T18:00:00Z",
        "2026-09-10T03:00:00Z",
      ),
    ]);

    expect(result.currentStateBoundaryKnown).toBe(true);
    expect(result.dailyDrivingSeconds).toBe(0);
    expect(result.continuousDrivingSeconds).toBe(0);

    expect(
      result.reducedDailyRestsSinceRegularWeeklyRest,
    ).toBe(1);
  });

  it("does not treat 24 hours alone as proof of regular weekly rest", () => {
    const result = state([
      activity(
        "reduced-daily",
        "rest",
        "2026-09-01T18:00:00Z",
        "2026-09-02T03:00:00Z",
      ),
      activity(
        "twenty-four-hours",
        "rest",
        "2026-09-05T06:00:00Z",
        "2026-09-06T06:00:00Z",
      ),
    ]);

    expect(
      result.reducedDailyRestsSinceRegularWeeklyRest,
    ).toBe(1);
  });

  it("regular 45 hour weekly rest clears reduced daily-rest count", () => {
    const result = state([
      activity(
        "reduced-daily",
        "rest",
        "2026-09-01T18:00:00Z",
        "2026-09-02T03:00:00Z",
      ),
      activity(
        "regular-weekly",
        "rest",
        "2026-09-04T09:00:00Z",
        "2026-09-06T06:00:00Z",
      ),
    ]);

    expect(
      result.reducedDailyRestsSinceRegularWeeklyRest,
    ).toBe(0);
  });

  it("counts driving and other work but not availability as raw working time", () => {
    const result = state([
      activity(
        "daily-rest",
        "rest",
        "2026-09-09T18:00:00Z",
        "2026-09-10T05:00:00Z",
      ),
      activity(
        "drive",
        "driving",
        "2026-09-10T06:00:00Z",
        "2026-09-10T08:00:00Z",
      ),
      activity(
        "other",
        "other_work",
        "2026-09-10T08:00:00Z",
        "2026-09-10T09:00:00Z",
      ),
      activity(
        "availability",
        "availability",
        "2026-09-10T09:00:00Z",
        "2026-09-10T11:00:00Z",
      ),
    ]);

    expect(result.currentWeekWorkingSeconds).toBe(3 * HOUR);
  });

  it("clips driving across the weekly boundary", () => {
    const result = state([
      activity(
        "boundary",
        "driving",
        "2026-09-06T23:00:00Z",
        "2026-09-07T01:00:00Z",
      ),
      activity(
        "rest",
        "rest",
        "2026-09-07T01:00:00Z",
        "2026-09-07T12:00:00Z",
      ),
    ]);

    expect(result.previousWeekDrivingSeconds).toBe(HOUR);
    expect(result.currentWeekDrivingSeconds).toBe(HOUR);
    expect(result.fortnightDrivingSeconds).toBe(2 * HOUR);
  });

  it("marks unknown activity incomplete", () => {
    const result = state([
      activity(
        "rest",
        "rest",
        "2026-09-09T18:00:00Z",
        "2026-09-10T05:00:00Z",
      ),
      activity(
        "unknown",
        "unknown",
        "2026-09-10T08:00:00Z",
        "2026-09-10T09:00:00Z",
      ),
    ]);

    expect(result.complete).toBe(false);
    expect(result.unknownActivityCount).toBe(1);
  });

  it("marks duration mismatches incomplete", () => {
    const result = state([
      activity(
        "rest",
        "rest",
        "2026-09-09T18:00:00Z",
        "2026-09-10T05:00:00Z",
      ),
      activity(
        "bad-duration",
        "driving",
        "2026-09-10T08:00:00Z",
        "2026-09-10T09:00:00Z",
        { durationMismatch: true },
      ),
    ]);

    expect(result.complete).toBe(false);
    expect(result.durationMismatchCount).toBe(1);
  });

  it("detects overlapping activities", () => {
    const result = state([
      activity(
        "rest",
        "rest",
        "2026-09-09T18:00:00Z",
        "2026-09-10T05:00:00Z",
      ),
      activity(
        "a",
        "driving",
        "2026-09-10T08:00:00Z",
        "2026-09-10T10:00:00Z",
      ),
      activity(
        "b",
        "other_work",
        "2026-09-10T09:00:00Z",
        "2026-09-10T11:00:00Z",
      ),
    ]);

    expect(result.complete).toBe(false);

    expect(
      result.warnings.some((warning) =>
        warning.includes("overlap"),
      ),
    ).toBe(true);
  });

  it("calculates remaining continuous, daily, weekly and fortnight allowances", () => {
    const result = state([
      activity(
        "previous",
        "driving",
        "2026-09-01T08:00:00Z",
        "2026-09-01T18:00:00Z",
      ),
      activity(
        "weekly-rest",
        "rest",
        "2026-09-04T09:00:00Z",
        "2026-09-06T06:00:00Z",
      ),
      activity(
        "today",
        "driving",
        "2026-09-10T06:00:00Z",
        "2026-09-10T10:00:00Z",
      ),
    ]);

    expect(result.continuousDrivingRemainingSeconds).toBe(
      0.5 * HOUR,
    );

    expect(result.standardDailyDrivingRemainingSeconds).toBe(
      5 * HOUR,
    );

    expect(result.weeklyDrivingRemainingSeconds).toBe(
      52 * HOUR,
    );

    expect(result.fortnightDrivingRemainingSeconds).toBe(
      76 * HOUR,
    );
  });

  it("exposes verified baseline numerical constants", () => {
    expect(
      ASSIMILATED_DRIVER_HOURS_LIMITS.maxContinuousDrivingSeconds,
    ).toBe(4.5 * HOUR);

    expect(
      ASSIMILATED_DRIVER_HOURS_LIMITS.qualifyingBreakSeconds,
    ).toBe(45 * MINUTE);

    expect(
      ASSIMILATED_DRIVER_HOURS_LIMITS.standardDailyDrivingSeconds,
    ).toBe(9 * HOUR);

    expect(
      ASSIMILATED_DRIVER_HOURS_LIMITS.extendedDailyDrivingSeconds,
    ).toBe(10 * HOUR);

    expect(
      ASSIMILATED_DRIVER_HOURS_LIMITS.weeklyDrivingSeconds,
    ).toBe(56 * HOUR);

    expect(
      ASSIMILATED_DRIVER_HOURS_LIMITS.fortnightDrivingSeconds,
    ).toBe(90 * HOUR);
  });

  it("rejects invalid history boundaries", () => {
    expect(() =>
      buildDriverHoursState({
        activities: [],
        historyCoverageStart: date("2026-09-08T00:00:00Z"),
        previousWeekStart: date("2026-09-01T00:00:00Z"),
        currentWeekStart: date("2026-09-07T00:00:00Z"),
        planningStart: date("2026-09-10T12:00:00Z"),
      }),
    ).toThrow(/chronologically valid/);
  });
});
