/*
  Browser loaders for the Walkaround checks tab on /maintenance. Reads only:
  RLS is the boundary, applyTenantFilter scopes to the selected tenant. Each
  loader throws on a query error so the tab shows an error state (the tables
  may not exist yet where shifts_01 is unapplied).
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { one } from "../shifts/fleetQuery";
import { applyTenantFilter } from "../tenant/filter";
import { asPhase, asResult, parseSnapshot } from "./checkView";
import type { SnapshotItem } from "./catalogue";
import type { CheckPhase, CheckResult, ObjectionStatus, Severity, SeveritySource } from "./types";

type Rel<T> = T | T[] | null;

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export type CheckSummary = {
  id: string;
  vehicleId: string;
  registration: string;
  driverId: string;
  driverName: string;
  phase: CheckPhase;
  performedAt: string;
  receivedAt: string;
  odometer: number | null;
  result: CheckResult;
  flags: string[];
  mismatchReason: string | null;
};

const CHECK_SELECT =
  "id, vehicle_id, driver_id, phase, performed_at, received_at, odometer, result, flags, vehicle_mismatch_reason, drivers(name), vehicles(registration)";

type CheckRow = {
  id: string;
  vehicle_id: string;
  driver_id: string;
  phase: unknown;
  performed_at: string;
  received_at: string;
  odometer: number | null;
  result: unknown;
  flags: unknown;
  vehicle_mismatch_reason: string | null;
  checklist_snapshot?: unknown;
  drivers: Rel<{ name?: unknown }>;
  vehicles: Rel<{ registration?: unknown }>;
};

export function toCheckSummary(r: CheckRow): CheckSummary {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    registration: text(one(r.vehicles)?.registration, "Unknown vehicle"),
    driverId: r.driver_id,
    driverName: text(one(r.drivers)?.name, "Unknown driver"),
    phase: asPhase(r.phase),
    performedAt: r.performed_at,
    receivedAt: r.received_at,
    odometer: typeof r.odometer === "number" ? r.odometer : null,
    result: asResult(r.result),
    flags: list(r.flags),
    mismatchReason: r.vehicle_mismatch_reason,
  };
}

export async function loadChecksInRange(
  supabase: SupabaseClient,
  activeTenantId: string | null,
  range: { startIso: string; endIso: string },
): Promise<CheckSummary[]> {
  const { data, error } = await applyTenantFilter(supabase.from("walkaround_checks").select(CHECK_SELECT), activeTenantId)
    .gte("performed_at", range.startIso)
    .lt("performed_at", range.endIso)
    .order("performed_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`Could not load walkaround checks: ${error.message}`);
  return ((data ?? []) as unknown as CheckRow[]).map(toCheckSummary);
}

export type PendingObjection = {
  id: string;
  checkId: string;
  defectLabel: string;
  registration: string;
  driverName: string;
  raisedAt: string;
};

export async function loadPendingObjections(supabase: SupabaseClient, activeTenantId: string | null): Promise<PendingObjection[]> {
  const { data, error } = await applyTenantFilter(
    supabase
      .from("defect_objections")
      .select("id, raised_at, drivers(name), walkaround_defects(check_id, label, vehicles(registration))"),
    activeTenantId,
  )
    .eq("status", "pending")
    .order("raised_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`Could not load objections: ${error.message}`);
  type Row = {
    id: string;
    raised_at: string;
    drivers: Rel<{ name?: unknown }>;
    walkaround_defects: Rel<{ check_id?: unknown; label?: unknown; vehicles?: Rel<{ registration?: unknown }> }>;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const defect = one(r.walkaround_defects);
    return {
      id: r.id,
      checkId: typeof defect?.check_id === "string" ? defect.check_id : "",
      defectLabel: text(defect?.label, "a defect"),
      registration: text(one(defect?.vehicles ?? null)?.registration, "a vehicle"),
      driverName: text(one(r.drivers)?.name, "A driver"),
      raisedAt: r.raised_at,
    };
  });
}

export type DefectObjection = {
  id: string;
  status: ObjectionStatus;
  reason: string;
  raisedAt: string;
  driverName: string;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type DefectDetail = {
  id: string;
  clientId: string;
  catalogueItemId: string | null;
  label: string;
  finalSeverity: Severity;
  escalatedByDriver: boolean;
  severitySource: SeveritySource;
  note: string | null;
  photoCount: number;
  maintenanceStatus: string | null;
  rectifiedAt: string | null;
  objections: DefectObjection[];
};

export type CheckDetail = { check: CheckSummary; snapshot: SnapshotItem[]; defects: DefectDetail[] };

function objectionStatus(value: unknown): ObjectionStatus {
  return value === "approved" || value === "rejected" ? value : "pending";
}

export async function loadCheckDetail(supabase: SupabaseClient, checkId: string): Promise<CheckDetail | null> {
  const { data: check, error: checkError } = await supabase
    .from("walkaround_checks")
    .select(`${CHECK_SELECT}, checklist_snapshot`)
    .eq("id", checkId)
    .maybeSingle();
  if (checkError) throw new Error(`Could not load the check: ${checkError.message}`);
  if (!check) return null;

  const { data: defects, error: defectError } = await supabase
    .from("walkaround_defects")
    .select(
      "id, client_id, catalogue_item_id, label, final_severity, escalated_by_driver, severity_source, note, photo_paths, maintenance_record_id, rectified_at, created_at, maintenance_records(status)",
    )
    .eq("check_id", checkId)
    .order("created_at", { ascending: true });
  if (defectError) throw new Error(`Could not load the defects: ${defectError.message}`);

  type DefectRow = {
    id: string;
    client_id: string;
    catalogue_item_id: string | null;
    label: string;
    final_severity: unknown;
    escalated_by_driver: boolean | null;
    severity_source: unknown;
    note: string | null;
    photo_paths: unknown;
    rectified_at: string | null;
    maintenance_records: Rel<{ status?: unknown }>;
  };
  const defectRows = (defects ?? []) as unknown as DefectRow[];

  type ObjectionRow = {
    id: string;
    defect_id: string;
    status: unknown;
    reason: string;
    raised_at: string;
    decided_at: string | null;
    decision_note: string | null;
    drivers: Rel<{ name?: unknown }>;
  };
  let objectionRows: ObjectionRow[] = [];
  if (defectRows.length > 0) {
    const { data, error } = await supabase
      .from("defect_objections")
      .select("id, defect_id, status, reason, raised_at, decided_at, decision_note, drivers(name)")
      .in(
        "defect_id",
        defectRows.map((d) => d.id),
      )
      .order("raised_at", { ascending: true });
    if (error) throw new Error(`Could not load objections: ${error.message}`);
    objectionRows = (data ?? []) as unknown as ObjectionRow[];
  }

  const row = check as unknown as CheckRow;
  return {
    check: toCheckSummary(row),
    snapshot: parseSnapshot(row.checklist_snapshot),
    defects: defectRows.map((d) => ({
      id: d.id,
      clientId: String(d.client_id),
      catalogueItemId: d.catalogue_item_id,
      label: d.label,
      finalSeverity: d.final_severity === "dangerous" ? "dangerous" : "minor",
      escalatedByDriver: d.escalated_by_driver === true,
      severitySource: d.severity_source === "company" || d.severity_source === "driver" ? d.severity_source : "baseline",
      note: d.note,
      photoCount: list(d.photo_paths).length,
      maintenanceStatus: typeof one(d.maintenance_records)?.status === "string" ? String(one(d.maintenance_records)?.status) : null,
      rectifiedAt: d.rectified_at,
      objections: objectionRows
        .filter((o) => o.defect_id === d.id)
        .map((o) => ({
          id: o.id,
          status: objectionStatus(o.status),
          reason: o.reason,
          raisedAt: o.raised_at,
          driverName: text(one(o.drivers)?.name, "The driver"),
          decidedAt: o.decided_at,
          decisionNote: o.decision_note,
        })),
    })),
  };
}
