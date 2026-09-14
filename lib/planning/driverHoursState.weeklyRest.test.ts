import { describe, expect, it } from "vitest";
import type { NormalizedDriverActivity } from "./activity";
import { buildDriverHoursState } from "./driverHoursState";

function activity(
  id: string,
  kind: NormalizedDriverActivity["kind"],
  start: string,
  end: string
): NormalizedDriverActivity {
  return {
    id,
    kind,
    start: new Date(start),
    end: new Date(end),
    durationMismatch: false,
  } as NormalizedDriverActivity;
}

describe("buildDriverHoursState weekly rest classification (PLAN-4)", () => {
  it("treats a 24 h reduced weekly rest as ending the run of reduced daily rests", () => {
    /* Three reduced (9 h) daily rests, then a legal 24 h reduced weekly rest,
       then one more reduced daily rest. Only one reduced daily rest follows
       the weekly rest, so there must be no "more than three" warning. */
    const state = buildDriverHoursState({
      activities: [
        activity("r1", "rest", "2026-09-01T20:00:00Z", "2026-09-02T05:00:00Z"),
        activity("r2", "rest", "2026-09-02T20:00:00Z", "2026-09-03T05:00:00Z"),
        activity("r3", "rest", "2026-09-03T20:00:00Z", "2026-09-04T05:00:00Z"),
        activity("weekly", "rest", "2026-09-04T18:00:00Z", "2026-09-05T18:00:00Z"),
        activity("r4", "rest", "2026-09-07T20:00:00Z", "2026-09-08T05:00:00Z"),
      ],
      planningStart: new Date("2026-09-10T12:00:00Z"),
      historyCoverageStart: new Date("2026-08-24T00:00:00Z"),
      previousWeekStart: new Date("2026-08-31T00:00:00Z"),
      currentWeekStart: new Date("2026-09-07T00:00:00Z"),
    });

    expect(state.reducedDailyRestsSinceRegularWeeklyRest).toBe(1);
    expect(state.warnings.join(" ")).not.toMatch(/more than three reduced/i);
  });
});
