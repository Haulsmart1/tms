/*
  May this driver complete stops and save PODs? Own-fleet drivers need an open
  shift whose current vehicle passed (or passed with minor defects) its
  walkaround and is not off the road. Subcontractor drivers run under their own
  O-licence and are not gated. Pure; lib/walkaround/server.ts loads the input.
*/

import type { DriverPortalType } from "../driver/session";
import type { CheckResult } from "./types";

export type JobGateInput = {
  portalType: DriverPortalType;
  openShift: null | {
    currentPeriod: null | { vehicleId: string; checkResult: CheckResult | null; vehicleVor: boolean };
  };
};

export const JOB_GATE_MESSAGES = {
  noShift: "Start your shift and complete a walkaround check before working on jobs.",
  noVehicle: "Complete a walkaround check on a vehicle before working on jobs.",
  noCheck: "The vehicle on your shift has not passed a walkaround check. Check a different vehicle before working on jobs.",
  vor: "The vehicle on your shift is off the road. Check a different vehicle before working on jobs.",
} as const;

export function jobGateDecision(input: JobGateInput): { ok: true } | { ok: false; message: string } {
  if (input.portalType !== "direct_driver") return { ok: true };
  if (!input.openShift) return { ok: false, message: JOB_GATE_MESSAGES.noShift };
  const period = input.openShift.currentPeriod;
  if (!period) return { ok: false, message: JOB_GATE_MESSAGES.noVehicle };
  if (period.checkResult !== "pass" && period.checkResult !== "minor") return { ok: false, message: JOB_GATE_MESSAGES.noCheck };
  if (period.vehicleVor) return { ok: false, message: JOB_GATE_MESSAGES.vor };
  return { ok: true };
}

/*
  The same gate, judged at the moment an offline-queued POD item was recorded
  rather than when it reached the server: a driver who delivered at 10:00 with
  a valid check is not refused because their shift ended before signal came
  back. VOR is only re-checked when the covering vehicle period is still open,
  because vehicles.vor has no history; a VOR raised after a closed period
  cannot be placed in time. That limit is deliberate and recorded in the spec.
*/
export type JobGateAtInput = {
  portalType: DriverPortalType;
  /** The shift the item names, or null when it does not exist for this driver. */
  shift: null | { startedAt: string; endedAt: string | null };
  /** The vehicle period whose [started_at, ended_at) contains the recorded time. */
  periodAt: null | { checkResult: CheckResult | null; open: boolean; vehicleVor: boolean };
};

export function jobGateDecisionAt(input: JobGateAtInput): { ok: true } | { ok: false; message: string } {
  if (input.portalType !== "direct_driver") return { ok: true };
  if (!input.shift) return { ok: false, message: JOB_GATE_MESSAGES.noShift };
  const period = input.periodAt;
  if (!period) return { ok: false, message: JOB_GATE_MESSAGES.noVehicle };
  if (period.checkResult !== "pass" && period.checkResult !== "minor") return { ok: false, message: JOB_GATE_MESSAGES.noCheck };
  if (period.open && period.vehicleVor) return { ok: false, message: JOB_GATE_MESSAGES.vor };
  return { ok: true };
}
