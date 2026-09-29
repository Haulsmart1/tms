/*
  Server-only loaders for driver shifts and walkaround checks. Every function
  takes the service-role client, so every query is filtered by the tenant and
  driver the caller was already authorized for. Never import from client code.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { DriverAccessError, requireDriverSession, type DriverSession } from "../driver/server";
import { loadOperatorProfile } from "../driver/operatorTimeZone";
import { operatorDayInTimeZone } from "../time";
import { activeCatalogue } from "./catalogue";
import type { DriverDefectView, DriverShiftState } from "./driverState";
import { jobGateDecision, type JobGateInput } from "./jobGate";
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
  shift: { id: string; startedAt: string; flags: string[] } | null;
  breaks: { startedAt: string; endedAt: string | null }[];
  period: { id: string; vehicleId: string; startOdometer: number; checkResult: CheckResult | null; vehicleVor: boolean } | null;
};

export async function loadOpenShift(admin: SupabaseClient, session: DriverSession): Promise<OpenShiftRows> {
  const { data: shift, error } = await admin
    .from("driver_shifts")
    .select("id,started_at,flags")
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!shift) return { shift: null, breaks: [], period: null };

  const [breaksResult, periodResult] = await Promise.all([
    admin.from("shift_breaks").select("started_at,ended_at").eq("shift_id", shift.id).order("started_at"),
    admin
      .from("shift_vehicle_periods")
      .select("id,vehicle_id,start_odometer,walkaround_check_id")
      .eq("shift_id", shift.id)
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
    shift: { id: String(shift.id), startedAt: String(shift.started_at), flags: (shift.flags as string[]) ?? [] },
    breaks: (breaksResult.data ?? []).map((b) => ({ startedAt: String(b.started_at), endedAt: b.ended_at ? String(b.ended_at) : null })),
    period,
  };
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

/**
  The job gate for stop completion and POD routes. Returns a 409 response when
  the driver may not work, or null. FAILS CLOSED: if the shift tables are
  missing (SQL not applied yet) or a lookup fails, the driver is refused.
*/
export async function jobGateResponse(admin: SupabaseClient, session: DriverSession): Promise<NextResponse | null> {
  if (session.portalType !== "direct_driver") return null;
  let input: JobGateInput;
  try {
    input = await loadJobGateInput(admin, session);
  } catch (error) {
    console.error("[walkaround] job gate lookup failed", error);
    return NextResponse.json({ error: "Walkaround checks are not available right now, so jobs cannot be completed. Ask the office." }, { status: 409 });
  }
  const decision = jobGateDecision(input);
  return decision.ok ? null : NextResponse.json({ error: decision.message }, { status: 409 });
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
    companyName: operator.companyName,
    onCallPhone: settings.data?.on_call_phone ? String(settings.data.on_call_phone) : null,
    assignedVehicle: assigned ? { id: assigned.id, registration: assigned.registration } : null,
    vehicles: vehicles.filter((v) => v.active || v.vor).map((v) => ({ id: v.id, registration: v.registration, vor: v.vor })),
    catalogue: activeCatalogue(catalogueRows, companyId),
    openShift: open.shift
      ? {
          id: open.shift.id,
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

/** Map an RPC error to an HTTP answer. Known business refusals are 409 with the database's sentence. */
export function rpcErrorResponse(error: { code?: string; message?: string } | null): NextResponse {
  const code = error?.code ?? "";
  if (["SHF01", "SHF02", "SHF03", "SHF04", "SHF05", "WLK02", "LIC01", "LIC02"].includes(code)) {
    return NextResponse.json({ error: error?.message ?? "Refused." }, { status: 409 });
  }
  console.error("[walkaround] rpc failed", code, error?.message);
  return NextResponse.json({ error: "Unable to save. Try again." }, { status: 500 });
}
