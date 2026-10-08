/*
  May this driver complete stops and save PODs? Own-fleet drivers need an open
  shift whose current vehicle passed (or passed with minor defects) a
  walkaround check done within the last WALKAROUND_CHECK_MAX_AGE_HOURS, and
  is not off the road. Subcontractor drivers run under their own O-licence
  and are not gated. Pure; lib/walkaround/server.ts loads the input.
*/

import type { DriverPortalType } from "../driver/session";
import type { CheckResult } from "./types";

/*
  How long a passing walkaround check unlocks jobs. The check is a daily
  first-use check, so a shift left open (no shift_ended event) must not keep
  unlocking jobs on the following days (security scan S-2). A fixed window
  rather than the operator's calendar day, so a night shift that crosses
  midnight is not refused halfway through. Measured from the check's
  performed_at to the moment being judged: now for a live request, the
  recorded time for an offline-queued one.
*/
export const WALKAROUND_CHECK_MAX_AGE_HOURS = 24;
const MAX_CHECK_AGE_MS = WALKAROUND_CHECK_MAX_AGE_HOURS * 60 * 60 * 1000;

export type JobGateInput = {
  portalType: DriverPortalType;
  openShift: null | {
    currentPeriod: null | {
      vehicleId: string;
      checkResult: CheckResult | null;
      /** The covering check's performed_at; null when it could not be read (refused). */
      checkPerformedAt: string | null;
      vehicleVor: boolean;
    };
  };
};

export const JOB_GATE_MESSAGES = {
  noShift: "Start your shift and complete a walkaround check before working on jobs.",
  noVehicle: "Complete a walkaround check on a vehicle before working on jobs.",
  noCheck: "The vehicle on your shift has not passed a walkaround check. Check a different vehicle before working on jobs.",
  checkExpired: `Your walkaround check is more than ${WALKAROUND_CHECK_MAX_AGE_HOURS} hours old. Do a new walkaround check before working on jobs.`,
  vor: "The vehicle on your shift is off the road. Check a different vehicle before working on jobs.",
} as const;

/** True when a check performed at `performedAt` still covers work at `at`. A missing or unreadable time fails closed. */
export function checkStillValid(performedAt: string | null, at: Date): boolean {
  if (!performedAt) return false;
  const performed = Date.parse(performedAt);
  if (Number.isNaN(performed)) return false;
  return at.getTime() - performed <= MAX_CHECK_AGE_MS;
}

export function jobGateDecision(input: JobGateInput, now: Date = new Date()): { ok: true } | { ok: false; message: string } {
  if (input.portalType !== "direct_driver") return { ok: true };
  if (!input.openShift) return { ok: false, message: JOB_GATE_MESSAGES.noShift };
  const period = input.openShift.currentPeriod;
  if (!period) return { ok: false, message: JOB_GATE_MESSAGES.noVehicle };
  if (period.checkResult !== "pass" && period.checkResult !== "minor") return { ok: false, message: JOB_GATE_MESSAGES.noCheck };
  if (!checkStillValid(period.checkPerformedAt, now)) return { ok: false, message: JOB_GATE_MESSAGES.checkExpired };
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
  The check's age is judged at the recorded time too: it must have been done
  within WALKAROUND_CHECK_MAX_AGE_HOURS before it.
*/
export type JobGateAtInput = {
  portalType: DriverPortalType;
  /** The recorded time being judged (already trusted by acceptRecordedTime). */
  at: string;
  /** The shift the item names, or null when it does not exist for this driver. */
  shift: null | { startedAt: string; endedAt: string | null };
  /** The vehicle period whose [started_at, ended_at) contains the recorded time. */
  periodAt: null | { checkResult: CheckResult | null; checkPerformedAt: string | null; open: boolean; vehicleVor: boolean };
};

export function jobGateDecisionAt(input: JobGateAtInput): { ok: true } | { ok: false; message: string } {
  if (input.portalType !== "direct_driver") return { ok: true };
  if (!input.shift) return { ok: false, message: JOB_GATE_MESSAGES.noShift };
  const period = input.periodAt;
  if (!period) return { ok: false, message: JOB_GATE_MESSAGES.noVehicle };
  if (period.checkResult !== "pass" && period.checkResult !== "minor") return { ok: false, message: JOB_GATE_MESSAGES.noCheck };
  if (!checkStillValid(period.checkPerformedAt, new Date(input.at))) return { ok: false, message: JOB_GATE_MESSAGES.checkExpired };
  if (period.open && period.vehicleVor) return { ok: false, message: JOB_GATE_MESSAGES.vor };
  return { ok: true };
}
