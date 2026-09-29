/*
  Apply one queued driver event (lib/shifts/events.ts). Server-only.
  The phone is never trusted for severity, vehicle identity or time sanity:
  each is recomputed here before the RPC in shifts_04 writes atomically.

  Idempotency comes FIRST: a repeated clientId answers 200 duplicate before any
  business check runs, so the retry of an event that was saved (whose vehicle
  has since gone VOR, or whose break has since closed) is never refused and
  never wedges the phone's queue. The RPCs repeat the lookup under their lock.

  Break, swap and end events name their shift (shiftClientId), so a late event
  only ever attaches to its own shift, never to whichever one is open now.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverSession } from "../driver/server";
import { loadOperatorProfile } from "../driver/operatorTimeZone";
import { operatorDayInTimeZone } from "../time";
import { hashQrToken } from "./qrTokenServer";
import { parseQrPayload, registrationsMatch } from "./qrToken";
import { toSnapshot } from "./catalogue";
import { checkResult, resolveDefect, type ResolvedDefect } from "./severity";
import { vorReasonForDefects } from "./vor";
import {
  KNOWN_RPC_REFUSALS,
  loadAssignedVehicleId,
  loadCatalogueRows,
  loadShiftByClientId,
  loadTenantVehicles,
  type OpenShiftRows,
} from "./server";
import { occurrenceCheck, type EventFlag } from "../shifts/syncRules";
import { validateBreakEnd, validateBreakStart } from "../shifts/hours";
import type { CheckSubmittedEvent, DriverEvent, QueuedDefect } from "../shifts/events";
import type { CatalogueItem } from "./types";

export type ProcessResult = { status: number; body: Record<string, unknown> };

const refuse = (status: number, error: string): ProcessResult => ({ status, body: { error } });

export const SHIFT_NOT_FOUND = "That shift was not found. Ask the office.";

function rpcDefects(resolved: readonly ResolvedDefect[]) {
  return resolved.map((d) => ({
    client_id: d.clientId,
    catalogue_item_id: d.catalogueItemId,
    label: d.label,
    catalogue_severity: d.catalogueSeverity,
    final_severity: d.finalSeverity,
    escalated: d.escalatedByDriver,
    source: d.severitySource,
    note: d.note,
  }));
}

function resolveAll(
  defects: readonly QueuedDefect[],
  catalogue: ReadonlyMap<string, CatalogueItem>,
): { ok: true; value: ResolvedDefect[] } | { ok: false; error: string } {
  const out: ResolvedDefect[] = [];
  for (const d of defects) {
    const r = resolveDefect(d, catalogue);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

function rpcError(error: { code?: string; message?: string }): ProcessResult {
  if (KNOWN_RPC_REFUSALS.includes(error.code ?? "")) return refuse(409, error.message ?? "Refused.");
  console.error("[walkaround] rpc failed", error.code, error.message);
  return refuse(500, "Unable to save. Try again.");
}

/** The latest time already recorded on the shift, for the out-of-order flag. */
function lastRecorded(rows: OpenShiftRows): string | null {
  if (!rows.shift) return null;
  return [rows.shift.startedAt, ...rows.breaks.flatMap((b) => [b.startedAt, b.endedAt ?? b.startedAt])].sort().at(-1) ?? null;
}

/*
  Where each event type's clientId is stored once it has been saved. A
  shift_ended with new defects also writes an end_of_shift check under the same
  clientId; driver_shifts.end_client_id is written in the same transaction.
*/
const IDEMPOTENCY_KEY: Record<DriverEvent["type"], { table: string; column: string; select: string }> = {
  check_submitted: { table: "walkaround_checks", column: "client_id", select: "id,shift_id,result" },
  break_started: { table: "shift_breaks", column: "client_id", select: "id" },
  break_ended: { table: "shift_breaks", column: "end_client_id", select: "id" },
  shift_ended: { table: "driver_shifts", column: "end_client_id", select: "id" },
  objection_raised: { table: "defect_objections", column: "client_id", select: "id,status" },
};

