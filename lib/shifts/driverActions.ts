/*
  Building the driver app's shift events from the state the phone shows, and
  the small derived facts the dashboard needs. Pure and client-safe; the
  caller supplies the clientId (crypto.randomUUID()) and occurredAt.

  Hours here are RECORDED hours, what the driver logged. Nothing in this file
  checks any legal limit.
*/

import type { DriverShiftState } from "../walkaround/driverState";
import { jobGateDecision } from "../walkaround/jobGate";
import type { DriverEvent, QueuedDefect } from "./events";
import { summariseShift, type ShiftSummary } from "./hours";

export type EventStamp = { clientId: string; occurredAt: string };
type Built<E> = { ok: true; event: E } | { ok: false; error: string };

export const OBJECTION_MIN = 3;
export const OBJECTION_MAX = 1000;
const ODOMETER_MAX = 9_999_999;

export function breakEvent(
  state: DriverShiftState,
  type: "break_started" | "break_ended",
  stamp: EventStamp,
): Built<Extract<DriverEvent, { type: "break_started" | "break_ended" }>> {
  const shift = state.openShift;
  if (!shift) return { ok: false, error: "You are not on shift." };
  if (type === "break_started" && shift.onBreak) return { ok: false, error: "You are already on a break." };
  if (type === "break_ended" && !shift.onBreak) return { ok: false, error: "You are not on a break." };
  return { ok: true, event: { type, ...stamp, shiftClientId: shift.clientId } };
}

/** Whole number, no separators, as typed on the phone keypad. */
export function parseOdometer(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,7}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= ODOMETER_MAX ? value : null;
}

export function endShiftEvent(
  state: DriverShiftState,
  odometerText: string,
  newDefects: readonly QueuedDefect[],
  stamp: EventStamp,
): Built<Extract<DriverEvent, { type: "shift_ended" }>> {
  const shift = state.openShift;
  if (!shift) return { ok: false, error: "You are not on shift." };
  if (newDefects.length > 0 && !shift.currentVehicle) {
    return { ok: false, error: "You have no checked vehicle to report defects on. Tell the office." };
  }
  // No vehicle on the shift (office-started, never checked): there is no
  // vehicle to read, so no odometer is sent rather than a made-up one.
  let odometer: number | null = null;
  if (shift.currentVehicle) {
    odometer = parseOdometer(odometerText);
    if (odometer === null) return { ok: false, error: "Enter the odometer reading as a whole number." };
  }
  return { ok: true, event: { type: "shift_ended", ...stamp, shiftClientId: shift.clientId, odometer, newDefects: [...newDefects] } };
}

export function objectionEvent(
  state: DriverShiftState,
  defectClientId: string,
  reasonText: string,
  stamp: EventStamp,
): Built<Extract<DriverEvent, { type: "objection_raised" }>> {
  const defect = state.blockingCheck?.defects.find((d) => d.clientId === defectClientId);
  if (!defect) return { ok: false, error: "That defect is no longer stopping you." };
  if (defect.objection) return { ok: false, error: "You have already objected to this defect." };
  const reason = reasonText.trim();
  if (reason.length < OBJECTION_MIN) return { ok: false, error: "Say why you object (at least 3 characters)." };
  if (reason.length > OBJECTION_MAX) return { ok: false, error: "Keep the reason under 1000 characters." };
  return { ok: true, event: { type: "objection_raised", ...stamp, defectClientId, reason } };
}

/** The same rule the stop routes enforce, fed from what the phone shows. */
export function gateForState(state: DriverShiftState, now: Date = new Date()): { ok: true } | { ok: false; message: string } {
  const shift = state.openShift;
  const vehicle = shift?.currentVehicle ?? null;
  return jobGateDecision({
    portalType: "direct_driver",
    openShift: shift
      ? {
          currentPeriod: vehicle
            ? {
                vehicleId: vehicle.vehicleId,
                checkResult: vehicle.checkResult,
                checkPerformedAt: vehicle.checkPerformedAt,
                vehicleVor: state.vehicles.some((v) => v.id === vehicle.vehicleId && v.vor),
              }
            : null,
        }
      : null,
  }, now);
}

/** Where "Check a different vehicle" and "Swap vehicle" lead. */
export function walkaroundHref(state: DriverShiftState): string {
  return state.openShift ? "/driver/walkaround?phase=swap" : "/driver/walkaround?phase=start";
}

export function recordedHours(state: DriverShiftState, now: Date): ShiftSummary | null {
  const shift = state.openShift;
  if (!shift) return null;
  return summariseShift({ startedAt: shift.startedAt, endedAt: null, breaks: shift.breaks, periods: [] }, now);
}

/** "05:48" in the operator's time zone (the device's own if that zone is unusable). */
export function clockTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
}
