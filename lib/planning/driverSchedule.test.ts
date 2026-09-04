import { describe, expect, it } from "vitest";
import {
  scheduleDriverRoute,
  type DriverScheduleInput,
  type DriverScheduleTask,
} from "./driverSchedule";
import type { DriverRuleProfile } from "./driverRules";

const HOUR = 60 * 60;

function rules(
  overrides: Partial<DriverRuleProfile> = {},
): DriverRuleProfile {
  return {
    id: "test-rules",
    label: "Synthetic test rules",
    regime: "assimilated",
    effectiveFrom: "2026-01-01",
    verified: false,
    sourceReference: null,
    maxContinuousDrivingSeconds: 4 * HOUR,
    qualifyingBreakSeconds: HOUR,
    maxDailyDrivingSeconds: 8 * HOUR,
    dailyRestSeconds: 10 * HOUR,
    maxDutyWindowSeconds: 12 * HOUR,
    ...overrides,
  };
}

function task(
  id: string,
  overrides: Partial<DriverScheduleTask> = {},
): DriverScheduleTask {
  return {
    id,
    locationId: `location-${id}`,
    serviceSeconds: HOUR,
    precedenceIds: [],
    ...overrides,
  };
}

function travelTable(
  values: Record<string, number | null> = {},
) {
  return (
    fromLocationId: string,
    toLocationId: string,
  ): number | null => {
    if (fromLocationId === toLocationId) {
      return 0;
    }

    const key = `${fromLocationId}->${toLocationId}`;

    return Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : HOUR;
  };
}

function input(
  overrides: Partial<DriverScheduleInput> = {},
): DriverScheduleInput {
  return {
    planningProfile: "tramper",
    ruleProfile: rules(),
    startTimeSeconds: 0,
    startLocationId: "base",
    baseLocationId: "base",
    activityDataAvailable: false,
    tasks: [task("a")],
    travelSecondsBetween: travelTable(),
    ...overrides,
  };
}

