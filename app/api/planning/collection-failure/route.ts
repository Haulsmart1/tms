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
    const undo = body?.action === "undo-failure";
    if (!isUuid(body?.jobId) || !isUuid(body?.stopId) || !isUuid(body?.requestId)
      || !(undo ? isUuid(body?.attemptId) : isCollectionFailureReason(body?.reason))) {
      throw new OfficeEvidenceError(400, undo ? "Choose a failed collection to undo." : "Choose a collection stop and reason.");
    }
    const { admin, tenantId, userId } = await requireOfficeCaller(body.tenantId);
    const args = {
      p_tenant: tenantId, p_job: body.jobId, p_stop: body.stopId,
      p_actor: userId, p_request: body.requestId,
    };
    if (undo) {
      const { error } = await admin.rpc("undo_office_collection_failure", { ...args, p_attempt: body.attemptId });
      if (error) warehouseDatabaseError(error);
    } else {
      const { error } = await admin.rpc("office_collection_failure", { ...args, p_reason: body.reason });
      if (error) warehouseDatabaseError(error);
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return warehouseErrorResponse(error);
  }
}
