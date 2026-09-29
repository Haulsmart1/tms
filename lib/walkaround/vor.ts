/*
  When a walkaround VOR may be lifted. Pure and client-safe.

  THE CONTRACT with docs/sql/shifts_03_triggers.sql (guard_vehicle_return_to_service):
    errcode  WLK01
    message  RETURN_BLOCKED_MESSAGE below, verbatim
  Both sides must change together.
*/

import type { RoleTier } from "../auth/tenantAccess";
import type { ObjectionStatus, Severity } from "./types";

export const RETURN_BLOCKED_ERRCODE = "WLK01";
export const RETURN_BLOCKED_MESSAGE =
  "This vehicle has an open dangerous walkaround defect. Rectify it, or approve the driver's objection, before returning the vehicle to service.";

export type DefectVorState = {
  finalSeverity: Severity;
  rectifiedAt: string | null;
  objectionStatus: ObjectionStatus | null;
};

export function blocksReturnToService(defect: DefectVorState): boolean {
  return defect.finalSeverity === "dangerous" && defect.rectifiedAt === null && defect.objectionStatus !== "approved";
}

export function returnToServiceDecision(input: {
  tier: RoleTier;
  defects: readonly DefectVorState[];
}): { ok: true } | { ok: false; reason: "not-admin" } | { ok: false; reason: "open-dangerous-defects"; count: number } {
  if (input.tier !== "admin" && input.tier !== "super_admin") return { ok: false, reason: "not-admin" };
  const count = input.defects.filter(blocksReturnToService).length;
  return count > 0 ? { ok: false, reason: "open-dangerous-defects", count } : { ok: true };
}

export function vorReasonForDefects(labels: readonly string[]): string {
  const text = `Walkaround: ${labels.join("; ")}`;
  return text.length <= 200 ? text : `${text.slice(0, 197)}...`;
}

export function isReturnBlockedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === RETURN_BLOCKED_ERRCODE) return true;
  return typeof e.message === "string" && e.message.includes(RETURN_BLOCKED_MESSAGE);
}
