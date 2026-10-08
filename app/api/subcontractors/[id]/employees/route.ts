import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiDbError } from "../../../../../lib/api/server";
import { parseEmployeeInput } from "../../../../../lib/subcontractors/payload";
import {
  readJsonBody,
  requireSubcontractorInTenant,
  requireSubcontractorWriter,
  subcontractorApiError,
} from "../../../../../lib/subcontractors/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Finding M-4: add an employee to a subcontractor. Office staff only (drivers
  refused). The subcontractor must belong to the authorized tenant;
  tenant_id and subcontractor_id are set here, never read from the body.
*/
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { admin, tenantId } = await requireSubcontractorWriter(request, "access");
    await requireSubcontractorInTenant(admin, id, tenantId);

    const parsed = parseEmployeeInput(await readJsonBody(request), "create");

    if (!parsed.ok) {
      throw new ApiError(400, parsed.message);
    }

    const { data, error } = await admin
      .from("subcontractor_employees")
      .insert({ ...parsed.value, tenant_id: tenantId, subcontractor_id: id })
      .select("id")
      .single();

    if (error) {
      throw apiDbError(error, "Unable to save the employee.");
    }

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (error) {
    return subcontractorApiError(error, "Subcontractor employee create");
  }
}