/** 200 duplicate when this event's clientId was already saved, else null. Runs before any business check. */
export async function findDuplicate(admin: SupabaseClient, tenantId: string, event: DriverEvent): Promise<ProcessResult | null> {
  const key = IDEMPOTENCY_KEY[event.type];
  const { data, error } = await admin
    .from(key.table)
    .select(key.select)
    .eq("tenant_id", tenantId)
    .eq(key.column, event.clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  if (event.type === "check_submitted") {
    return { status: 200, body: { ok: true, duplicate: true, check_id: row.id, shift_id: row.shift_id ?? null, result: row.result } };
  }
  if (event.type === "objection_raised") {
    return { status: 200, body: { ok: true, duplicate: true, objectionId: row.id, status: row.status } };
  }
  return { status: 200, body: { ok: true, duplicate: true } };
}

async function processCheck(admin: SupabaseClient, session: DriverSession, event: CheckSubmittedEvent, receivedAt: Date): Promise<ProcessResult> {
  const operator = await loadOperatorProfile(admin, session.tenantId);
  const companyId = operator.companyId ?? session.tenantId;
  const [vehicles, named, catalogueRows] = await Promise.all([
    loadTenantVehicles(admin, session.tenantId, operator.companyId),
    event.shiftClientId ? loadShiftByClientId(admin, session, event.shiftClientId) : Promise.resolve(null),
    loadCatalogueRows(admin, companyId),
  ]);
  // A swap names its shift; a start opens a new one (the RPC refuses SHF01 if one is open).
  if (event.phase === "swap" && !named?.shift) return refuse(409, SHIFT_NOT_FOUND);

  const timing = occurrenceCheck({ occurredAt: event.occurredAt, receivedAt, previousOccurredAt: named ? lastRecorded(named) : null });
  if (!timing.ok) return refuse(400, timing.error);
  const flags: string[] = [...timing.flags];

  const vehicle = vehicles.find((v) => v.id === event.vehicleId);
  if (!vehicle) return refuse(404, "That vehicle is not in your fleet.");
  if (vehicle.vor) return refuse(409, `${vehicle.registration} is off the road and cannot be taken out.`);
  if (!vehicle.active) return refuse(409, `${vehicle.registration} is not active. Ask the office.`);

  if (event.confirmation === "qr") {
    const token = parseQrPayload(event.qrPayload ?? "");
    if (!token || !vehicle.qrTokenHash || hashQrToken(token) !== vehicle.qrTokenHash) {
      return refuse(409, "That QR code is not for this vehicle. It may have been reissued. Type the registration instead.");
    }
  } else if (!registrationsMatch(event.typedRegistration ?? "", vehicle.registration)) {
    return refuse(409, `The registration you typed does not match ${vehicle.registration}.`);
  }

  const today = operatorDayInTimeZone(new Date(event.occurredAt), operator.timeZone);
  const assignedId = await loadAssignedVehicleId(admin, session, today);
  if (assignedId && assignedId !== vehicle.id) {
    if (!event.mismatchReason?.trim()) return refuse(400, "Say why you are taking a different vehicle.");
    flags.push("assigned_vehicle_mismatch");
  }

  // Every checklist item the phone showed must still exist, belong to this
  // company or the baseline, and not be retired.
  const catalogue = new Map(catalogueRows.map((i) => [i.id, i]));
  const shown: CatalogueItem[] = [];
  for (const id of event.checklistItemIds) {
    const item = catalogue.get(id);
    if (!item || item.retiredAt !== null) return refuse(409, "The checklist has changed. Reload the check and try again.");
    shown.push(item);
  }

  const resolved = resolveAll(event.defects, catalogue);
  if (!resolved.ok) return refuse(400, resolved.error);
  // The phone cannot downgrade; log any attempt (spec: a mismatch is logged).
  if (resolved.value.some((d) => d.finalSeverity === "dangerous" && event.defects.find((x) => x.clientId === d.clientId)?.driverSeverity === "minor")) {
    console.warn("[walkaround] phone tried to lower a dangerous defect", session.driverId);
  }

  const result = checkResult(resolved.value);
  const dangerousLabels = resolved.value.filter((d) => d.finalSeverity === "dangerous").map((d) => d.label);

  const { data, error } = await admin.rpc("walkaround_submit_check", {
    p: {
      tenant_id: session.tenantId,
      driver_id: session.driverId,
      user_id: session.userId,
      client_id: event.clientId,
      shift_client_id: event.shiftClientId,
      phase: event.phase,
      performed_at: event.occurredAt,
      vehicle_id: vehicle.id,
      confirmation: event.confirmation,
      mismatch_reason: event.mismatchReason?.trim() || null,
      odometer: event.odometer,
      previous_end_odometer: event.previousEndOdometer,
      result,
      snapshot: toSnapshot(shown),
      flags,
      vor_reason: dangerousLabels.length ? vorReasonForDefects(dangerousLabels) : null,
      defects: rpcDefects(resolved.value),
    },
  });
  if (error) return rpcError(error);
  return { status: 200, body: { ok: true, ...(data as Record<string, unknown>) } };
}

async function processShiftEvent(admin: SupabaseClient, session: DriverSession, event: Exclude<DriverEvent, CheckSubmittedEvent | { type: "objection_raised" }>, receivedAt: Date): Promise<ProcessResult> {
  const named = await loadShiftByClientId(admin, session, event.shiftClientId);
  if (!named.shift) return refuse(409, SHIFT_NOT_FOUND);
  const timing = occurrenceCheck({ occurredAt: event.occurredAt, receivedAt, previousOccurredAt: lastRecorded(named) });
  if (!timing.ok) return refuse(400, timing.error);
  const flags: EventFlag[] = timing.flags;

  // Break rules apply to a shift that is still open. For one the office has
  // already ended, the RPC attaches or flags the late event instead (office wins).
  if (named.shift.endedAt === null && event.type === "break_started") {
    const v = validateBreakStart({ startedAt: named.shift.startedAt, endedAt: null, breaks: named.breaks }, event.occurredAt);
    if (!v.ok) return refuse(409, v.error);
  }
  if (named.shift.endedAt === null && event.type === "break_ended") {
    const v = validateBreakEnd(
      named.breaks.find((b) => b.endedAt === null) ?? null,
      event.occurredAt,
      named.breaks.filter((b) => b.endedAt !== null),
    );
    if (!v.ok) return refuse(409, v.error);
  }

  let endCheck: Record<string, unknown> | null = null;
  if (event.type === "shift_ended" && event.newDefects.length > 0) {
    const operator = await loadOperatorProfile(admin, session.tenantId);
    const catalogueRows = await loadCatalogueRows(admin, operator.companyId ?? session.tenantId);
    const catalogue = new Map(catalogueRows.map((i) => [i.id, i]));
    const resolved = resolveAll(event.newDefects, catalogue);
    if (!resolved.ok) return refuse(400, resolved.error);
    const reported = resolved.value.map((d) => d.catalogueItemId).filter((id): id is string => Boolean(id));
    const dangerousLabels = resolved.value.filter((d) => d.finalSeverity === "dangerous").map((d) => d.label);
    endCheck = {
      client_id: event.clientId,
      result: checkResult(resolved.value),
      snapshot: toSnapshot(reported.map((id) => catalogue.get(id)).filter((i): i is CatalogueItem => Boolean(i))),
      vor_reason: dangerousLabels.length ? vorReasonForDefects(dangerousLabels) : null,
      defects: rpcDefects(resolved.value),
    };
  }

  const { data, error } = await admin.rpc("shift_record_event", {
    p: {
      tenant_id: session.tenantId,
      driver_id: session.driverId,
      type: event.type,
      client_id: event.clientId,
      shift_client_id: event.shiftClientId,
      occurred_at: event.occurredAt,
      flags,
      odometer: event.type === "shift_ended" ? event.odometer : null,
      end_check: endCheck,
    },
  });
  if (error) return rpcError(error);
  return { status: 200, body: { ok: true, ...(data as Record<string, unknown>) } };
}

async function processObjection(admin: SupabaseClient, session: DriverSession, event: Extract<DriverEvent, { type: "objection_raised" }>): Promise<ProcessResult> {
  // The defect must be on one of THIS driver's checks and be dangerous.
  const { data: defect, error } = await admin
    .from("walkaround_defects")
    .select("id,final_severity,rectified_at,walkaround_checks!inner(driver_id)")
    .eq("tenant_id", session.tenantId)
    .eq("client_id", event.defectClientId)
    .eq("walkaround_checks.driver_id", session.driverId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!defect) return refuse(404, "That defect was not found. If you are offline, it will be sent after your check.");
  if (defect.final_severity !== "dangerous") return refuse(409, "Only a defect that took the vehicle off the road can be objected to.");
  if (defect.rectified_at) return refuse(409, "That defect has already been fixed.");

  const { data: inserted, error: insertError } = await admin
    .from("defect_objections")
    .insert({ tenant_id: session.tenantId, defect_id: defect.id, driver_id: session.driverId, client_id: event.clientId, reason: event.reason, raised_at: event.occurredAt })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      // A concurrent retry of this same event won the insert: still a duplicate, not a refusal.
      const again = await findDuplicate(admin, session.tenantId, event);
      if (again) return again;
      return refuse(409, "An objection to this defect is already waiting for a decision.");
    }
    throw new Error(insertError.message);
  }
  return { status: 200, body: { ok: true, duplicate: false, objectionId: inserted.id } };
}

export async function processDriverEvent(admin: SupabaseClient, session: DriverSession, event: DriverEvent, receivedAt: Date): Promise<ProcessResult> {
  const duplicate = await findDuplicate(admin, session.tenantId, event);
  if (duplicate) return duplicate;
  if (event.type === "check_submitted") return processCheck(admin, session, event, receivedAt);
  if (event.type === "objection_raised") return processObjection(admin, session, event);
  return processShiftEvent(admin, session, event, receivedAt);
}
