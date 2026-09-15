import { NextResponse } from "next/server";
import { isPodEvidencePathFor } from "../../../../lib/pod/evidencePath";
import { POD_DOCUMENT_MIME_TYPES, POD_PHOTO_MIME_TYPES } from "../../../../lib/pod/evidenceRules";
import { recordEvidenceRow, verifyUploadedEvidence } from "../../../../lib/pod/evidenceServer";
import {
  OfficeEvidenceError,
  isStopPodFinished,
  loadOfficeStop,
  officeEvidenceErrorResponse,
  requireOfficeCaller,
} from "../../../../lib/pod/officeEvidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Console evidence upload, step 2: the file is already in storage. Confirm it
  sits at a path this tenant, job and stop own (review POD-10), check its real
  size and leading bytes, then record the row. A failed insert removes the
  object with the service role (review POD-17).
*/
export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;

    try {
      body = await request.json();
    } catch {
      throw new OfficeEvidenceError(400, "Invalid request body.");
    }

    const evidenceType = body.evidenceType;

    if (evidenceType !== "photo" && evidenceType !== "document") {
      throw new OfficeEvidenceError(400, "Unknown evidence type.");
    }

    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    const allowed: readonly string[] = evidenceType === "photo" ? POD_PHOTO_MIME_TYPES : POD_DOCUMENT_MIME_TYPES;

    if (!allowed.includes(mimeType)) {
      throw new OfficeEvidenceError(415, "This file type is not allowed for POD evidence.");
    }

    const { admin, userId, tenantId } = await requireOfficeCaller(body.tenantId);
    const { job, stop } = await loadOfficeStop(admin, tenantId, body.jobId, body.stopId);

    if (job.status === "cancelled" || isStopPodFinished(stop.pod_status)) {
      throw new OfficeEvidenceError(409, "Evidence can no longer be added to this stop.");
    }

    const owner = { tenantId, jobId: job.id, stopId: stop.id };
    const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
    const folder = evidenceType === "photo" ? "photos" : "documents";

    if (!isPodEvidencePathFor(storagePath, owner) || storagePath.split("/")[3] !== folder) {
      throw new OfficeEvidenceError(400, "Invalid upload reference.");
    }

    const verified = await verifyUploadedEvidence(admin, storagePath, mimeType);

    if (!verified.ok) throw new OfficeEvidenceError(verified.status, verified.message);

    const evidence = await recordEvidenceRow(admin, {
      ...owner,
      evidenceType,
      storagePath,
      originalFilename: typeof body.originalFilename === "string" ? body.originalFilename : null,
      mimeType,
      size: verified.size,
      createdBy: userId,
    });

    return NextResponse.json({ ok: true, evidence }, { status: 201 });
  } catch (error) {
    const response = officeEvidenceErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
