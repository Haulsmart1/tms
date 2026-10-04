import { describe, expect, it } from "vitest";
import type { PlanningDriverSchedulePreview } from "./planningDriverSchedule";
import type {
  DriverScheduleEvent,
  DriverScheduleResult,
} from "./driverSchedule";
import { buildSevenDayPresentation } from "./sevenDayPresentation";

function event(
  kind: DriverScheduleEvent["kind"],
  day: number,
  durationSeconds: number,
  taskId?: string
): DriverScheduleEvent {
  return {
    kind,
    day,
    startSeconds: 0,
    endSeconds: durationSeconds,
    durationSeconds,
    locationId: "location:test",
    taskId: taskId ?? null,
  };
}

function preview(): PlanningDriverSchedulePreview {
  const dayOneEvents = [
    event("drive", 1, 3600, "stop:a"),
    event("service", 1, 600, "stop:a"),
    event("break", 1, 2700),
    event("drive", 1, 1800, "stop:b"),
    event("service", 1, 600, "stop:b"),
  ];

  const dayTwoEvents = [
    event("daily_rest", 2, 39600),
    event("drive", 2, 3600, "stop:c"),
    event("service", 2, 600, "stop:c"),
  ];

  return {
    planningStart: new Date("2026-10-03T08:00:00Z"),
    schedule: {
      status: "scheduled",
      planningAssumption: false,
      events: [...dayOneEvents, ...dayTwoEvents],
      days: [],
      warnings: [],
      completedTaskIds: [
        "stop:a",
        "stop:b",
        "stop:c",
      ],
      unscheduledTaskIds: [],
    } as DriverScheduleResult,
    routeDays: [
      {
        day: 1,
        scheduleDay: {} as never,
        events: dayOneEvents,
        taskIds: ["stop:a", "stop:b"],
        firstTaskIndex: 0,
        lastTaskIndex: 1,
      },
      {
        day: 2,
        scheduleDay: {} as never,
        events: dayTwoEvents,
        taskIds: ["stop:c"],
        firstTaskIndex: 2,
        lastTaskIndex: 2,
      },
    ],
    horizonExceeded: false,
    remainingTaskIds: [],
    dropEtas: [
      {
        dropNumber: 1,
        jobId: "job-a",
        stopId: "a",
        serviceStartSeconds: 3600,
        serviceEndSeconds: 4200,
      },
      {
        dropNumber: 2,
        jobId: "job-b",
        stopId: "b",
        serviceStartSeconds: 8700,
        serviceEndSeconds: 9300,
      },
      {
        dropNumber: 3,
        jobId: "job-c",
        stopId: "c",
        serviceStartSeconds: 52900,
        serviceEndSeconds: 53500,
      },
    ],
  };
}

describe("buildSevenDayPresentation", () => {
  it("preserves canonical drop order across days", () => {
    const days = buildSevenDayPresentation(preview());

    expect(days).toHaveLength(2);

    expect(
      days.flatMap((day) =>
        day.drops.map((drop) => drop.dropNumber)
      )
    ).toEqual([1, 2, 3]);

    expect(days[0].firstDropNumber).toBe(1);
    expect(days[0].lastDropNumber).toBe(2);
    expect(days[1].firstDropNumber).toBe(3);
    expect(days[1].lastDropNumber).toBe(3);
  });

  it("summarises each day's scheduled activities", () => {
    const days = buildSevenDayPresentation(preview());

    expect(days[0].totals).toEqual({
      driveSeconds: 5400,
      serviceSeconds: 1200,
      breakSeconds: 2700,
      dailyRestSeconds: 0,
      breakCount: 1,
      dailyRestCount: 0,
    });

    expect(days[1].totals).toEqual({
      driveSeconds: 3600,
      serviceSeconds: 600,
      breakSeconds: 0,
      dailyRestSeconds: 39600,
      breakCount: 0,
      dailyRestCount: 1,
    });
  });

  it("handles a schedule day with no completed drops", () => {
    const value = preview();

    value.routeDays.push({
      day: 3,
      scheduleDay: {} as never,
      events: [event("daily_rest", 3, 39600)],
      taskIds: [],
      firstTaskIndex: null,
      lastTaskIndex: null,
    });

    const days = buildSevenDayPresentation(value);

    expect(days[2].drops).toEqual([]);
    expect(days[2].firstDropNumber).toBeNull();
    expect(days[2].lastDropNumber).toBeNull();
    expect(days[2].totals.dailyRestCount).toBe(1);
  });
});
