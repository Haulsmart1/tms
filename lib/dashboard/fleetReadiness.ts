/*
  Dashboard tiles, "Needs attention" items and the /shifts "Fleet today" table,
  computed from rows the page has already loaded. Pure.
  Attention items use the existing AttentionItem shape from ./aggregate.
*/

import type { CheckResult, Severity } from "../walkaround/types";
import { STALE_OPEN_MINUTES } from "../shifts/hours";
import type { AttentionItem } from "./aggregate";

export type FleetVehicle = { id: string; registration: string; vor: boolean };
export type FleetShift = {
  id: string;
  driverId: string;
  driverName: string;
  startedAt: string;
  endedAt: string | null;
  onBreak: boolean;
  currentVehicleId: string | null;
  flags: string[];
};
export type FleetCheck = {
  id: string;
  vehicleId: string;
  driverId: string;
  driverName: string;
  performedAt: string;
  result: CheckResult;
  assignedVehicleMismatch: boolean;
};
export type FleetDefect = { id: string; vehicleId: string; finalSeverity: Severity; label: string; createdAt: string };
export type FleetObjection = { id: string; vehicleId: string; defectLabel: string; driverName: string; raisedAt: string };

export type FleetInput = {
  now: Date;
  activeDriverCount: number;
  vehicles: FleetVehicle[];
  /** Open shifts plus shifts that started today. */
  shifts: FleetShift[];
  /** Start and swap checks performed today (operator day). */
  checksToday: FleetCheck[];
  /** Unrectified defects. */
  openDefects: FleetDefect[];
  pendingObjections: FleetObjection[];
  vehiclesOnJobsToday: string[];
};

export type FleetTiles = {
  onShift: number;
  activeDrivers: number;
  vehiclesChecked: number;
  vehiclesOutUnchecked: number;
  openDefects: number;
  dangerousDefects: number;
  pendingObjections: number;
};

export type ShiftState = "none" | "on_duty" | "on_break" | "ended";

export type FleetTodayRow = {
  vehicleId: string;
  registration: string;
  driverName: string | null;
  checkTime: string | null;
  checkResult: CheckResult | null;
  shiftState: ShiftState;
  shiftStartedAt: string | null;
  openDefects: number;
  dangerousDefects: number;
  vor: boolean;
  onJobToday: boolean;
};

function hoursSince(iso: string, now: Date): number {
  return Math.max(0, (now.getTime() - Date.parse(iso)) / 3_600_000);
}

export function fleetTiles(input: FleetInput): FleetTiles {
  const checked = new Set(input.checksToday.map((c) => c.vehicleId));
  return {
    onShift: input.shifts.filter((s) => s.endedAt === null).length,
    activeDrivers: input.activeDriverCount,
    vehiclesChecked: checked.size,
    vehiclesOutUnchecked: new Set(input.vehiclesOnJobsToday.filter((v) => !checked.has(v))).size,
    openDefects: input.openDefects.length,
    dangerousDefects: input.openDefects.filter((d) => d.finalSeverity === "dangerous").length,
    pendingObjections: input.pendingObjections.length,
  };
}

export function fleetAttention(input: FleetInput): AttentionItem[] {
  const reg = new Map(input.vehicles.map((v) => [v.id, v.registration]));
  const name = (id: string) => reg.get(id) ?? "A vehicle";
  const checked = new Set(input.checksToday.map((c) => c.vehicleId));
  const items: AttentionItem[] = [];

  for (const d of input.openDefects.filter((x) => x.finalSeverity === "dangerous")) {
    items.push({ id: `fleet-defect-${d.id}`, title: `${name(d.vehicleId)} off the road: ${d.label}`, meta: "Dangerous walkaround defect", ageHours: hoursSince(d.createdAt, input.now), href: "/maintenance?tab=walkaround" });
  }
  for (const o of input.pendingObjections) {
    items.push({ id: `fleet-objection-${o.id}`, title: `${o.driverName} objects to the VOR on ${name(o.vehicleId)}`, meta: `Awaiting an admin decision: ${o.defectLabel}`, ageHours: hoursSince(o.raisedAt, input.now), href: "/maintenance?tab=walkaround" });
  }
  for (const v of [...new Set(input.vehiclesOnJobsToday)].filter((id) => !checked.has(id))) {
    items.push({ id: `fleet-unchecked-${v}`, title: `${name(v)} is on a job today with no walkaround check`, meta: "No check recorded today", ageHours: 0, href: "/shifts" });
  }
  for (const s of input.shifts.filter((x) => x.endedAt === null && hoursSince(x.startedAt, input.now) * 60 > STALE_OPEN_MINUTES)) {
    items.push({ id: `fleet-stale-${s.id}`, title: `${s.driverName} has been on shift for over 16 hours`, meta: "Did they forget to end the shift?", ageHours: hoursSince(s.startedAt, input.now), href: "/shifts" });
  }
  for (const c of input.checksToday.filter((x) => x.assignedVehicleMismatch)) {
    items.push({ id: `fleet-mismatch-${c.id}`, title: `${c.driverName} checked ${name(c.vehicleId)}, not their assigned vehicle`, meta: "Different vehicle chosen at shift start", ageHours: hoursSince(c.performedAt, input.now), href: "/shifts" });
  }
  return items;
}

export function fleetTodayRows(input: FleetInput): FleetTodayRow[] {
  const jobs = new Set(input.vehiclesOnJobsToday);
  return input.vehicles.map((v) => {
    const checks = input.checksToday.filter((c) => c.vehicleId === v.id).sort((a, b) => b.performedAt.localeCompare(a.performedAt));
    const latest = checks[0] ?? null;
    const shift = input.shifts.find((s) => s.currentVehicleId === v.id && s.endedAt === null) ?? null;
    const defects = input.openDefects.filter((d) => d.vehicleId === v.id);
    const shiftState: ShiftState = shift ? (shift.onBreak ? "on_break" : "on_duty") : latest ? "ended" : "none";
    return {
      vehicleId: v.id,
      registration: v.registration,
      driverName: shift?.driverName ?? latest?.driverName ?? null,
      checkTime: latest?.performedAt ?? null,
      checkResult: latest?.result ?? null,
      shiftState,
      shiftStartedAt: shift?.startedAt ?? null,
      openDefects: defects.length,
      dangerousDefects: defects.filter((d) => d.finalSeverity === "dangerous").length,
      vor: v.vor,
      onJobToday: jobs.has(v.id),
    };
  });
}
