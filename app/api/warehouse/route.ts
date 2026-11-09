import { NextResponse } from "next/server";
import { requireOfficeCaller, OfficeEvidenceError } from "../../../lib/pod/officeEvidence";
import { parseWarehouseSearch } from "../../../lib/warehouse/input";
import { warehouseDatabaseError, warehouseErrorResponse } from "../../../lib/warehouse/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const { admin, tenantId, authorized } = await requireOfficeCaller(params.get("tenantId"));
    let input;
    try { input = parseWarehouseSearch(params); }
    catch (error) { throw new OfficeEvidenceError(400, (error as Error).message); }
    const vehicleScopes = [tenantId];
    if (authorized.tier !== "staff" && authorized.tenant.companyId) vehicleScopes.push(authorized.tenant.companyId);
    const [jobs, vehicles, drivers, plans, recent] = await Promise.all([
      admin.rpc("warehouse_search_jobs", { p_tenant: tenantId, p_query: input.query, p_exact: input.exact, p_filter: input.filter, p_page: input.page }),
      admin.from("vehicles").select("id,registration").in("tenant_id", vehicleScopes).order("registration"),
      admin.from("drivers").select("id,name").eq("tenant_id", tenantId).order("name"),
      admin.from("planning_saved_plans").select("id,name,planning_date").eq("tenant_id", tenantId).order("updated_at", { ascending: false }),
      admin.from("warehouse_operations").select("request_id,action,created_at,result,note").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(12),
    ]);
    for (const result of [jobs, vehicles, drivers, plans, recent]) if (result.error) warehouseDatabaseError(result.error);
    return NextResponse.json({ ...jobs.data, options: { vehicles: vehicles.data, drivers: drivers.data, plans: plans.data }, recent: recent.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return warehouseErrorResponse(error); }
}
