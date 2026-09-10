import {
  describe,
  expect,
  it,
} from "vitest";
import {
  buildPlanningDriverHoursState,
  planningDriverHoursBoundaries,
  type PlanningDriverActivityRow,
} from "./planningDriverActivity";

function row(
  id: string,
  activityKind: PlanningDriverActivityRow["activity_kind"],
  start: string,
  end: string,
  durationMinutes: number | null = null
): PlanningDriverActivityRow {
  return {
    id,
    driver_id: "driver-1",
    activity_type: activityKind ?? "unknown",
    activity_kind: activityKind,
    start_time: start,
    end_time: end,
    duration_minutes: durationMinutes,
  };
}

describe("planningDriverHoursBoundaries", () => {
  it("uses Monday midnight in the operator timezone", () => {
    const boundaries = planningDriverHoursBoundaries(
      new Date("2026-09-10T12:00:00Z"),
      "Europe/London"
    );

    expect(
      boundaries.currentWeekStart.toISOString()
    ).toBe("2026-09-06T23:00:00.000Z");

    expect(
      boundaries.previousWeekStart.toISOString()
    ).toBe("2026-08-30T23:00:00.000Z");

    expect(
      boundaries.historyCoverageStart.toISOString()
    ).toBe("2026-08-23T23:00:00.000Z");
  });
});

describe("buildPlanningDriverHoursState", () => {
  it("seeds daily, weekly and fortnight driving", () => {
    const state = buildPlanningDriverHoursState(
      [
        row(
          "weekly-rest",
          "rest",
          "2026-08-28T12:00:00Z",
          "2026-08-30T09:00:00Z"
        ),
        row(
          "previous-driving",
          "driving",
          "2026-09-02T08:00:00Z",
          "2026-09-02T10:00:00Z"
        ),
        row(
          "daily-rest-1",
          "rest",
          "2026-09-02T18:00:00Z",
          "2026-09-03T05:00:00Z"
        ),
        row(
          "daily-rest-2",
          "rest",
          "2026-09-07T18:00:00Z",
          "2026-09-08T05:00:00Z"
        ),
        row(
          "current-driving",
          "driving",
          "2026-09-08T06:00:00Z",
          "2026-09-08T09:00:00Z"
        ),
      ],
      new Date("2026-09-10T12:00:00Z"),
      "Europe/London"
    );

    expect(state.complete).toBe(true);
    expect(state.previousWeekDrivingSeconds).toBe(
      2 * 60 * 60
    );
    expect(state.currentWeekDrivingSeconds).toBe(
      3 * 60 * 60
    );
    expect(state.fortnightDrivingSeconds).toBe(
      5 * 60 * 60
    );
    expect(state.dailyDrivingSeconds).toBe(
      3 * 60 * 60
    );
  });

  it("keeps empty bounded history incomplete", () => {
    const state = buildPlanningDriverHoursState(
      [],
      new Date("2026-09-10T12:00:00Z"),
      "Europe/London"
    );

    expect(state.complete).toBe(false);
    expect(state.currentStateBoundaryKnown).toBe(false);
  });

  it("marks duration mismatches incomplete", () => {
    const state = buildPlanningDriverHoursState(
      [
        row(
          "rest",
          "rest",
          "2026-09-07T18:00:00Z",
          "2026-09-08T05:00:00Z",
          660
        ),
        row(
          "drive",
          "driving",
          "2026-09-08T06:00:00Z",
          "2026-09-08T07:00:00Z",
          20
        ),
      ],
      new Date("2026-09-10T12:00:00Z"),
      "Europe/London"
    );

    expect(state.complete).toBe(false);
    expect(state.durationMismatchCount).toBe(1);
  });
});
