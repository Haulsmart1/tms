/*
  Server-only loaders for driver shifts and walkaround checks. Every function
  takes the service-role client, so every query is filtered by the tenant and
  driver the caller was already authorized for. Never import from client code.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { DriverAccessError, requireDriverSession, type DriverSession } from "../driver/server";
import { loadOperatorProfile } from "../driver/operatorTimeZone";
import { acceptRecordedTime } from "../pod/recordedTime";
import type { QueuedMeta } from "../pod/queuedMeta";
import { operatorDayInTimeZone } from "../time";
import { activeCatalogue } from "./catalogue";
import type { DriverDefectView, DriverShiftState } from "./driverState";
import { jobGateDecision, jobGateDecisionAt, type JobGateInput } from "./jobGate";
import { dangerReason } from "./severity";
import type { CatalogueItem, CheckResult, ObjectionStatus, Severity, SeveritySource } from "./types";

export async function requireDirectDriver(options: { jobId?: string } = {}): Promise<DriverSession> {
  const session = await requireDriverSession(options);
  if (session.portalType !== "direct_driver") {
    throw new DriverAccessError("Shifts and walkaround checks are for your own fleet's drivers.", 403);
  }
  return session;
}

const CATALOGUE_SELECT = "id,company_id,code,category,item_label,defect_label,guidance,severity,applies_to,sort_order,retired_at";

export function toCatalogueItem(row: Record<string, unknown>): CatalogueItem {
  return {
    id: String(row.id),
    companyId: row.company_id ? String(row.company_id) : null,
    code: String(row.code),
    category: String(row.category),
    itemLabel: String(row.item_label),
    defectLabel: String(row.defect_label),
    guidance: String(row.guidance ?? ""),
    severity: row.severity === "dangerous" ? "dangerous" : "minor",
    appliesTo: row.applies_to === "trailer" || row.applies_to === "both" ? row.applies_to : "vehicle",
    sortOrder: Number(row.sort_order ?? 0),
    retiredAt: row.retired_at ? String(row.retired_at) : null,
  };
}

/** Baseline plus this company's rows, INCLUDING retired ones (severity needs to see them to refuse them). */
export async function loadCatalogueRows(admin: SupabaseClient, companyId: string): Promise<CatalogueItem[]> {
  const { data, error } = await admin
    .from("defect_catalogue_items")
    .select(CATALOGUE_SELECT)
    .or(`company_id.is.null,company_id.eq.${companyId}`);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toCatalogueItem(row as Record<string, unknown>));
}

export type TenantVehicle = { id: string; registration: string; vor: boolean; active: boolean; qrTokenHash: string | null };

/** vehicles has no company_id; some legacy rows carry the company id in tenant_id, so both are read. */
export async function loadTenantVehicles(admin: SupabaseClient, tenantId: string, companyId: string | null): Promise<TenantVehicle[]> {
  const keys = [...new Set([tenantId, companyId].filter((v): v is string => Boolean(v)))];
  const { data, error } = await admin
    .from("vehicles")
    .select("id,registration,vor,active,walkaround_qr_token_hash")
    .in("tenant_id", keys);
  if (error) throw new Error(error.message);
  return (data ?? []).map((v) => ({
    id: String(v.id),
    registration: String(v.registration ?? "").trim() || "Unregistered",
    vor: v.vor === true,
    active: v.active !== false,
    qrTokenHash: v.walkaround_qr_token_hash ? String(v.walkaround_qr_token_hash) : null,
  }));
}

