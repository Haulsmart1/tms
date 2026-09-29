/*
  Browser loader for the /shifts "Fleet today" table (and anything else that
  needs a FleetInput). Every query runs through the browser client, so RLS is
  the boundary, and through applyTenantFilter so "one tenant" really means one.

  "Today" is the operator's calendar day in the operator's time zone. Its start
  is 00:00 in that zone, which during BST is 23:00 UTC the evening before: a
  UTC-midnight cut-off would drop every check done between midnight and 01:00.

  loadFleetInput throws on the first query error; the page shows an error
  state. The row mapping (toFleetInput) is pure and unit-tested.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FleetCheck, FleetInput, FleetShift } from "../dashboard/fleetReadiness";
import { addCalendarDays } from "../invoices/dates";
import { startOfDayInZoneMs } from "../quotations/shareExpiry";
import { applyTenantFilter } from "../tenant/filter";
import { OPERATOR_TIME_ZONE } from "../time";
import type { CheckResult, Severity } from "../walkaround/types";

export type DayWindow = { startIso: string; endIso: string };

/**
 * The instants bounding operator days `fromDay` to `toDay` (inclusive, both
 * YYYY-MM-DD) in `timeZone`: [start of fromDay, start of the day after toDay).
 */
export function operatorDayWindow(fromDay: string, timeZone: string, toDay: string = fromDay): DayWindow | null {
  const start = startOfDayInZoneMs(fromDay, timeZone);
  const next = addCalendarDays(toDay, 1);
  const end = next ? startOfDayInZoneMs(next, timeZone) : null;
  if (start === null || end === null || end <= start) return null;
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() };
}

/** The first of the `days` operator days ending on `today`. */
export function operatorDaysBack(today: string, days: number): string {
  return addCalendarDays(today, -(Math.max(1, days) - 1)) ?? today;
}

type Named = { name?: unknown } | { name?: unknown }[] | null | undefined;

/** An embedded to-one relation arrives as an object, or as a one-row array. */
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function nameOf(value: Named, fallback: string): string {
  const row = one(value);
  return row && typeof row.name === "string" && row.name.trim() ? row.name : fallback;
}

function flagList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function checkResult(value: unknown): CheckResult {
  return value === "dangerous" || value === "minor" ? value : "pass";
}

function severity(value: unknown): Severity {
  return value === "dangerous" ? "dangerous" : "minor";
}

export type FleetRows = {
  now: Date;
  activeDriverCount: number;
  vehicles: { id: string; registration: string | null; vor: boolean | null }[];
  shifts: { id: string; driver_id: string; started_at: string; ended_at: string | null; flags: unknown; drivers: Named }[];
  openBreaks: { shift_id: string }[];
  periods: { shift_id: string; vehicle_id: string; started_at: string; ended_at: string | null }[];
  checks: {
    id: string;
    vehicle_id: string;
    driver_id: string;
    performed_at: string;
    result: unknown;
    flags: unknown;
    drivers: Named;
  }[];
  defects: { id: string; vehicle_id: string; final_severity: unknown; label: string; created_at: string }[];
  objections: {
    id: string;
    raised_at: string;
    drivers: Named;
    walkaround_defects: { vehicle_id?: unknown; label?: unknown } | { vehicle_id?: unknown; label?: unknown }[] | null;
  }[];
  jobVehicleIds: (string | null)[];
};

export function toFleetInput(rows: FleetRows): FleetInput {
  const onBreak = new Set(rows.openBreaks.map((b) => b.shift_id));

  const shifts: FleetShift[] = rows.shifts.map((s) => {
    const periods = rows.periods.filter((p) => p.shift_id === s.id);
    const open = periods.find((p) => p.ended_at === null);
    const latest = [...periods].sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
    return {
      id: s.id,
      driverId: s.driver_id,
      driverName: nameOf(s.drivers, "Unknown driver"),
      startedAt: s.started_at,
      endedAt: s.ended_at,
      onBreak: s.ended_at === null && onBreak.has(s.id),
      currentVehicleId: (open ?? latest)?.vehicle_id ?? null,
      flags: flagList(s.flags),
    };
  });

  const checksToday: FleetCheck[] = rows.checks.map((c) => ({
    id: c.id,
    vehicleId: c.vehicle_id,
    driverId: c.driver_id,
    driverName: nameOf(c.drivers, "Unknown driver"),
    performedAt: c.performed_at,
    result: checkResult(c.result),
    assignedVehicleMismatch: flagList(c.flags).includes("assigned_vehicle_mismatch"),
  }));

  return {
    now: rows.now,
    activeDriverCount: rows.activeDriverCount,
    vehicles: rows.vehicles.map((v) => ({ id: v.id, registration: v.registration?.trim() || "No registration", vor: v.vor === true })),
    shifts,
    checksToday,
    openDefects: rows.defects.map((d) => ({
      id: d.id,
      vehicleId: d.vehicle_id,
      finalSeverity: severity(d.final_severity),
      label: d.label,
      createdAt: d.created_at,
    })),
    pendingObjections: rows.objections.map((o) => {
      const defect = one(o.walkaround_defects);
      return {
        id: o.id,
        vehicleId: typeof defect?.vehicle_id === "string" ? defect.vehicle_id : "",
        defectLabel: typeof defect?.label === "string" ? defect.label : "a defect",
        driverName: nameOf(o.drivers, "A driver"),
        raisedAt: o.raised_at,
      };
    }),
    vehiclesOnJobsToday: [...new Set(rows.jobVehicleIds.filter((v): v is string => typeof v === "string" && v !== ""))],
  };
}

