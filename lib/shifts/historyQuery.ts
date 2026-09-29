/*
  Browser loader for the /shifts History tab: shifts that started inside a
  range of operator days, with their breaks, vehicle periods and office
  corrections. RLS is the boundary; applyTenantFilter scopes to the selected
  tenant. Throws on a query error so the page can show an error state.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyTenantFilter } from "../tenant/filter";
import { one } from "./fleetQuery";
import type { ShiftForHours, TimeInterval } from "./hours";

export const HISTORY_SHIFT_LIMIT = 1000;

export type HistoryCorrection = {
  id: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  correctedAt: string;
  correctedBy: string;
};

export type HistoryPeriod = {
  vehicleId: string;
  registration: string;
  startedAt: string;
  startOdometer: number;
  endOdometer: number | null;
};

export type HistoryShift = {
  id: string;
  tenantId: string;
  driverId: string;
  driverName: string;
  startedAt: string;
  endedAt: string | null;
  endedBy: string | null;
  flags: string[];
  breaks: TimeInterval[];
  periods: HistoryPeriod[];
  corrections: HistoryCorrection[];
};

type ShiftRow = {
  id: string;
  tenant_id: string;
  driver_id: string;
  started_at: string;
  ended_at: string | null;
  ended_by: string | null;
  flags: unknown;
  drivers: { name?: unknown } | { name?: unknown }[] | null;
};
type BreakRow = { shift_id: string; started_at: string; ended_at: string | null };
type PeriodRow = {
  shift_id: string;
  vehicle_id: string;
  started_at: string;
  start_odometer: number;
  end_odometer: number | null;
  vehicles: { registration?: unknown } | { registration?: unknown }[] | null;
};
type CorrectionRow = {
  id: string;
  shift_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  reason: string;
  corrected_at: string;
  corrected_by_user_id: string;
};

export type HistoryRows = {
  shifts: ShiftRow[];
  breaks: BreakRow[];
  periods: PeriodRow[];
  corrections: CorrectionRow[];
  userNames: Map<string, string>;
};

export function toHistoryShifts(rows: HistoryRows): HistoryShift[] {
  return rows.shifts.map((s) => {
    const driver = one(s.drivers);
    return {
      id: s.id,
      tenantId: s.tenant_id,
      driverId: s.driver_id,
      driverName: typeof driver?.name === "string" && driver.name.trim() ? driver.name : "Unknown driver",
      startedAt: s.started_at,
      endedAt: s.ended_at,
      endedBy: s.ended_by,
      flags: Array.isArray(s.flags) ? s.flags.map(String) : [],
      breaks: rows.breaks
        .filter((b) => b.shift_id === s.id)
        .map((b) => ({ startedAt: b.started_at, endedAt: b.ended_at }))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
      periods: rows.periods
        .filter((p) => p.shift_id === s.id)
        .sort((a, b) => a.started_at.localeCompare(b.started_at))
        .map((p) => {
          const vehicle = one(p.vehicles);
          return {
            vehicleId: p.vehicle_id,
            registration: typeof vehicle?.registration === "string" && vehicle.registration.trim() ? vehicle.registration : "Unknown vehicle",
            startedAt: p.started_at,
            startOdometer: Number(p.start_odometer),
            endOdometer: p.end_odometer === null ? null : Number(p.end_odometer),
          };
        }),
      corrections: rows.corrections
        .filter((c) => c.shift_id === s.id)
        .sort((a, b) => a.corrected_at.localeCompare(b.corrected_at))
        .map((c) => ({
          id: c.id,
          field: c.field,
          oldValue: c.old_value,
          newValue: c.new_value,
          reason: c.reason,
          correctedAt: c.corrected_at,
          correctedBy: rows.userNames.get(c.corrected_by_user_id) ?? "An office user",
        })),
    };
  });
}

/** The shape summariseShift needs. */
export function forHours(shift: HistoryShift): ShiftForHours {
  return {
    startedAt: shift.startedAt,
    endedAt: shift.endedAt,
    breaks: shift.breaks,
    periods: shift.periods.map((p) => ({ startOdometer: p.startOdometer, endOdometer: p.endOdometer })),
  };
}

export type HistoryResult = { shifts: HistoryShift[]; truncated: boolean };

export async function loadShiftHistory(
  supabase: SupabaseClient,
  activeTenantId: string | null,
  range: { startIso: string; endIso: string },
  driverId: string | null,
): Promise<HistoryResult> {
  const scoped = <Q>(query: Q) => applyTenantFilter(query, activeTenantId);

  let shiftQuery = scoped(
    supabase.from("driver_shifts").select("id, tenant_id, driver_id, started_at, ended_at, ended_by, flags, drivers(name)"),
  )
    .gte("started_at", range.startIso)
    .lt("started_at", range.endIso);
  if (driverId) shiftQuery = shiftQuery.eq("driver_id", driverId);
  const shifts = await shiftQuery.order("started_at", { ascending: false }).limit(HISTORY_SHIFT_LIMIT);
  if (shifts.error) throw new Error(`Could not load shifts: ${shifts.error.message}`);

  const shiftRows = (shifts.data ?? []) as unknown as ShiftRow[];
  const ids = shiftRows.map((s) => s.id);
  if (ids.length === 0) return { shifts: [], truncated: false };

  const [breaks, periods, corrections] = await Promise.all([
    scoped(supabase.from("shift_breaks").select("shift_id, started_at, ended_at")).in("shift_id", ids),
    scoped(
      supabase.from("shift_vehicle_periods").select("shift_id, vehicle_id, started_at, start_odometer, end_odometer, vehicles(registration)"),
    ).in("shift_id", ids),
    scoped(
      supabase.from("shift_corrections").select("id, shift_id, field, old_value, new_value, reason, corrected_at, corrected_by_user_id"),
    ).in("shift_id", ids),
  ]);
  if (breaks.error) throw new Error(`Could not load breaks: ${breaks.error.message}`);
  if (periods.error) throw new Error(`Could not load vehicle periods: ${periods.error.message}`);
  if (corrections.error) throw new Error(`Could not load corrections: ${corrections.error.message}`);

  const correctionRows = (corrections.data ?? []) as CorrectionRow[];
  const userNames = new Map<string, string>();
  const userIds = [...new Set(correctionRows.map((c) => c.corrected_by_user_id))];
  if (userIds.length > 0) {
    // Best effort: a name the caller cannot read falls back to "An office user".
    const { data } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name?.trim()) userNames.set(p.id, p.full_name.trim());
    }
  }

  return {
    shifts: toHistoryShifts({
      shifts: shiftRows,
      breaks: (breaks.data ?? []) as BreakRow[],
      periods: (periods.data ?? []) as unknown as PeriodRow[],
      corrections: correctionRows,
      userNames,
    }),
    truncated: shiftRows.length >= HISTORY_SHIFT_LIMIT,
  };
}
