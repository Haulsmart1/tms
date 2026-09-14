import {
  describe,
  expect,
  it,
} from "vitest";
import {
  buildPlanningDriverHoursState,
  planningDriverHoursBoundaries,
  planningHoursInstant,
  planningStartForLocalDate,
  planningStartIssue,
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

describe("planningStartForLocalDate", () => {
  it("resolves a winter London planning start", () => {
    expect(
      planningStartForLocalDate(
        "2026-01-15",
        "07:30:00",
        "Europe/London"
      )?.toISOString()
    ).toBe("2026-01-15T07:30:00.000Z");
  });

  it("resolves a summer London planning start using BST", () => {
    expect(
      planningStartForLocalDate(
        "2026-07-15",
        "07:30:00",
        "Europe/London"
      )?.toISOString()
    ).toBe("2026-07-15T06:30:00.000Z");
  });

  it("rejects a nonexistent spring-forward local time", () => {
    expect(
      planningStartForLocalDate(
        "2026-03-29",
        "01:30:00",
        "Europe/London"
      )
    ).toBeNull();
  });

  it("chooses the earlier occurrence during the autumn overlap", () => {
    expect(
      planningStartForLocalDate(
        "2026-10-25",
        "01:30:00",
        "Europe/London"
      )?.toISOString()
    ).toBe("2026-10-25T00:30:00.000Z");
  });

  it("does not manufacture a start when driver preference is missing", () => {
    expect(
      planningStartForLocalDate(
        "2026-09-10",
        null,
        "Europe/London"
      )
    ).toBeNull();
  });

  it("rejects invalid planning dates and times", () => {
    expect(
      planningStartForLocalDate(
        "2026-02-30",
        "07:30:00",
        "Europe/London"
      )
    ).toBeNull();

    expect(
      planningStartForLocalDate(
        "2026-09-10",
        "25:00:00",
        "Europe/London"
      )
    ).toBeNull();
  });
});

describe("planningDriverHoursBoundaries", () => {
  it("uses the UTC regulation week, not London Monday midnight (PLAN-17)", () => {
    const boundaries = planningDriverHoursBoundaries(
      new Date("2026-09-10T12:00:00Z"),
      "Europe/London"
    );

    expect(
      boundaries.currentWeekStart.toISOString()
    ).toBe("2026-09-07T00:00:00.000Z");

    expect(
      boundaries.previousWeekStart.toISOString()
    ).toBe("2026-08-31T00:00:00.000Z");

    expect(
      boundaries.historyCoverageStart.toISOString()
    ).toBe("2026-08-24T00:00:00.000Z");
  });

  it("keeps Sunday 23:30 UTC in the old week even though London is already Monday", () => {
    const boundaries = planningDriverHoursBoundaries(
      new Date("2026-09-13T23:30:00Z"),
      "Europe/London"
    );

    expect(boundaries.currentWeekStart.toISOString()).toBe(
      "2026-09-07T00:00:00.000Z"
    );
  });
});

describe("planningStartIssue (PLAN-20)", () => {
  it("names the spring-forward gap instead of blaming the driver profile", () => {
    expect(
      planningStartIssue("2027-03-28", "01:30:00", "Europe/London")
    ).toBe("clock_change_gap");
  });

  it("returns null for a start that exists", () => {
    expect(
      planningStartIssue("2027-03-28", "02:30:00", "Europe/London")
    ).toBeNull();
  });

  it("distinguishes a missing start time and a bad date", () => {
    expect(planningStartIssue("2027-03-28", null, "Europe/London")).toBe(
      "missing_start_time"
    );
    expect(planningStartIssue("2027-02-30", "06:00", "Europe/London")).toBe(
      "invalid_date"
    );
  });
});

describe("planningHoursInstant (PLAN-2)", () => {
  const start = new Date("2026-09-14T05:00:00Z"); // 06:00 BST

  it("evaluates today's plan at now once the start time has passed", () => {
    const now = new Date("2026-09-14T14:00:00Z"); // 15:00 BST

    expect(
      planningHoursInstant("2026-09-14", start, now, "Europe/London")
    ).toEqual({ kind: "known", instant: now, rebasedToNow: true });
  });

  it("reports a start that has not happened yet as future", () => {
    const now = new Date("2026-09-14T04:00:00Z");

    expect(
      planningHoursInstant("2026-09-14", start, now, "Europe/London").kind
    ).toBe("future");
  });

  it("keeps the planned start for a past day", () => {
    const now = new Date("2026-09-15T14:00:00Z");

    expect(
      planningHoursInstant("2026-09-14", start, now, "Europe/London")
    ).toEqual({ kind: "known", instant: start, rebasedToNow: false });
  });

  it("carries driving done earlier today into the remaining hours", () => {
    /* The review scenario (scratch run C). A daily rest ends at 06:00 BST,
       then 4 h 30 m driving, a 45 min break and 4 h driving: 8 h 30 m. The
       planner opens today at 15:00 BST. Evaluated at the 06:00 start this
       showed 0 h driven and 9 h available. Evaluated at the instant the
       helper picks, it must show 8 h 30 m driven and 30 m left. */
    const rows = [
      row("weekly-rest", "rest", "2026-09-10T18:00:00Z", "2026-09-12T18:00:00Z"),
      row("daily-rest", "rest", "2026-09-13T17:00:00Z", "2026-09-14T05:00:00Z"),
      row("drive-1", "driving", "2026-09-14T05:00:00Z", "2026-09-14T09:30:00Z"),
      row("break", "break", "2026-09-14T09:30:00Z", "2026-09-14T10:15:00Z"),
      row("drive-2", "driving", "2026-09-14T10:15:00Z", "2026-09-14T14:15:00Z"),
    ];

    const now = new Date("2026-09-14T14:15:00Z");
    const window = planningHoursInstant(
      "2026-09-14",
      start,
      now,
      "Europe/London"
    );

    expect(window.kind).toBe("known");
    if (window.kind !== "known") return;

    const state = buildPlanningDriverHoursState(
      rows,
      window.instant,
      "Europe/London"
    );

    expect(state.complete).toBe(true);
    expect(state.dailyDrivingSeconds).toBe(8.5 * 60 * 60);
    expect(state.standardDailyDrivingRemainingSeconds).toBe(30 * 60);
    expect(state.standardDailyDrivingRemainingSeconds).not.toBe(9 * 60 * 60);
    // Continuous driving since the 45 min break: 4 h, so 30 min to the next break.
    expect(state.continuousDrivingRemainingSeconds).toBe(30 * 60);
  });
});

describe("buildPlanningDriverHoursState", () => {
  it("seeds current daily, weekly and fortnight driving", () => {
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

  it("does not treat an empty bounded query as complete history", () => {
    const state = buildPlanningDriverHoursState(
      [],
      new Date("2026-09-10T12:00:00Z"),
      "Europe/London"
    );

    expect(state.complete).toBe(false);
    expect(state.currentStateBoundaryKnown).toBe(false);
  });

  it("marks imported duration mismatches incomplete", () => {
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
