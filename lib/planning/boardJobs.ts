import type { SupabaseClient } from "@supabase/supabase-js";

const JOB_SELECT = `
  id, tenant_id, reference, status, scheduled_date, planning_date,
  collection_eta, delivery_eta, acceptance_note, accepted_at, accepted_by,
  vehicle_id, driver_id, subcontractor_id, route_order,
  journey_scope, origin_country_code, destination_country_code,
  compliance_regime_override, compliance_override_reason,
  customers ( name ),
  job_stops (id, stop_order, type, address_line, city, postcode, lat, lng, booked_from, booked_to),
  job_items (id, sku, description, quantity, serial_numbers, external_reference, notes)
`;

/** Saved snapshots reference jobs by id, not by their current planning date.
 * Read those jobs within the selected tenant before staging the saved lanes.
 * Opening a snapshot never publishes or reassigns any job. */
export async function loadPlanningBoardJobs(
  client: SupabaseClient,
  input: { tenantIds: string[]; planningDate: string; savedJobIds: string[] },
) {
  if (input.tenantIds.length === 0) return { data: [], error: null };
  const query = () => client.from("jobs").select(JOB_SELECT).in("tenant_id", input.tenantIds);
  const day = await query()
    .or(`planning_date.eq.${input.planningDate},and(planning_date.is.null,scheduled_date.eq.${input.planningDate})`)
    .order("created_at", { ascending: true });
  if (day.error) return day;
  const rows = new Map((day.data ?? []).map((row) => [String(row.id), row]));
  const missing = [...new Set(input.savedJobIds)].filter((id) => !rows.has(id));
  // Bound the URL size even for a large saved plan. The query builder escapes
  // the ids; no snapshot content is interpolated into a raw filter string.
  for (let start = 0; start < missing.length; start += 100) {
    const result = await query().in("id", missing.slice(start, start + 100));
    if (result.error) return result;
    for (const row of result.data ?? []) rows.set(String(row.id), row);
  }
  return { data: [...rows.values()], error: null };
}

/** A date change renders before its asynchronous board load completes.
 * Staging against that previous render can discard the snapshot's jobs. */
export function savedPlanBoardReady(input: {
  loading: boolean;
  loadedScope: string | null;
  requestedScope: string;
  tenantId: string | null;
  planningDate: string;
  savedPlan: { tenantId: string; planningDate: string } | null;
}): boolean {
  return !input.loading && input.loadedScope === input.requestedScope &&
    input.savedPlan !== null && input.savedPlan.tenantId === input.tenantId &&
    input.savedPlan.planningDate === input.planningDate;
}
