import { describe, expect, it } from "vitest";
import { fleetAttention, fleetTiles, fleetTodayRows, type FleetInput } from "./fleetReadiness";

const now = new Date("2026-09-29T12:00:00Z");

const input: FleetInput = {
  now,
  activeDriverCount: 3,
  vehicles: [
    { id: "v1", registration: "AB12 CDE", vor: true },
    { id: "v2", registration: "FG34 HIJ", vor: false },
    { id: "v3", registration: "KL56 MNO", vor: false },
  ],
  shifts: [
    { id: "s1", driverId: "d1", driverName: "J. Smith", startedAt: "2026-09-29T04:40:00Z", endedAt: null, onBreak: true, currentVehicleId: "v2", flags: [] },
    { id: "s2", driverId: "d2", driverName: "M. Jones", startedAt: "2026-09-28T18:00:00Z", endedAt: null, onBreak: false, currentVehicleId: null, flags: [] },
  ],
  checksToday: [
    { id: "c1", vehicleId: "v1", driverId: "d1", driverName: "J. Smith", performedAt: "2026-09-29T04:42:00Z", result: "dangerous", assignedVehicleMismatch: false },
    { id: "c2", vehicleId: "v2", driverId: "d1", driverName: "J. Smith", performedAt: "2026-09-29T04:55:00Z", result: "minor", assignedVehicleMismatch: true },
  ],
  openDefects: [
    { id: "f1", vehicleId: "v1", finalSeverity: "dangerous", label: "Brakes and air build-up: Audible air leak", createdAt: "2026-09-29T04:42:00Z" },
    { id: "f2", vehicleId: "v2", finalSeverity: "minor", label: "Horn: Horn does not work", createdAt: "2026-09-29T04:55:00Z" },
  ],
  pendingObjections: [{ id: "o1", vehicleId: "v1", defectLabel: "Brakes and air build-up: Audible air leak", driverName: "J. Smith", raisedAt: "2026-09-29T04:50:00Z" }],
  vehiclesOnJobsToday: ["v2", "v3"],
};

describe("fleetTiles", () => {
  it("counts shifts, checks, defects and objections", () => {
    expect(fleetTiles(input)).toEqual({
      onShift: 2,
      activeDrivers: 3,
      vehiclesChecked: 2,
      vehiclesOutUnchecked: 1,
      openDefects: 2,
      dangerousDefects: 1,
      pendingObjections: 1,
    });
  });
});

describe("fleetAttention", () => {
  it("lists dangerous defects and objections first, then the warnings", () => {
    const items = fleetAttention(input);
    expect(items.map((i) => i.id)).toEqual([
      "fleet-defect-f1",
      "fleet-objection-o1",
      "fleet-unchecked-v3",
      "fleet-stale-s2",
      "fleet-mismatch-c2",
    ]);
    expect(items[0]).toMatchObject({ title: "AB12 CDE off the road: Brakes and air build-up: Audible air leak", href: "/maintenance?tab=walkaround" });
    expect(items[3]).toMatchObject({ title: "M. Jones has been on shift for over 16 hours", href: "/shifts" });
  });
});

describe("fleetTodayRows", () => {
  it("gives one row per vehicle with its latest check and shift", () => {
    const rows = fleetTodayRows(input);
    expect(rows.find((r) => r.vehicleId === "v2")).toMatchObject({ registration: "FG34 HIJ", driverName: "J. Smith", checkResult: "minor", shiftState: "on_break", openDefects: 1, dangerousDefects: 0, vor: false });
    expect(rows.find((r) => r.vehicleId === "v3")).toMatchObject({ driverName: null, checkResult: null, shiftState: "none", onJobToday: true });
    expect(rows.find((r) => r.vehicleId === "v1")).toMatchObject({ checkResult: "dangerous", dangerousDefects: 1, vor: true });
  });
});