describe("scheduleDriverRoute", () => {
  it("is deterministic for identical inputs", () => {
    const value = input({
      tasks: [task("a"), task("b")],
    });

    expect(scheduleDriverRoute(value)).toEqual(
      scheduleDriverRoute(value),
    );
  });

  it("marks missing actual activity as a planning assumption", () => {
    const result = scheduleDriverRoute(input());

    expect(result.status).toBe("review_required");
    expect(result.planningAssumption).toBe(true);
  });

  it("can return scheduled only when activity and rules are verified", () => {
    const result = scheduleDriverRoute(
      input({
        activityDataAvailable: true,
        ruleProfile: rules({
          verified: true,
          sourceReference: "Synthetic verified test source",
        }),
      }),
    );

    expect(result.status).toBe("scheduled");
    expect(result.planningAssumption).toBe(false);
  });

  it("inserts a qualifying break before continuous driving is exceeded", () => {
    const result = scheduleDriverRoute(
      input({
        tasks: [
          task("a", { serviceSeconds: 0 }),
          task("b", { serviceSeconds: 0 }),
        ],
        travelSecondsBetween: travelTable({
          "base->location-a": 3 * HOUR,
          "location-a->location-b": 2 * HOUR,
        }),
      }),
    );

    expect(
      result.events.map((entry) => entry.kind),
    ).toEqual(["drive", "break", "drive"]);
  });

  it("rejects unsatisfied precedence", () => {
    const result = scheduleDriverRoute(
      input({
        tasks: [
          task("delivery", {
            precedenceIds: ["collection"],
          }),
          task("collection"),
        ],
      }),
    );

    expect(result.status).toBe("unschedulable");
    expect(result.completedTaskIds).toEqual([]);
  });

  it("inserts tramper daily rest at the current location", () => {
    const result = scheduleDriverRoute(
      input({
        ruleProfile: rules({
          maxDailyDrivingSeconds: 5 * HOUR,
        }),
        tasks: [
          task("a", { serviceSeconds: 0 }),
          task("b", { serviceSeconds: 0 }),
        ],
        travelSecondsBetween: travelTable({
          "base->location-a": 3 * HOUR,
          "location-a->location-b": 3 * HOUR,
        }),
      }),
    );

    const rest = result.events.find(
      (entry) => entry.kind === "daily_rest",
    );

    expect(rest?.locationId).toBe("location-a");
    expect(result.days[1].startLocationId).toBe(
      "location-a",
    );
    expect(result.completedTaskIds).toEqual(["a", "b"]);
  });

  it("returns a day driver to base before daily rest", () => {
    const result = scheduleDriverRoute(
      input({
        planningProfile: "day",
        ruleProfile: rules({
          maxDailyDrivingSeconds: 6 * HOUR,
        }),
        tasks: [
          task("a", { serviceSeconds: 0 }),
          task("b", { serviceSeconds: 0 }),
        ],
        travelSecondsBetween: travelTable({
          "base->location-a": 2 * HOUR,
          "location-a->base": HOUR,
          "location-a->location-b": 4 * HOUR,
          "base->location-b": 2 * HOUR,
          "location-b->base": HOUR,
        }),
      }),
    );

    const kinds = result.events.map((entry) => entry.kind);

    expect(kinds.indexOf("return_to_base")).toBeGreaterThan(-1);
    expect(kinds.indexOf("daily_rest")).toBeGreaterThan(
      kinds.indexOf("return_to_base"),
    );
    expect(result.days[0].endLocationId).toBe("base");
    expect(result.days[1].startLocationId).toBe("base");
  });

  it("recalculates day-two travel from base after overnight return", () => {
    const result = scheduleDriverRoute(
      input({
        planningProfile: "day",
        ruleProfile: rules({
          maxDailyDrivingSeconds: 6 * HOUR,
        }),
        tasks: [
          task("a", { serviceSeconds: 0 }),
          task("b", { serviceSeconds: 0 }),
          task("c", { serviceSeconds: 0 }),
        ],
        travelSecondsBetween: travelTable({
          "base->location-a": 2 * HOUR,
          "location-a->location-b": 2 * HOUR,
          "location-b->base": HOUR,
          "location-b->location-c": 4 * HOUR,
          "base->location-c": HOUR,
          "location-c->base": HOUR,
        }),
      }),
    );

    expect(result.completedTaskIds).toEqual([
      "a",
      "b",
      "c",
    ]);

    const driveToC = result.events.find(
      (entry) =>
        entry.kind === "drive" &&
        entry.taskId === "c",
    );

    expect(driveToC?.day).toBe(2);
    expect(driveToC?.durationSeconds).toBe(HOUR);
  });

  it("rejects a day task when the return leg alone exceeds the continuous-driving limit", () => {
    const result = scheduleDriverRoute(
      input({
        planningProfile: "day",
        ruleProfile: rules({
          maxContinuousDrivingSeconds: 4 * HOUR,
          maxDailyDrivingSeconds: 8 * HOUR,
        }),
        tasks: [
          task("a", {
            serviceSeconds: 0,
          }),
        ],
        travelSecondsBetween: travelTable({
          "base->location-a": HOUR,
          "location-a->base": 5 * HOUR,
        }),
      }),
    );

    expect(result.status).toBe("unschedulable");
    expect(result.completedTaskIds).toEqual([]);
    expect(result.unscheduledTaskIds).toEqual(["a"]);
    expect(result.events).toEqual([]);
    expect(result.warnings).toContain(
      "Task a cannot fit within the supplied planning rules",
    );
  });

  it("returns a day driver to base after final task", () => {
    const result = scheduleDriverRoute(
      input({
        planningProfile: "day",
        tasks: [task("a", { serviceSeconds: 0 })],
        travelSecondsBetween: travelTable({
          "base->location-a": HOUR,
          "location-a->base": HOUR,
        }),
      }),
    );

    expect(
      result.events[result.events.length - 1].kind,
    ).toBe("return_to_base");
    expect(
      result.days[result.days.length - 1].endLocationId,
    ).toBe("base");
  });

  it("does not invent missing travel time", () => {
    const result = scheduleDriverRoute(
      input({
        travelSecondsBetween: travelTable({
          "base->location-a": null,
        }),
      }),
    );

    expect(result.status).toBe("unschedulable");
    expect(result.completedTaskIds).toEqual([]);
    expect(result.warnings).toContain(
      "Travel time unavailable from base to location-a",
    );
  });

  it("rejects non-finite travel time", () => {
    const result = scheduleDriverRoute(
      input({
        travelSecondsBetween: () => Number.NaN,
      }),
    );

    expect(result.status).toBe("unschedulable");
  });

  it("treats identical locations as zero travel", () => {
    let calls = 0;

    const result = scheduleDriverRoute(
      input({
        startLocationId: "location-a",
        tasks: [task("a", { serviceSeconds: 0 })],
        travelSecondsBetween: () => {
          calls += 1;
          return null;
        },
      }),
    );

    expect(result.completedTaskIds).toEqual(["a"]);
    expect(calls).toBe(0);
  });

  it("rejects invalid service duration", () => {
    const result = scheduleDriverRoute(
      input({
        tasks: [
          task("bad", {
            serviceSeconds: Number.NaN,
          }),
        ],
      }),
    );

    expect(result.status).toBe("unschedulable");
  });

  it("requires a base for day-driver planning", () => {
    const result = scheduleDriverRoute(
      input({
        planningProfile: "day",
        baseLocationId: null,
      }),
    );

    expect(result.status).toBe("unschedulable");
  });

  it("preserves supplied task order", () => {
    const result = scheduleDriverRoute(
      input({
        tasks: [
          task("collection"),
          task("delivery", {
            precedenceIds: ["collection"],
          }),
        ],
      }),
    );

    expect(result.completedTaskIds).toEqual([
      "collection",
      "delivery",
    ]);
  });

  it("accounts for service separately from driving", () => {
    const result = scheduleDriverRoute(
      input({
        tasks: [
          task("a", {
            serviceSeconds: 3 * HOUR,
          }),
        ],
        travelSecondsBetween: travelTable({
          "base->location-a": 2 * HOUR,
        }),
      }),
    );

    expect(result.days[0].drivingSeconds).toBe(2 * HOUR);
    expect(result.days[0].serviceSeconds).toBe(3 * HOUR);
  });

  it("does not insert a break before rolling into daily rest", () => {
    const result = scheduleDriverRoute(
      input({
        ruleProfile: rules({
          maxContinuousDrivingSeconds: 4 * HOUR,
          maxDailyDrivingSeconds: 5 * HOUR,
        }),
        tasks: [
          task("a", { serviceSeconds: 0 }),
          task("b", { serviceSeconds: 0 }),
        ],
        travelSecondsBetween: travelTable({
          "base->location-a": 4 * HOUR,
          "location-a->location-b": 2 * HOUR,
        }),
      }),
    );

    const restIndex = result.events.findIndex(
      (entry) => entry.kind === "daily_rest",
    );

    expect(restIndex).toBeGreaterThan(-1);
    expect(
      result.events
        .slice(0, restIndex)
        .some((entry) => entry.kind === "break"),
    ).toBe(false);
  });
});