export async function loadAssignedVehicleId(admin: SupabaseClient, session: DriverSession, today: string): Promise<string | null> {
  const { data: assignment, error } = await admin
    .from("vehicle_assignments")
    .select("vehicle_id")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .eq("active", true)
    .not("vehicle_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (assignment?.vehicle_id) return String(assignment.vehicle_id);

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("vehicle_id")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .or(`scheduled_date.eq.${today},and(scheduled_date.is.null,job_date.eq.${today})`)
    .not("vehicle_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  return job?.vehicle_id ? String(job.vehicle_id) : null;
}

export type OpenShiftRows = {
  shift: { id: string; clientId: string; startedAt: string; endedAt: string | null; flags: string[] } | null;
  breaks: { startedAt: string; endedAt: string | null }[];
  period: { id: string; vehicleId: string; startOdometer: number; checkResult: CheckResult | null; vehicleVor: boolean } | null;
};

const SHIFT_SELECT = "id,client_id,started_at,ended_at,flags";

async function shiftDetail(admin: SupabaseClient, shift: Record<string, unknown> | null): Promise<OpenShiftRows> {
  if (!shift) return { shift: null, breaks: [], period: null };
  const shiftId = String(shift.id);

  const [breaksResult, periodResult] = await Promise.all([
    admin.from("shift_breaks").select("started_at,ended_at").eq("shift_id", shiftId).order("started_at"),
    admin
      .from("shift_vehicle_periods")
      .select("id,vehicle_id,start_odometer,walkaround_check_id")
      .eq("shift_id", shiftId)
      .is("ended_at", null)
      .maybeSingle(),
  ]);
  if (breaksResult.error) throw new Error(breaksResult.error.message);
  if (periodResult.error) throw new Error(periodResult.error.message);

  let period: OpenShiftRows["period"] = null;
  if (periodResult.data) {
    const p = periodResult.data;
    const [checkResult, vehicleResult] = await Promise.all([
      admin.from("walkaround_checks").select("result").eq("id", p.walkaround_check_id).maybeSingle(),
      admin.from("vehicles").select("vor").eq("id", p.vehicle_id).maybeSingle(),
    ]);
    if (checkResult.error) throw new Error(checkResult.error.message);
    if (vehicleResult.error) throw new Error(vehicleResult.error.message);
    period = {
      id: String(p.id),
      vehicleId: String(p.vehicle_id),
      startOdometer: Number(p.start_odometer),
      checkResult: (checkResult.data?.result as CheckResult | undefined) ?? null,
      vehicleVor: vehicleResult.data?.vor === true,
    };
  }

  return {
    shift: {
      id: shiftId,
      clientId: String(shift.client_id),
      startedAt: String(shift.started_at),
      endedAt: shift.ended_at ? String(shift.ended_at) : null,
      flags: (shift.flags as string[]) ?? [],
    },
    breaks: (breaksResult.data ?? []).map((b) => ({ startedAt: String(b.started_at), endedAt: b.ended_at ? String(b.ended_at) : null })),
    period,
  };
}

export async function loadOpenShift(admin: SupabaseClient, session: DriverSession): Promise<OpenShiftRows> {
  const { data: shift, error } = await admin
    .from("driver_shifts")
    .select(SHIFT_SELECT)
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return shiftDetail(admin, shift as Record<string, unknown> | null);
}

/** The shift a queued event names (open or already ended), for this driver only. */
export async function loadShiftByClientId(admin: SupabaseClient, session: DriverSession, shiftClientId: string): Promise<OpenShiftRows> {
  const { data: shift, error } = await admin
    .from("driver_shifts")
    .select(SHIFT_SELECT)
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .eq("client_id", shiftClientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return shiftDetail(admin, shift as Record<string, unknown> | null);
}

export async function loadJobGateInput(admin: SupabaseClient, session: DriverSession): Promise<JobGateInput> {
  if (session.portalType !== "direct_driver") return { portalType: session.portalType, openShift: null };
  const open = await loadOpenShift(admin, session);
  return {
    portalType: session.portalType,
    openShift: open.shift
      ? { currentPeriod: open.period ? { vehicleId: open.period.vehicleId, checkResult: open.period.checkResult, vehicleVor: open.period.vehicleVor } : null }
      : null,
  };
}

/** Answered with 503 when the gate cannot be judged, so the offline queue retries it. */
const GATE_UNAVAILABLE_MESSAGE = "Walkaround checks are not available right now, so jobs cannot be completed. Ask the office.";

/**
  The job gate for stop completion and POD routes. Returns a 409 response when
  the driver may not work, or null. FAILS CLOSED: if the shift tables are
  missing (SQL not applied yet) or a lookup fails, the driver is refused with
  a 503, not a 409: the offline queue retries a 503 with backoff (and sets it
  aside after repeated failures) instead of deleting a queued POD over a
  database blip. Genuine gate refusals stay 409.
*/
export async function jobGateResponse(admin: SupabaseClient, session: DriverSession): Promise<NextResponse | null> {
  if (session.portalType !== "direct_driver") return null;
  let input: JobGateInput;
  try {
    input = await loadJobGateInput(admin, session);
  } catch (error) {
    console.error("[walkaround] job gate lookup failed", error);
    return NextResponse.json({ error: GATE_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  const decision = jobGateDecision(input);
  return decision.ok ? null : NextResponse.json({ error: decision.message }, { status: 409 });
}

/** The named shift's bounds, for jobGateDecisionAt. Null when this driver has no shift with that client id. */
async function loadGateRowsAt(
  admin: SupabaseClient,
  session: DriverSession,
  shiftClientId: string,
): Promise<{ shift: { id: string; startedAt: string; endedAt: string | null } | null }> {
  const { data, error } = await admin
    .from("driver_shifts")
    .select("id,started_at,ended_at")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .eq("client_id", shiftClientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { shift: null };
  return { shift: { id: String(data.id), startedAt: String(data.started_at), endedAt: data.ended_at ? String(data.ended_at) : null } };
}

/**
  The vehicle period of `shiftId` whose [started_at, ended_at) contains `at`,
  with its check result and (if still open) VOR. The check and vehicle
  lookups are pinned to the session's tenant (the vehicle also by the company
  id, which legacy rows carry in tenant_id, the same rule as the shifts_04
  RPCs). A check from elsewhere reads as no check and refuses; an open
  period's vehicle that is not in this fleet throws, so the gate answers 503
  rather than reading "not VOR" from a missing row.
*/
async function loadPeriodAt(admin: SupabaseClient, tenantId: string, shiftId: string, at: string) {
  const { data, error } = await admin
    .from("shift_vehicle_periods")
    .select("vehicle_id,walkaround_check_id,started_at,ended_at")
    .eq("shift_id", shiftId)
    .lte("started_at", at)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  if (data.ended_at && Date.parse(String(data.ended_at)) <= Date.parse(at)) return null;

  const open = !data.ended_at;
  const [check, vehicle] = await Promise.all([
    admin.from("walkaround_checks").select("result").eq("id", data.walkaround_check_id).eq("tenant_id", tenantId).maybeSingle(),
    open ? loadFleetVehicleVor(admin, tenantId, String(data.vehicle_id)) : Promise.resolve(false),
  ]);
  if (check.error) throw new Error(check.error.message);
  return {
    checkResult: (check.data?.result as CheckResult | undefined) ?? null,
    open,
    vehicleVor: vehicle,
  };
}

async function loadFleetVehicleVor(admin: SupabaseClient, tenantId: string, vehicleId: string): Promise<boolean> {
  const { data: tenant, error: tenantError } = await admin.from("tenants").select("company_id").eq("id", tenantId).maybeSingle();
  if (tenantError) throw new Error(tenantError.message);
  const keys = [...new Set([tenantId, tenant?.company_id ? String(tenant.company_id) : null].filter((v): v is string => Boolean(v)))];
  const { data, error } = await admin.from("vehicles").select("vor").eq("id", vehicleId).in("tenant_id", keys).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The shift's vehicle is not in this tenant's fleet.");
  return data.vor === true;
}

export type QueuedGateResult = {
  /** A 409 refusal, a 503 when the gate could not be judged, or null when the driver may proceed. */
  response: NextResponse | null;
  /** The time to record: the phone's when trusted, otherwise the server's. */
  at: string;
  trusted: boolean;
};

/**
  The job gate for a request from the offline queue. Trusted recorded time:
  the gate is judged at that time against the shift the item names. Untrusted
  time, or no shift client id: today's open-shift rule, at server time.
  `notBefore` (the job's created_at) bounds the recorded time from below for
  every driver, so a POD cannot be dated before its job existed.
  FAILS CLOSED like jobGateResponse: a lookup failure answers 503 (retryable).
*/
export async function queuedJobGate(
  admin: SupabaseClient,
  session: DriverSession,
  meta: QueuedMeta,
  options: { notBefore?: string | null; now?: Date } = {},
): Promise<QueuedGateResult> {
  const now = options.now ?? new Date();
  const notBefore = options.notBefore ?? null;
  const refuse = (message: string): QueuedGateResult => ({
    response: NextResponse.json({ error: message }, { status: 409 }),
    at: now.toISOString(),
    trusted: false,
  });

  if (session.portalType !== "direct_driver") {
    const time = acceptRecordedTime({ recordedAt: meta.recordedAt, serverNow: now, shift: null, notBefore });
    return { response: null, ...time };
  }

  try {
    if (meta.shiftClientId) {
      const { shift } = await loadGateRowsAt(admin, session, meta.shiftClientId);
      const time = acceptRecordedTime({ recordedAt: meta.recordedAt, serverNow: now, shift, notBefore });
      if (shift && time.trusted) {
        const periodAt = await loadPeriodAt(admin, session.tenantId, shift.id, time.at);
        const decision = jobGateDecisionAt({ portalType: session.portalType, shift, periodAt });
        return decision.ok ? { response: null, ...time } : refuse(decision.message);
      }
    }
  } catch (error) {
    console.error("[walkaround] queued job gate lookup failed", error);
    return {
      response: NextResponse.json({ error: GATE_UNAVAILABLE_MESSAGE }, { status: 503 }),
      at: now.toISOString(),
      trusted: false,
    };
  }

  const current = await jobGateResponse(admin, session);
  return { response: current, at: now.toISOString(), trusted: false };
}

type DefectRow = {
  id: string;
  client_id: string;
  label: string;
  final_severity: Severity;
  severity_source: SeveritySource;
  note: string | null;
  photo_paths: string[] | null;
  catalogue_item_id: string | null;
};

export async function defectViews(
  admin: SupabaseClient,
  checkId: string,
  catalogue: ReadonlyMap<string, CatalogueItem>,
  companyName: string | null,
): Promise<DriverDefectView[]> {
  const { data, error } = await admin
    .from("walkaround_defects")
    .select("id,client_id,label,final_severity,severity_source,note,photo_paths,catalogue_item_id")
    .eq("check_id", checkId)
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as DefectRow[];
  if (rows.length === 0) return [];

  const { data: objections, error: objectionError } = await admin
    .from("defect_objections")
    .select("defect_id,status,decision_note,raised_at")
    .in("defect_id", rows.map((r) => r.id))
    .order("raised_at", { ascending: false });
  if (objectionError) throw new Error(objectionError.message);

  return rows.map((r) => {
    const latest = (objections ?? []).find((o) => o.defect_id === r.id);
    return {
      clientId: String(r.client_id),
      label: r.label,
      finalSeverity: r.final_severity,
      severitySource: r.severity_source,
      reason: dangerReason({ finalSeverity: r.final_severity, severitySource: r.severity_source }, companyName),
      guidance: r.catalogue_item_id ? catalogue.get(r.catalogue_item_id)?.guidance ?? null : null,
      note: r.note,
      photoCount: r.photo_paths?.length ?? 0,
      objection: latest ? { status: latest.status as ObjectionStatus, decisionNote: latest.decision_note ?? null } : null,
    };
  });
}

export async function loadDriverShiftState(admin: SupabaseClient, session: DriverSession): Promise<DriverShiftState> {
  const operator = await loadOperatorProfile(admin, session.tenantId);
  const companyId = operator.companyId ?? session.tenantId;
  const today = operatorDayInTimeZone(new Date(), operator.timeZone);

  const [catalogueRows, vehicles, assignedId, open, settings] = await Promise.all([
    loadCatalogueRows(admin, companyId),
    loadTenantVehicles(admin, session.tenantId, operator.companyId),
    loadAssignedVehicleId(admin, session, today),
    loadOpenShift(admin, session),
    admin.from("walkaround_settings").select("on_call_phone").eq("company_id", companyId).maybeSingle(),
  ]);
  if (settings.error) throw new Error(settings.error.message);

  const catalogueMap = new Map(catalogueRows.map((i) => [i.id, i]));
  const registration = (id: string) => vehicles.find((v) => v.id === id)?.registration ?? "Vehicle";
  const assigned = assignedId ? vehicles.find((v) => v.id === assignedId) ?? null : null;

  // The most recent dangerous start/swap check today that is not followed by
  // a later passing check: the driver still needs to see why they were stopped.
  const { data: recent, error: recentError } = await admin
    .from("walkaround_checks")
    .select("id,client_id,vehicle_id,performed_at,result,phase")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .in("phase", ["start", "swap"])
    .order("performed_at", { ascending: false })
    .limit(1);
  if (recentError) throw new Error(recentError.message);
  const last = recent?.[0];
  const lastIsToday = last ? operatorDayInTimeZone(new Date(String(last.performed_at)), operator.timeZone) === today : false;

  let blockingCheck: DriverShiftState["blockingCheck"] = null;
  if (last && lastIsToday && last.result === "dangerous") {
    blockingCheck = {
      checkClientId: String(last.client_id),
      vehicleId: String(last.vehicle_id),
      registration: registration(String(last.vehicle_id)),
      performedAt: String(last.performed_at),
      defects: await defectViews(admin, String(last.id), catalogueMap, operator.companyName),
    };
  }

  return {
    today,
    timeZone: operator.timeZone,
    companyName: operator.companyName,
    onCallPhone: settings.data?.on_call_phone ? String(settings.data.on_call_phone) : null,
    assignedVehicle: assigned ? { id: assigned.id, registration: assigned.registration } : null,
    vehicles: vehicles.filter((v) => v.active || v.vor).map((v) => ({ id: v.id, registration: v.registration, vor: v.vor })),
    catalogue: activeCatalogue(catalogueRows, companyId),
    openShift: open.shift
      ? {
          id: open.shift.id,
          clientId: open.shift.clientId,
          startedAt: open.shift.startedAt,
          onBreak: open.breaks.some((b) => b.endedAt === null),
          breaks: open.breaks,
          currentVehicle: open.period && open.period.checkResult && open.period.checkResult !== "dangerous"
            ? { vehicleId: open.period.vehicleId, registration: registration(open.period.vehicleId), startOdometer: open.period.startOdometer, checkResult: open.period.checkResult }
            : null,
        }
      : null,
    blockingCheck,
    syncPending: false,
  };
}

/** Business refusals raised by the shifts_04 RPCs (and prodfix_30's licence gate): 409 with the database's sentence. */
export const KNOWN_RPC_REFUSALS: readonly string[] = [
  "SHF01", "SHF02", "SHF03", "SHF04", "SHF05", "SHF06", "SHF07", "WLK02", "WLK04", "LIC01", "LIC02",
];

/** Map an RPC error to an HTTP answer. Known business refusals are 409 with the database's sentence. */
export function rpcErrorResponse(error: { code?: string; message?: string } | null): NextResponse {
  const code = error?.code ?? "";
  if (KNOWN_RPC_REFUSALS.includes(code)) {
    return NextResponse.json({ error: error?.message ?? "Refused." }, { status: 409 });
  }
  console.error("[walkaround] rpc failed", code, error?.message);
  return NextResponse.json({ error: "Unable to save. Try again." }, { status: 500 });
}
