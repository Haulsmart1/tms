import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiDbError } from "../../../../../../lib/api/server";
import { isUuid } from "../../../../../../lib/auth/serverTenantAccess";
import { parseEmployeeInput } from "../../../../../../lib/subcontractors/payload";
import {
  readJsonBody,
  requireSubcontractorInTenant,
  requireSubcontractorWriter,
  subcontractorApiError,
} from "../../../../../../lib/subcontractors/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Finding M-4: update one employee. Office staff only (drivers refused). The row
  must belong to this subcontractor and the authorized tenant; neither
  tenant_id nor subcontractor_id can be changed.
*/
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; employeeId: string }> }
) {
  try {
    const { id, employeeId } = await context.params;
    const { admin, tenantId } = await requireSubcontractorWriter(request, "access");
    await requireSubcontractorInTenant(admin, id, tenantId);

    if (!isUuid(employeeId)) {
      throw new ApiError(404, "Employee not found.");
    }

    const parsed = parseEmployeeInput(await readJsonBody(request), "update");

    if (!parsed.ok) {
      throw new ApiError(400, parsed.message);
    }

    const { data, error } = await admin
      .from("subcontractor_employees")
      .update({ ...parsed.value, updated_at: new Date().toISOString() })
      .eq("id", employeeId)
      .eq("subcontractor_id", id)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw apiDbError(error, "Unable to save the employee.");
    }

    if (!data) {
      throw new ApiError(404, "Employee not found.");
    }

    return NextResponse.json({ id: data.id });
  } catch (error) {
    return subcontractorApiError(error, "Subcontractor employee update");
  }
}
