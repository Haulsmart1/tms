import { describe, expect, it } from "vitest";
import { operatorDayWindow, operatorDaysBack, toFleetInput } from "./fleetQuery";

describe("operatorDayWindow", () => {
  it("starts a BST day at 23:00 UTC the evening before, not UTC midnight", () => {
    expect(operatorDayWindow("2026-09-29", "Europe/London")).toEqual({
      startIso: "2026-09-28T23:00:00.000Z",
      endIso: "2026-09-29T23:00:00.000Z",
    });
  });

  it("starts a GMT day at UTC midnight", () => {
    expect(operatorDayWindow("2026-12-01", "Europe/London")).toEqual({
      startIso: "2026-12-01T00:00:00.000Z",
      endIso: "2026-12-02T00:00:00.000Z",
    });
  });

  it("spans 23 hours on the day the clocks go forward", () => {
    const w = operatorDayWindow("2026-03-29", "Europe/London");
    expect(w?.startIso).toBe("2026-03-29T00:00:00.000Z");
    expect(w?.endIso).toBe("2026-03-29T23:00:00.000Z");
  });

  it("spans a range of days when given an end day", () => {
    expect(operatorDayWindow("2026-09-23", "Europe/London", "2026-09-29")).toEqual({
      startIso: "2026-09-22T23:00:00.000Z",
      endIso: "2026-09-29T23:00:00.000Z",
    });
  });

  it("uses the zone it is given", () => {
    expect(operatorDayWindow("2026-09-29", "Europe/Warsaw")?.startIso).toBe("2026-09-28T22:00:00.000Z");
  });

  it("refuses a date that is not a calendar day", () => {
    expect(operatorDayWindow("2026-02-30", "Europe/London")).toBeNull();
    expect(operatorDayWindow("yesterday", "Europe/London")).toBeNull();
  });
});

describe("operatorDaysBack", () => {
  it("counts back whole calendar days, including today", () => {
    expect(operatorDaysBack("2026-09-29", 7)).toBe("2026-09-23");
    expect(operatorDaysBack("2026-03-02", 3)).toBe("2026-02-28");
  });
});

describe("toFleetInput", () => {
  const now = new Date("2026-09-29T10:00:00Z");

  it("marks a shift on break and on its open vehicle period", () => {
    const input = toFleetInput({
      now,
      activeDriverCount: 3,
      vehicles: [{ id: "v1", registration: "AB12 CDE", vor: false }],
      shifts: [{ id: "s1", driver_id: "d1", started_at: "2026-09-29T06:00:00Z", ended_at: null, flags: null, drivers: { name: "Sam" } }],
      openBreaks: [{ shift_id: "s1" }],
      periods: [
        { shift_id: "s1", vehicle_id: "v0", started_at: "2026-09-29T06:00:00Z", ended_at: "2026-09-29T07:00:00Z" },
        { shift_id: "s1", vehicle_id: "v1", started_at: "2026-09-29T07:00:00Z", ended_at: null },
      ],
      checks: [],
      defects: [],
      objections: [],
      jobVehicleIds: ["v1", null, "v1"],
    });
    expect(input.shifts[0]).toMatchObject({ driverName: "Sam", onBreak: true, currentVehicleId: "v1", flags: [] });
    expect(input.vehiclesOnJobsToday).toEqual(["v1"]);
    expect(input.activeDriverCount).toBe(3);
  });

  it("gives an ended shift the vehicle it last used", () => {
    const input = toFleetInput({
      now,
      activeDriverCount: 0,
      vehicles: [],
      shifts: [{ id: "s1", driver_id: "d1", started_at: "2026-09-29T06:00:00Z", ended_at: "2026-09-29T09:00:00Z", flags: [], drivers: null }],
      openBreaks: [],
      periods: [
        { shift_id: "s1", vehicle_id: "v2", started_at: "2026-09-29T07:00:00Z", ended_at: "2026-09-29T09:00:00Z" },
        { shift_id: "s1", vehicle_id: "v1", started_at: "2026-09-29T06:00:00Z", ended_at: "2026-09-29T07:00:00Z" },
      ],
      checks: [],
      defects: [],
      objections: [],
      jobVehicleIds: [],
    });
    expect(input.shifts[0]).toMatchObject({ driverName: "Unknown driver", onBreak: false, currentVehicleId: "v2" });
  });

  it("reads check, defect and objection rows", () => {
    const input = toFleetInput({
      now,
      activeDriverCount: 0,
      vehicles: [],
      shifts: [],
      openBreaks: [],
      periods: [],
      checks: [
        {
          id: "c1",
          vehicle_id: "v1",
          driver_id: "d1",
          performed_at: "2026-09-29T06:00:00Z",
          result: "dangerous",
          flags: ["assigned_vehicle_mismatch"],
          drivers: [{ name: "Sam" }],
        },
      ],
      defects: [{ id: "x1", vehicle_id: "v1", final_severity: "dangerous", label: "Brakes", created_at: "2026-09-29T06:00:00Z" }],
      objections: [{ id: "o1", raised_at: "2026-09-29T07:00:00Z", drivers: { name: "Sam" }, walkaround_defects: { vehicle_id: "v1", label: "Brakes" } }],
      jobVehicleIds: [],
    });
    expect(input.checksToday[0]).toMatchObject({ driverName: "Sam", result: "dangerous", assignedVehicleMismatch: true });
    expect(input.openDefects[0]).toMatchObject({ finalSeverity: "dangerous", vehicleId: "v1" });
    expect(input.pendingObjections[0]).toMatchObject({ vehicleId: "v1", defectLabel: "Brakes", driverName: "Sam" });
  });
});
