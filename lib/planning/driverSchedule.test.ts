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
    travelSeconds: HOUR,
    serviceSeconds: HOUR,
    precedenceIds: [],
    returnToBaseSeconds: HOUR,
    ...overrides,
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
    expect(result.warnings).toContain(
      "Driver activity data unavailable; schedule is a planning assumption",
    );
  });

  it("does not assert compliance for an unverified rule profile", () => {
    const result = scheduleDriverRoute(
      input({
        activityDataAvailable: true,
      }),
    );

    expect(result.status).toBe("review_required");
    expect(result.warnings).toContain(
      "Driver rule profile is not verified; legal compliance is not asserted",
    );
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
          task("a", {
            travelSeconds: 3 * HOUR,
            serviceSeconds: 0,
          }),
          task("b", {
            travelSeconds: 2 * HOUR,
            serviceSeconds: 0,
          }),
        ],
      }),
    );

    expect(
      result.events.map((entry) => entry.kind),
    ).toEqual(["drive", "break", "drive"]);

    expect(
      result.events.find((entry) => entry.kind === "break")
        ?.durationSeconds,
    ).toBe(HOUR);
  });

  it("resets continuous driving after a qualifying break", () => {
    const result = scheduleDriverRoute(
      input({
        tasks: [
          task("a", {
            travelSeconds: 4 * HOUR,
            serviceSeconds: 0,
          }),
          task("b", {
            travelSeconds: 4 * HOUR,
            serviceSeconds: 0,
          }),
        ],
      }),
    );

    expect(result.completedTaskIds).toEqual(["a", "b"]);
    expect(
      result.events.filter((entry) => entry.kind === "break"),
    ).toHaveLength(1);
  });

  it("rejects an ordered task whose precedence is unsatisfied", () => {
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
    expect(result.unscheduledTaskIds).toEqual([
      "delivery",
      "collection",
    ]);
    expect(result.warnings).toContain(
      "Task delivery has unsatisfied precedence",
    );
  });

  it("inserts a tramper daily rest and resumes from the same location", () => {
    const result = scheduleDriverRoute(
      input({
        ruleProfile: rules({
          maxDailyDrivingSeconds: 5 * HOUR,
        }),
        tasks: [
          task("a", {
            travelSeconds: 3 * HOUR,
            serviceSeconds: 0,
          }),
          task("b", {
            travelSeconds: 3 * HOUR,
            serviceSeconds: 0,
          }),
        ],
      }),
    );

    const rest = result.events.find(
      (entry) => entry.kind === "daily_rest",
    );

    expect(rest).toBeDefined();
    expect(rest?.locationId).toBe("location-a");
    expect(result.days).toHaveLength(2);
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
          task("a", {
            travelSeconds: 2 * HOUR,
            serviceSeconds: 0,
            returnToBaseSeconds: HOUR,
          }),
          task("b", {
            travelSeconds: 4 * HOUR,
            serviceSeconds: 0,
            returnToBaseSeconds: HOUR,
          }),
        ],
      }),
    );

    const kinds = result.events.map((entry) => entry.kind);
    const returnIndex = kinds.indexOf("return_to_base");
    const restIndex = kinds.indexOf("daily_rest");

    expect(returnIndex).toBeGreaterThan(-1);
    expect(restIndex).toBeGreaterThan(returnIndex);
    expect(result.days[0].endLocationId).toBe("base");
    expect(result.days[1].startLocationId).toBe("base");
  });

  it("rolls remaining day-driver work to the next day", () => {
    const result = scheduleDriverRoute(
      input({
        planningProfile: "day",
        ruleProfile: rules({
          maxDailyDrivingSeconds: 6 * HOUR,
        }),
        tasks: [
          task("a", {
            travelSeconds: 2 * HOUR,
            serviceSeconds: 0,
            returnToBaseSeconds: HOUR,
          }),
          task("b", {
            travelSeconds: 4 * HOUR,
            serviceSeconds: 0,
            returnToBaseSeconds: HOUR,
          }),
        ],
      }),
    );

    expect(result.completedTaskIds).toEqual(["a", "b"]);
    expect(result.days).toHaveLength(2);
  });

  it("returns a day driver to base after the final task", () => {
    const result = scheduleDriverRoute(
      input({
        planningProfile: "day",
        tasks: [
          task("a", {
            travelSeconds: HOUR,
            serviceSeconds: 0,
            returnToBaseSeconds: HOUR,
          }),
        ],
      }),
    );

    expect(
      result.events[result.events.length - 1].kind,
    ).toBe("return_to_base");
    expect(result.days[result.days.length - 1].endLocationId)
      .toBe("base");
  });

  it("reports a task that cannot ever fit rather than forcing it", () => {
    const result = scheduleDriverRoute(
      input({
        tasks: [
          task("too-far", {
            travelSeconds: 5 * HOUR,
            serviceSeconds: 0,
          }),
        ],
      }),
    );

    expect(result.status).toBe("unschedulable");
    expect(result.completedTaskIds).toEqual([]);
    expect(result.unscheduledTaskIds).toEqual(["too-far"]);
  });

  it("rejects invalid task durations", () => {
    const result = scheduleDriverRoute(
      input({
        tasks: [
          task("bad", {
            travelSeconds: Number.NaN,
          }),
        ],
      }),
    );

    expect(result.status).toBe("unschedulable");
    expect(result.warnings).toContain(
      "Task bad has invalid travelSeconds",
    );
  });

  it("rejects an invalid rule profile", () => {
    const result = scheduleDriverRoute(
      input({
        ruleProfile: rules({
          dailyRestSeconds: 0,
        }),
      }),
    );

    expect(result.status).toBe("unschedulable");
    expect(result.warnings).toContain(
      "dailyRestSeconds must be a positive finite number",
    );
  });

  it("requires a base for day-driver planning", () => {
    const result = scheduleDriverRoute(
      input({
        planningProfile: "day",
        baseLocationId: null,
      }),
    );

    expect(result.status).toBe("unschedulable");
    expect(result.warnings).toContain(
      "Day-driver planning requires a baseLocationId",
    );
  });

  it("requires day-driver return travel rather than inventing it", () => {
    const result = scheduleDriverRoute(
      input({
        planningProfile: "day",
        tasks: [
          task("a", {
            returnToBaseSeconds: null,
          }),
        ],
      }),
    );

    expect(result.status).toBe("unschedulable");
    expect(result.unscheduledTaskIds).toEqual(["a"]);
  });

  it("preserves supplied task order when precedence is valid", () => {
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

  it("accounts for service time separately from driving", () => {
    const result = scheduleDriverRoute(
      input({
        tasks: [
          task("a", {
            travelSeconds: 2 * HOUR,
            serviceSeconds: 3 * HOUR,
          }),
        ],
      }),
    );

    expect(result.days[0].drivingSeconds).toBe(2 * HOUR);
    expect(result.days[0].serviceSeconds).toBe(3 * HOUR);
  });
});
