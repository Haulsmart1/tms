import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanningReturnContext = {
  tenantId: string;
  date: string;
  planId: string | null;
  vehicleId: string | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validPlanningDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Parse only known planning fields, never an arbitrary return URL. */
export function readPlanningReturnContext(search: string, fromJobs = false): PlanningReturnContext | null {
  const params = new URLSearchParams(search);
  const tenantId = params.get(fromJobs ? "planTenant" : "tenant");
  const date = params.get(fromJobs ? "planDate" : "date");
  const planId = params.get("plan");
  const vehicleId = params.get(fromJobs ? "planVehicle" : "vehicle");
  if (!tenantId || !uuid.test(tenantId) || !validPlanningDate(date) || (planId && !uuid.test(planId))) return null;
  return { tenantId, date, planId, vehicleId: vehicleId && uuid.test(vehicleId) ? vehicleId : null };
}

export function planningReturnHref(context: PlanningReturnContext): string {
  const params = new URLSearchParams({ date: context.date, tenant: context.tenantId });
  if (context.planId) params.set("plan", context.planId);
  if (context.vehicleId) params.set("vehicle", context.vehicleId);
  return `/planning?${params}`;
}

export function planningJobHref(jobId: string, context?: PlanningReturnContext): string {
  const params = new URLSearchParams({ job: jobId });
  if (context) {
    params.set("planDate", context.date);
    params.set("planTenant", context.tenantId);
    if (context.planId) params.set("plan", context.planId);
    if (context.vehicleId) params.set("planVehicle", context.vehicleId);
  }
  return `/jobs?${params}`;
}

/** Legacy/direct job links have no origin context. Return to a saved plan only
 * when exactly one tenant-scoped snapshot contains this job. */
export async function findSavedPlanForJob(client: SupabaseClient, tenantId: string, jobId: string, date?: string) {
  let query = client.from("planning_saved_plans").select("id,name,planning_date")
    .eq("tenant_id", tenantId).contains("snapshot", { lanes: [{ jobIds: [jobId] }] });
  if (date && validPlanningDate(date)) query = query.eq("planning_date", date);
  const { data, error } = await query.limit(2);
  if (error || data?.length !== 1) return null;
  return data[0] as { id: string; name: string; planning_date: string };
}

/** Open the existing office-authorized warehouse scanner with a safe plan return. */
export function warehousePlanningHref(context: PlanningReturnContext): string {
  return planningReturnHref(context).replace("/planning?", "/warehouse?") + "#warehouse-scanner";
}
