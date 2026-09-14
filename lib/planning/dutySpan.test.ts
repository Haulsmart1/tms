import { describe, expect, it } from "vitest";
import type { DriverScheduleEvent } from "./driverSchedule";
import { dutySpanWarnings } from "./planningDriverSchedule";

const HOUR = 60 * 60;

function event(
  kind: DriverScheduleEvent["kind"],
  day: number,
  startHours: number,
  endHours: number
): DriverScheduleEvent {
  return {
    kind,
    day,
    startSeconds: startHours * HOUR,
    endSeconds: endHours * HOUR,
    durationSeconds: (endHours - startHours) * HOUR,
    locationId: "loc",
    taskId: null,
  };
}

describe("dutySpanWarnings (PLAN-3)", () => {
  it("flags a day whose planned activity runs past 13 h with no daily rest", () => {
    /* Scratch run A in the review: many short legs and 10 min services, so the
       9 h driving limit never forces a rest and one "day" runs for 40 h. */
    const warnings = dutySpanWarnings({
      events: [
        event("drive", 1, 0, 2),
        event("service", 1, 2, 3),
        event("drive", 1, 3, 5),
        event("service", 1, 5, 40.75),
      ],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^Day 1 runs 40 h 45 m/);
    expect(warnings[0]).toMatch(/at most 13 h in 24 h/);
  });

  it("does not flag a 13 h day, and ignores the rest event itself", () => {
    expect(
      dutySpanWarnings({
        events: [
          event("drive", 1, 0, 4.5),
          event("break", 1, 4.5, 5.25),
          event("service", 1, 5.25, 13),
          event("daily_rest", 1, 13, 24),
          event("drive", 2, 24, 26),
        ],
      })
    ).toEqual([]);
  });
});
