import { NextResponse } from "next/server";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { isCollectionFailureReason } from "../../../../lib/planning/collectionFailure";
import { OfficeEvidenceError, requireOfficeCaller } from "../../../../lib/pod/officeEvidence";
import { warehouseDatabaseError, warehouseErrorResponse } from "../../../../lib/warehouse/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) {
      throw new OfficeEvidenceError(403, "Invalid request origin.");
    }
    const body = await request.json().catch(() => null);
    if (body?.action === "undo-collection") {
      if (!isUuid(body.jobId) || !isUuid(body.requestId)) {
        throw new OfficeEvidenceError(400, "Choose a collected job to undo.");
      }
      const { admin, tenantId, userId } = await requireOfficeCaller(body.tenantId);
      const { data, error } = await admin.rpc("undo_planning_collection", {
        p_tenant: tenantId, p_job: body.jobId, p_actor: userId, p_request: body.requestId,
      });
      if (error) warehouseDatabaseError(error);
      return NextResponse.json({ ok: true, result: data }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!isUuid(body?.jobId) || !isUuid(body?.stopId) || !isUuid(body?.requestId)
      || !isCollectionFailureReason(body?.reason)) {
      throw new OfficeEvidenceError(400, "Choose a collection stop and reason.");
    }
    const { admin, tenantId, userId } = await requireOfficeCaller(body.tenantId);
    const { error } = await admin.rpc("office_collection_failure", {
      p_tenant: tenantId, p_job: body.jobId, p_stop: body.stopId,
      p_actor: userId, p_request: body.requestId, p_reason: body.reason,
    });
    if (error) warehouseDatabaseError(error);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}
