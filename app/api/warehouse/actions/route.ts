import { NextResponse } from "next/server";
import { requireOfficeCaller, OfficeEvidenceError } from "../../../../lib/pod/officeEvidence";
import { parseWarehouseInput } from "../../../../lib/warehouse/input";
import { authorizeVehicleTenant } from "../../../../lib/auth/serverTenantAccess";
import { warehouseDatabaseError, warehouseErrorResponse } from "../../../../lib/warehouse/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let body;
    try { body = await request.json(); }
    catch { throw new OfficeEvidenceError(400, "Invalid warehouse request."); }
    const { admin, tenantId, userId } = await requireOfficeCaller(body?.tenantId);
    let input;
    try { input = parseWarehouseInput(body); }
    catch (error) { throw new OfficeEvidenceError(400, (error as Error).message); }
    if (input.action === "move" && input.vehicleId) {
      const vehicle = await admin.from("vehicles").select("tenant_id").eq("id", input.vehicleId).maybeSingle();
      if (vehicle.error) warehouseDatabaseError(vehicle.error);
      if (!vehicle.data) throw new OfficeEvidenceError(404, "Vehicle not found.");
      if (vehicle.data.tenant_id !== tenantId) await authorizeVehicleTenant(admin, userId, vehicle.data.tenant_id);
    }
    const { data, error } = await admin.rpc("warehouse_apply_operation", {
      p_tenant: tenantId, p_actor: userId, p_request: input.requestId, p_action: input.action,
      p_jobs: input.jobIds, p_vehicle: input.vehicleId, p_driver: input.driverId,
      p_plan: input.planId, p_date: input.planningDate, p_note: input.note,
    });
    if (error) warehouseDatabaseError(error);
    return NextResponse.json({ ok: true, result: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return warehouseErrorResponse(error); }
}
