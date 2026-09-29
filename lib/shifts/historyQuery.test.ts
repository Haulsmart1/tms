import { describe, expect, it } from "vitest";
import { summariseShift } from "./hours";
import { forHours, toHistoryShifts } from "./historyQuery";

describe("toHistoryShifts", () => {
  const rows = {
    shifts: [
      { id: "s1", tenant_id: "t1", driver_id: "d1", started_at: "2026-09-29T06:00:00Z", ended_at: "2026-09-29T15:00:00Z", ended_by: "office", flags: ["late_sync"], drivers: [{ name: "Sam" }] },
      { id: "s2", tenant_id: "t1", driver_id: "d2", started_at: "2026-09-28T06:00:00Z", ended_at: null, ended_by: null, flags: null, drivers: null },
    ],
    breaks: [
      { shift_id: "s1", started_at: "2026-09-29T11:00:00Z", ended_at: "2026-09-29T11:45:00Z" },
      { shift_id: "s1", started_at: "2026-09-29T08:00:00Z", ended_at: "2026-09-29T08:15:00Z" },
    ],
    periods: [
      { shift_id: "s1", vehicle_id: "v2", started_at: "2026-09-29T10:00:00Z", start_odometer: 150, end_odometer: 200, vehicles: { registration: "XY34 ZZZ" } },
      { shift_id: "s1", vehicle_id: "v1", started_at: "2026-09-29T06:00:00Z", start_odometer: 100, end_odometer: 140, vehicles: null },
    ],
    corrections: [
      { id: "c1", shift_id: "s1", field: "ended_at", old_value: null, new_value: "2026-09-29 15:00:00+00", reason: "Phone died", corrected_at: "2026-09-29T16:00:00Z", corrected_by_user_id: "u1" },
      { id: "c2", shift_id: "s1", field: "started_at", old_value: "a", new_value: "b", reason: "Typo", corrected_at: "2026-09-29T17:00:00Z", corrected_by_user_id: "u2" },
    ],
    userNames: new Map([["u1", "Alex Office"]]),
  };

  it("groups breaks, periods and corrections under their shift in time order", () => {
    const [s1, s2] = toHistoryShifts(rows);
    expect(s1.driverName).toBe("Sam");
    expect(s1.breaks.map((b) => b.startedAt)).toEqual(["2026-09-29T08:00:00Z", "2026-09-29T11:00:00Z"]);
    expect(s1.periods.map((p) => p.registration)).toEqual(["Unknown vehicle", "XY34 ZZZ"]);
    expect(s1.corrections.map((c) => c.correctedBy)).toEqual(["Alex Office", "An office user"]);
    expect(s2).toMatchObject({ driverName: "Unknown driver", flags: [], breaks: [], periods: [], corrections: [] });
  });

  it("feeds summariseShift", () => {
    const [s1] = toHistoryShifts(rows);
    const summary = summariseShift(forHours(s1), new Date("2026-09-30T00:00:00Z"));
    expect(summary).toMatchObject({ dutyMinutes: 540, breakMinutes: 60, workedMinutes: 480, mileage: 90 });
  });
});
