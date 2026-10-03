import { describe, expect, it } from "vitest";
import type { DriverRuleProfile } from "./driverRules";
import type { DriverScheduleTask } from "./driverSchedule";
import {
  MAX_ROUTE_DAYS,
  planCanonicalRouteAcrossDays,
} from "./sevenDayPlanner";

const HOUR = 60 * 60;

function rules(
  overrides: Partial<DriverRuleProfile> = {},
): DriverRuleProfile {
  return {
    id: "test-rules",
    label: "Test planning rules",
    regime: "assimilated",
    effectiveFrom: "2026-10-05",
    verified: false,
    sourceReference: null,
    maxContinuousDrivingSeconds: 4.5 * HOUR,
    qualifyingBreakSeconds: 45 * 60,
    maxDailyDrivingSeconds: 9 * HOUR,
    dailyRestSeconds: 11 * HOUR,
    maxDutyWindowSeconds: 13 * HOUR,
    ...overrides,
  };
}

function tasks(
  count: number,
  serviceSeconds = 0,
): DriverScheduleTask[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `task-${index + 1}`,
    locationId: `location-${index + 1}`,
    serviceSeconds,
    precedenceIds:
      index === 0 ? [] : [`task-${index}`],
  }));
}

function sequentialTravel(seconds: number) {
  return (from: string, to: string): number | null => {
    if (from === to) return 0;
    return seconds;
  };
}