function fail(what: string, error: { message?: string } | null): never {
  throw new Error(`Could not load ${what}${error?.message ? `: ${error.message}` : "."}`);
}

export async function loadFleetInput(
  supabase: SupabaseClient,
  activeTenantId: string | null,
  today: string,
  now: Date,
  timeZone: string = OPERATOR_TIME_ZONE,
): Promise<FleetInput> {
  const range = operatorDayWindow(today, timeZone);
  if (!range) throw new Error(`"${today}" is not a calendar day.`);
  const scoped = <Q>(query: Q) => applyTenantFilter(query, activeTenantId);

  const [vehicles, drivers, shifts, checks, defects, objections, jobs] = await Promise.all([
    scoped(supabase.from("vehicles").select("id, registration, vor")).or("active.not.is.false,vor.eq.true").order("registration"),
    scoped(supabase.from("drivers").select("id", { count: "exact", head: true })).eq("active", true),
    scoped(supabase.from("driver_shifts").select("id, driver_id, started_at, ended_at, flags, drivers(name)"))
      .or(`ended_at.is.null,started_at.gte.${range.startIso}`)
      .order("started_at", { ascending: false })
      .limit(1000),
    scoped(supabase.from("walkaround_checks").select("id, vehicle_id, driver_id, performed_at, result, flags, drivers(name)"))
      .in("phase", ["start", "swap"])
      .gte("performed_at", range.startIso)
      .limit(2000),
    scoped(supabase.from("walkaround_defects").select("id, vehicle_id, final_severity, label, created_at"))
      .is("rectified_at", null)
      .limit(2000),
    scoped(supabase.from("defect_objections").select("id, raised_at, drivers(name), walkaround_defects(vehicle_id, label)"))
      .eq("status", "pending")
      .limit(500),
    scoped(supabase.from("jobs").select("vehicle_id"))
      .or(`scheduled_date.eq.${today},and(scheduled_date.is.null,job_date.eq.${today})`)
      .not("vehicle_id", "is", null)
      .limit(2000),
  ]);

  if (vehicles.error) fail("vehicles", vehicles.error);
  if (drivers.error) fail("drivers", drivers.error);
  if (shifts.error) fail("shifts", shifts.error);
  if (checks.error) fail("walkaround checks", checks.error);
  if (defects.error) fail("defects", defects.error);
  if (objections.error) fail("objections", objections.error);
  if (jobs.error) fail("today's jobs", jobs.error);

  const shiftRows = (shifts.data ?? []) as unknown as FleetRows["shifts"];
  const shiftIds = shiftRows.map((s) => s.id);
  let openBreaks: FleetRows["openBreaks"] = [];
  let periods: FleetRows["periods"] = [];
  if (shiftIds.length > 0) {
    const [breaks, vehiclePeriods] = await Promise.all([
      scoped(supabase.from("shift_breaks").select("shift_id")).in("shift_id", shiftIds).is("ended_at", null),
      scoped(supabase.from("shift_vehicle_periods").select("shift_id, vehicle_id, started_at, ended_at")).in("shift_id", shiftIds),
    ]);
    if (breaks.error) fail("breaks", breaks.error);
    if (vehiclePeriods.error) fail("vehicle periods", vehiclePeriods.error);
    openBreaks = (breaks.data ?? []) as FleetRows["openBreaks"];
    periods = (vehiclePeriods.data ?? []) as FleetRows["periods"];
  }

  return toFleetInput({
    now,
    activeDriverCount: drivers.count ?? 0,
    vehicles: (vehicles.data ?? []) as FleetRows["vehicles"],
    shifts: shiftRows,
    openBreaks,
    periods,
    checks: (checks.data ?? []) as unknown as FleetRows["checks"],
    defects: (defects.data ?? []) as FleetRows["defects"],
    objections: (objections.data ?? []) as unknown as FleetRows["objections"],
    jobVehicleIds: ((jobs.data ?? []) as { vehicle_id: string | null }[]).map((j) => j.vehicle_id),
  });
}
