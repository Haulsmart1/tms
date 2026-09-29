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
