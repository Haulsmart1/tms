import { describe, expect, it } from "vitest";

import type { PlanningDriverSchedulePreview } from "./planningDriverSchedule";
import {
  buildEditableSevenDayPlan,
  moveEditablePlanRange,
  stopsForEditableDay,
  UNSCHEDULED_ROUTE_DAY,
} from "./sevenDayPlanEditor";

function preview(): PlanningDriverSchedulePreview {
  return {
    planningStart: new Date("2026-10-05T00:00:00Z"),
    schedule: {
      status: "review_required",
      planningAssumption: true,
      events: [],
      days: [],
      warnings: [],
      completedTaskIds: [
        "stop:1",
        "stop:2",
        "stop:3",
      ],
      unscheduledTaskIds: [
        "stop:4",
        "stop:5",
      ],
    },
    routeDays: [
      {
        day: 1,
        scheduleDay: {
          day: 1,
          drivingSeconds: 0,
          serviceSeconds: 0,
          breakSeconds: 0,
          restSeconds: 0,
          startSeconds: 0,
          endSeconds: 0,
          startLocationId: "fixture-start",
          endLocationId: "fixture-end",
        },
        firstTaskIndex: 0,
        lastTaskIndex: 1,
        taskIds: ["stop:1", "stop:2"],
        events: [],
      },
      {
        day: 2,
        scheduleDay: {
          day: 2,
          drivingSeconds: 0,
          serviceSeconds: 0,
          breakSeconds: 0,
          restSeconds: 0,
          startSeconds: 0,
          endSeconds: 0,
          startLocationId: "fixture-start",
          endLocationId: "fixture-end",
        },
        firstTaskIndex: 2,
        lastTaskIndex: 2,
        taskIds: ["stop:3"],
        events: [],
      },
    ],
    dropEtas: [],
    horizonExceeded: true,
    remainingTaskIds: [
      "stop:4",
      "stop:5",
    ],
  };
}

