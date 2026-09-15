import { NextResponse } from "next/server";
import { isUuid } from "../../../../../lib/auth/serverTenantAccess";
import { isPodEvidencePathFor } from "../../../../../lib/pod/evidencePath";
import { removeEvidenceObject } from "../../../../../lib/pod/evidenceServer";
import {
  OfficeEvidenceError,
  isStopPodFinished,
  officeEvidenceErrorResponse,
  requireOfficeCaller,
} from "../../../../../lib/pod/officeEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ evidenceId: string }> };

/*
  Delete one piece of POD evidence and its storage object (review POD-17).

  The bucket denies deletes from signed-in clients, so the browser-side remove
  used to "succeed" while the file stayed. The row goes first, then the object
  is removed with the service role (best effort, logged). Only objects inside
  the row's own tenant path are ever removed.

  Evidence on a stop whose POD is complete can only be removed by an admin, for
  example a photo uploaded by mistake that shows personal data.
*/
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { evidenceId } = await context.params;
    const tenantId = new URL(request.url).searchParams.get("tenantId");

    if (!isUuid(evidenceId)) throw new OfficeEvidenceError(404, "POD evidence not found.");

    const { admin, authorized } = await requireOfficeCaller(tenantId);

    const { data: evidence, error: evidenceError } = await admin
      .from("pod_evidence")
      .select("id,tenant_id,job_id,stop_id,storage_path")
      .eq("id", evidenceId)
      .eq("tenant_id", authorized.tenant.id)
      .maybeSingle();

    if (evidenceError) throw new Error(evidenceError.message);
    if (!evidence) throw new OfficeEvidenceError(404, "POD evidence not found.");

    const { data: stop, error: stopError } = await admin
      .from("job_stops")
      .select("id,pod_status")
      .eq("id", evidence.stop_id)
      .eq("tenant_id", authorized.tenant.id)
      .maybeSingle();

    if (stopError) throw new Error(stopError.message);

    if (stop && isStopPodFinished(stop.pod_status) && authorized.tier === "staff") {
      throw new OfficeEvidenceError(
        403,
        "This stop's POD is complete. Ask an administrator to remove evidence from it.",
      );
    }

    const { data: deleted, error: deleteError } = await admin
      .from("pod_evidence")
      .delete()
      .eq("id", evidence.id)
      .eq("tenant_id", authorized.tenant.id)
      .select("id");

    if (deleteError) throw new Error(deleteError.message);
    if (!deleted || deleted.length === 0) throw new OfficeEvidenceError(404, "POD evidence not found.");

    const owned = isPodEvidencePathFor(evidence.storage_path, {
      tenantId: String(evidence.tenant_id),
      jobId: String(evidence.job_id ?? ""),
      stopId: String(evidence.stop_id ?? ""),
    });

    let fileRemoved = false;

    if (owned) {
      fileRemoved = await removeEvidenceObject(admin, String(evidence.storage_path));
    } else {
      console.error("[pod-evidence] not removing object outside the row's tenant path", evidence.id);
    }

    return NextResponse.json({ ok: true, fileRemoved });
  } catch (error) {
    const response = officeEvidenceErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
