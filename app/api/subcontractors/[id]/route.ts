import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiDbError } from "../../../../lib/api/server";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { parseSubcontractorInput } from "../../../../lib/subcontractors/payload";
import {
  readJsonBody,
  requireSubcontractorWriter,
  subcontractorApiError,
} from "../../../../lib/subcontractors/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Finding M-4: update one subcontractor. Admin only, scoped to the authorized
  tenant, allowlisted columns only. tenant_id is never changed.
*/
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { admin, tenantId } = await requireSubcontractorWriter(request, "manage");

    if (!isUuid(id)) {
      throw new ApiError(404, "Subcontractor not found.");
    }

    const parsed = parseSubcontractorInput(await readJsonBody(request), "update");

    if (!parsed.ok) {
      throw new ApiError(400, parsed.message);
    }

    const { data, error } = await admin
      .from("subcontractors")
      .update({ ...parsed.value, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw apiDbError(error, "Unable to save the subcontractor.");
    }

    if (!data) {
      throw new ApiError(404, "Subcontractor not found.");
    }

    return NextResponse.json({ id: data.id });
  } catch (error) {
    return subcontractorApiError(error, "Subcontractor update");
  }
}