describe("seven-day plan editor", () => {
  it("creates editable day and unscheduled buckets from a preview", () => {
    const plan = buildEditableSevenDayPlan(
      [
        "stop:1",
        "stop:2",
        "stop:3",
        "stop:4",
        "stop:5",
      ],
      preview()
    );

    expect(
      stopsForEditableDay(plan, 1).map(
        (stop) => stop.taskId
      )
    ).toEqual(["stop:1", "stop:2"]);

    expect(
      stopsForEditableDay(plan, 2).map(
        (stop) => stop.taskId
      )
    ).toEqual(["stop:3"]);

    expect(
      stopsForEditableDay(
        plan,
        UNSCHEDULED_ROUTE_DAY
      ).map((stop) => stop.taskId)
    ).toEqual(["stop:4", "stop:5"]);
  });

  it("moves a canonical range without changing canonical order", () => {
    const plan = buildEditableSevenDayPlan(
      [
        "stop:1",
        "stop:2",
        "stop:3",
        "stop:4",
        "stop:5",
      ],
      preview()
    );

    const moved = moveEditablePlanRange(
      plan,
      "stop:3",
      "stop:5",
      3
    );

    expect(moved.ok).toBe(true);

    if (!moved.ok) return;

    expect(
      stopsForEditableDay(
        moved.plan,
        3
      ).map((stop) => stop.taskId)
    ).toEqual([
      "stop:3",
      "stop:4",
      "stop:5",
    ]);

    expect(
      moved.plan.stops.map(
        (stop) => stop.taskId
      )
    ).toEqual([
      "stop:1",
      "stop:2",
      "stop:3",
      "stop:4",
      "stop:5",
    ]);
  });

  it("can move work back to the unscheduled holding bucket", () => {
    const plan = buildEditableSevenDayPlan(
      [
        "stop:1",
        "stop:2",
        "stop:3",
        "stop:4",
        "stop:5",
      ],
      preview()
    );

    const moved = moveEditablePlanRange(
      plan,
      "stop:2",
      "stop:3",
      UNSCHEDULED_ROUTE_DAY
    );

    expect(moved.ok).toBe(true);

    if (!moved.ok) return;

    expect(
      stopsForEditableDay(
        moved.plan,
        UNSCHEDULED_ROUTE_DAY
      ).map((stop) => stop.taskId)
    ).toEqual([
      "stop:2",
      "stop:3",
      "stop:4",
      "stop:5",
    ]);
  });

  it("rejects scheduling a delivery before its required collection", () => {
    const plan = buildEditableSevenDayPlan(
      [
        "collection",
        "delivery",
      ],
      {
        ...preview(),
        routeDays: [
          {
            day: 1,
            scheduleDay: {
              day: 1,
              drivingSeconds: 0,
              serviceSeconds: 0,
              breakSeconds: 0,
              restSeconds: 0,
              startSeconds: 0,
              endSeconds: 0,
              startLocationId: "fixture-start",
              endLocationId: "fixture-end",
            },
            firstTaskIndex: 0,
            lastTaskIndex: 0,
            taskIds: ["collection"],
            events: [],
          },
        ],
        remainingTaskIds: ["delivery"],
      }
    );

    const moved = moveEditablePlanRange(
      plan,
      "delivery",
      "delivery",
      1,
      [
        {
          taskId: "delivery",
          precedenceTaskIds: [
            "collection",
          ],
        },
      ]
    );

    expect(moved.ok).toBe(true);

    if (!moved.ok) return;

    expect(
      stopsForEditableDay(
        moved.plan,
        1
      ).map((stop) => stop.taskId)
    ).toEqual([
      "collection",
      "delivery",
    ]);
  });

  it("rejects a delivery scheduled while its collection is unscheduled", () => {
    const value = preview();

    value.routeDays = [];
    value.remainingTaskIds = [
      "collection",
      "delivery",
    ];

    const plan = buildEditableSevenDayPlan(
      [
        "collection",
        "delivery",
      ],
      value
    );

    const moved = moveEditablePlanRange(
      plan,
      "delivery",
      "delivery",
      1,
      [
        {
          taskId: "delivery",
          precedenceTaskIds: [
            "collection",
          ],
        },
      ]
    );

    expect(moved).toEqual({
      ok: false,
      reason: "precedence_conflict",
    });
  });

  it("rejects moving a collection after its scheduled delivery", () => {
    const value = preview();

    value.routeDays = [
      {
        day: 1,
        scheduleDay: {
          day: 1,
          drivingSeconds: 0,
          serviceSeconds: 0,
          breakSeconds: 0,
          restSeconds: 0,
          startSeconds: 0,
          endSeconds: 0,
          startLocationId: "fixture-start",
          endLocationId: "fixture-end",
        },
        firstTaskIndex: 0,
        lastTaskIndex: 1,
        taskIds: [
          "collection",
          "delivery",
        ],
        events: [],
      },
    ];
    value.remainingTaskIds = [];

    const plan = buildEditableSevenDayPlan(
      [
        "collection",
        "delivery",
      ],
      value
    );

    const moved = moveEditablePlanRange(
      plan,
      "collection",
      "collection",
      2,
      [
        {
          taskId: "delivery",
          precedenceTaskIds: [
            "collection",
          ],
        },
      ]
    );

    expect(moved).toEqual({
      ok: false,
      reason: "precedence_conflict",
    });
  });

  it("rejects invalid target days", () => {
    const plan = buildEditableSevenDayPlan(
      [
        "stop:1",
        "stop:2",
        "stop:3",
        "stop:4",
        "stop:5",
      ],
      preview()
    );

    expect(
      moveEditablePlanRange(
        plan,
        "stop:1",
        "stop:1",
        8
      )
    ).toEqual({
      ok: false,
      reason: "invalid_day",
    });
  });

  it("rejects duplicate canonical task IDs", () => {
    expect(() =>
      buildEditableSevenDayPlan(
        ["stop:1", "stop:1"],
        preview()
      )
    ).toThrow(
      "Canonical task IDs must be unique."
    );
  });
});