describe("planCanonicalRouteAcrossDays", () => {
  it("keeps a one-day canonical route in exact task order", () => {
    const result = planCanonicalRouteAcrossDays({
      planningProfile: "tramper",
      ruleProfile: rules(),
      startLocationId: "start",
      activityDataAvailable: true,
      tasks: tasks(3),
      travelSecondsBetween: sequentialTravel(HOUR),
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.days).toHaveLength(1);
    expect(result.completedTaskIds).toEqual([
      "task-1",
      "task-2",
      "task-3",
    ]);
    expect(result.days[0].taskIds).toEqual(
      result.completedTaskIds,
    );
  });

  it("splits a fixed canonical route across multiple days without reordering", () => {
    const canonical = tasks(8);

    const result = planCanonicalRouteAcrossDays({
      planningProfile: "tramper",
      ruleProfile: rules({
        maxContinuousDrivingSeconds: 2 * HOUR,
        maxDailyDrivingSeconds: 3 * HOUR,
      }),
      startLocationId: "start",
      activityDataAvailable: true,
      tasks: canonical,
      travelSecondsBetween: sequentialTravel(HOUR),
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.days.length).toBeGreaterThan(1);
    expect(result.days.flatMap((day) => day.taskIds)).toEqual(
      canonical.map((task) => task.id),
    );
  });

  it("allows a route requiring exactly seven days", () => {
    const canonical = tasks(7);

    const result = planCanonicalRouteAcrossDays({
      planningProfile: "tramper",
      ruleProfile: rules({
        maxContinuousDrivingSeconds: HOUR,
        maxDailyDrivingSeconds: HOUR,
      }),
      startLocationId: "start",
      activityDataAvailable: true,
      tasks: canonical,
      travelSecondsBetween: sequentialTravel(HOUR),
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.days).toHaveLength(MAX_ROUTE_DAYS);
    expect(result.completedTaskIds).toEqual(
      canonical.map((task) => task.id),
    );
  });

  it("rejects a route that requires an eighth day and reports the remainder", () => {
    const canonical = tasks(8);

    const result = planCanonicalRouteAcrossDays({
      planningProfile: "tramper",
      ruleProfile: rules({
        maxContinuousDrivingSeconds: HOUR,
        maxDailyDrivingSeconds: HOUR,
      }),
      startLocationId: "start",
      activityDataAvailable: true,
      tasks: canonical,
      travelSecondsBetween: sequentialTravel(HOUR),
    });

    expect(result.ok).toBe(false);

    if (result.ok) return;

    expect(result.reason).toBe("horizon_exceeded");
    expect(result.days).toHaveLength(7);
    expect(result.completedTaskIds).toEqual(
      canonical.slice(0, 7).map((task) => task.id),
    );
    expect(result.unscheduledTaskIds).toEqual(["task-8"]);
  });

  it("preserves precedence across a daily-rest boundary", () => {
    const canonical = tasks(4);

    const result = planCanonicalRouteAcrossDays({
      planningProfile: "tramper",
      ruleProfile: rules({
        maxContinuousDrivingSeconds: 2 * HOUR,
        maxDailyDrivingSeconds: 2 * HOUR,
      }),
      startLocationId: "start",
      activityDataAvailable: true,
      tasks: canonical,
      travelSecondsBetween: sequentialTravel(HOUR),
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.days.flatMap((day) => day.taskIds)).toEqual(
      canonical.map((task) => task.id),
    );
    expect(
      result.days.flatMap((day) => day.events).some(
        (event) => event.kind === "daily_rest",
      ),
    ).toBe(true);
  });

  it("preserves multiple services at one physical location", () => {
    const canonical: DriverScheduleTask[] = [
      {
        id: "collection",
        locationId: "shared",
        serviceSeconds: 600,
      },
      {
        id: "delivery-a",
        locationId: "shared",
        serviceSeconds: 600,
        precedenceIds: ["collection"],
      },
      {
        id: "delivery-b",
        locationId: "shared",
        serviceSeconds: 600,
        precedenceIds: ["delivery-a"],
      },
    ];

    const result = planCanonicalRouteAcrossDays({
      planningProfile: "tramper",
      ruleProfile: rules(),
      startLocationId: "shared",
      activityDataAvailable: true,
      tasks: canonical,
      travelSecondsBetween: () => 0,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.completedTaskIds).toEqual([
      "collection",
      "delivery-a",
      "delivery-b",
    ]);
  });

  it("uses supplied driver history when deciding whether work fits", () => {
    const result = planCanonicalRouteAcrossDays({
      planningProfile: "tramper",
      ruleProfile: rules(),
      startLocationId: "start",
      activityDataAvailable: true,
      initialDrivingState: {
        continuousDrivingSeconds: 4 * HOUR,
        dailyDrivingSeconds: 8 * HOUR,
        weeklyDrivingSeconds: 55 * HOUR,
        fortnightDrivingSeconds: 89 * HOUR,
        maxWeeklyDrivingSeconds: 56 * HOUR,
        maxFortnightDrivingSeconds: 90 * HOUR,
      },
      tasks: tasks(2),
      travelSecondsBetween: sequentialTravel(HOUR),
    });

    expect(result.ok).toBe(false);

    if (result.ok) return;

    expect(result.reason).toBe("unschedulable");
    expect(result.unscheduledTaskIds.length).toBeGreaterThan(0);
  });

  it("preserves the exact order of 1000 canonical service tasks", () => {
    const canonical = tasks(1000);

    const result = planCanonicalRouteAcrossDays({
      planningProfile: "tramper",
      ruleProfile: rules({
        maxContinuousDrivingSeconds: 24 * HOUR,
        maxDailyDrivingSeconds: 24 * HOUR,
        maxDutyWindowSeconds: null,
      }),
      startLocationId: "start",
      activityDataAvailable: false,
      tasks: canonical,
      travelSecondsBetween: sequentialTravel(1),
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.completedTaskIds).toEqual(
      canonical.map((task) => task.id),
    );
    expect(result.days.flatMap((day) => day.taskIds)).toEqual(
      canonical.map((task) => task.id),
    );
  });

  it("keeps a zero-duration colocated task on the correct side of an overnight boundary", () => {
    const canonical: DriverScheduleTask[] = [
      {
        id: "day-one",
        locationId: "location-a",
        serviceSeconds: 0,
      },
      {
        id: "day-two-arrival",
        locationId: "location-b",
        serviceSeconds: 0,
        precedenceIds: ["day-one"],
      },
      {
        id: "day-two-colocated",
        locationId: "location-b",
        serviceSeconds: 0,
        precedenceIds: ["day-two-arrival"],
      },
    ];

    const result = planCanonicalRouteAcrossDays({
      planningProfile: "tramper",
      ruleProfile: rules({
        maxContinuousDrivingSeconds: HOUR,
        maxDailyDrivingSeconds: HOUR,
      }),
      startLocationId: "start",
      activityDataAvailable: true,
      tasks: canonical,
      travelSecondsBetween: sequentialTravel(HOUR),
    });

    expect(result.ok).toBe(true);

    if (!result.ok) return;

    expect(result.days).toHaveLength(2);
    expect(result.days[0].taskIds).toEqual(["day-one"]);
    expect(result.days[1].taskIds).toEqual([
      "day-two-arrival",
      "day-two-colocated",
    ]);
    expect(result.days.flatMap((day) => day.taskIds)).toEqual(
      canonical.map((task) => task.id),
    );
  });
  it("rejects planning horizons above seven days", () => {
    expect(() =>
      planCanonicalRouteAcrossDays({
        planningProfile: "tramper",
        ruleProfile: rules(),
        startLocationId: "start",
        activityDataAvailable: true,
        tasks: [],
        travelSecondsBetween: () => 0,
        maxDays: 8,
      }),
    ).toThrow("maxDays must be an integer from 1 to 7.");
  });
});