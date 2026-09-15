import { NextResponse } from "next/server";
import { validateEvidenceMetadata } from "../../../../../lib/pod/evidenceRules";
import { createEvidenceUploadUrl } from "../../../../../lib/pod/evidenceServer";
import {
  OfficeEvidenceError,
  isStopPodFinished,
  loadOfficeStop,
  officeEvidenceErrorResponse,
  requireOfficeCaller,
} from "../../../../../lib/pod/officeEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Console evidence upload, step 1: authorize and issue a signed upload URL for a server-chosen path. */
export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;

    try {
      body = await request.json();
    } catch {
      throw new OfficeEvidenceError(400, "Invalid request body.");
    }

    const validation = validateEvidenceMetadata({
      evidenceType: body.evidenceType,
      mimeType: body.mimeType,
      size: body.size,
    });

    if (!validation.ok) throw new OfficeEvidenceError(validation.status, validation.message);

    const { admin, tenantId } = await requireOfficeCaller(body.tenantId);
    const { job, stop } = await loadOfficeStop(admin, tenantId, body.jobId, body.stopId);

    if (job.status === "cancelled") {
      throw new OfficeEvidenceError(409, "This job has been cancelled, so evidence can no longer be added.");
    }

    if (isStopPodFinished(stop.pod_status)) {
      throw new OfficeEvidenceError(409, "This stop's POD is complete, so evidence can no longer be added.");
    }

    const upload = await createEvidenceUploadUrl(
      admin,
      { tenantId, jobId: job.id, stopId: stop.id },
      body.evidenceType === "photo" ? "photos" : "documents",
      typeof body.filename === "string" ? body.filename : null,
    );

    return NextResponse.json({ ok: true, path: upload.path, token: upload.token });
  } catch (error) {
    const response = officeEvidenceErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
