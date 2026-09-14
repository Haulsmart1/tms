/*
  Planning save, as one atomic call with optimistic concurrency (review PLAN-8,
  PLAN-11).

  The old save sent one unconditional UPDATE per job. A failure part-way left a
  half-saved plan, a second planner's newer change was silently overwritten,
  and with "All tenants" active every job update landed before the save then
  failed on the missing tenant.

  Now the whole diff goes to public.save_planning_assignments
  (docs/sql/prodfix_70_planning_save.sql) in one transaction. Each row carries
  the vehicle, driver and route order this tab last saw for that job; the RPC
  refuses the entire save when any job no longer matches, so newer server data
  is never overwritten. No updated_at column is needed: the planning fields
  themselves are the version.
*/

import type { JobUpdate } from "./saveDiff";

export type PlanningSaveJobFacts = {
  id: string;
  tenant_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  route_order: number | null;
};

export type PlanningSaveRow = {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  route_order: number | null;
  expected_vehicle_id: string | null;
  expected_driver_id: string | null;
  expected_route_order: number | null;
};

export type PlanningSavePlan =
  | { ok: true; tenantId: string; rows: PlanningSaveRow[] }
  | { ok: false; reason: "no_tenant_selected" | "job_missing" | "job_other_tenant" };

export const PLANNING_SAVE_BLOCKED_MESSAGES = {
  no_tenant_selected:
    "Pick one tenant in the header to plan. With All tenants selected, Planning is read-only so lanes never mix tenants.",
  job_missing:
    "One or more jobs changed since the board loaded. Reload the board before saving.",
  job_other_tenant:
    "This plan includes a job from another tenant, so it was not saved. Reload the board.",
} as const;

export function buildPlanningSavePlan(
  updates: JobUpdate[],
  jobsById: Map<string, PlanningSaveJobFacts>,
  activeTenantId: string | null
): PlanningSavePlan {
  if (!activeTenantId) {
    return { ok: false, reason: "no_tenant_selected" };
  }

  const rows: PlanningSaveRow[] = [];

  for (const update of updates) {
    const job = jobsById.get(update.id);

    if (!job) {
      return { ok: false, reason: "job_missing" };
    }

    if (job.tenant_id !== activeTenantId) {
      return { ok: false, reason: "job_other_tenant" };
    }

    rows.push({
      id: update.id,
      vehicle_id: update.vehicle_id,
      driver_id: update.driver_id,
      route_order: update.route_order,
      expected_vehicle_id: job.vehicle_id,
      expected_driver_id: job.driver_id,
      expected_route_order: job.route_order,
    });
  }

  return { ok: true, tenantId: activeTenantId, rows };
}

export type PlanningSaveErrorKind = "conflict" | "rpc_missing" | "failed";

const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

export function classifyPlanningSaveError(error: {
  code?: string | null;
  message?: string | null;
}): PlanningSaveErrorKind {
  if (error.code && MISSING_FUNCTION_CODES.has(error.code)) {
    return "rpc_missing";
  }

  if ((error.message ?? "").startsWith("PLANNING_CONFLICT")) {
    return "conflict";
  }

  return "failed";
}

export const PLANNING_SAVE_ERROR_MESSAGES: Record<PlanningSaveErrorKind, string> = {
  conflict:
    "Someone else saved changes to these jobs after this board loaded. Nothing was saved. Reload the board to see the latest plan, then make your change again.",
  rpc_missing:
    "Saving is unavailable until the planning save update (docs/sql/prodfix_70_planning_save.sql) is installed. Nothing was saved; your changes are kept in this browser.",
  failed: "The plan could not be saved. Nothing was saved; your changes are kept in this browser.",
};
