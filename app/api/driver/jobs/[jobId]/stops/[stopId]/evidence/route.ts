import { NextResponse } from "next/server";
import { isUuid } from "../../../../../../../../lib/auth/serverTenantAccess";
import { loadDriverJobStop } from "../../../../../../../../lib/driver/jobAccess";
import { driverErrorResponse, requireDriverSession } from "../../../../../../../../lib/driver/server";
import { isWorkableJobStatus, jobNotWorkableMessage } from "../../../../../../../../lib/jobs/jobStatus";
import { isPodEvidencePathFor } from "../../../../../../../../lib/pod/evidencePath";
import { POD_PHOTO_MIME_TYPES } from "../../../../../../../../lib/pod/evidenceRules";
import { recordEvidenceRow, verifyUploadedEvidence } from "../../../../../../../../lib/pod/evidenceServer";
import { createAdminClient } from "../../../../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string; stopId: string }> };

/*
  Step 2 of a driver POD photo upload (review POD-2): the photo is already in
  storage via the signed upload URL. Re-authorize, confirm the object sits at
  a path this driver's job and stop own, check its real size and leading bytes,
  then record the pod_evidence row. The request body is a few bytes of JSON.
*/
export async function POST(request: Request, context: RouteContext) {
  try {
    const { jobId, stopId } = await context.params;

    if (!isUuid(jobId) || !isUuid(stopId)) {
      return NextResponse.json({ error: "Job stop not found." }, { status: 404 });
    }

    let body: { storagePath?: unknown; originalFilename?: unknown; mimeType?: unknown };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";

    if (!(POD_PHOTO_MIME_TYPES as readonly string[]).includes(mimeType)) {
      return NextResponse.json({ error: "Use a JPEG, PNG, WebP or HEIC photo." }, { status: 415 });
    }

    const session = await requireDriverSession({ jobId });
    const admin = createAdminClient();
    const loaded = await loadDriverJobStop(admin, session, jobId, stopId);

    if (!loaded || loaded.stop.type !== "delivery") {
      return NextResponse.json({ error: "Delivery stop not found." }, { status: 404 });
    }

    if (!isWorkableJobStatus(loaded.job.status)) {
      return NextResponse.json({ error: jobNotWorkableMessage(loaded.job.status) }, { status: 409 });
    }

    if (loaded.stop.pod_status === "delivered") {
      return NextResponse.json(
        { error: "This delivery is already complete, so no more photos can be added." },
        { status: 409 },
      );
    }

    const owner = { tenantId: session.tenantId, jobId, stopId };
    const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";

    if (!isPodEvidencePathFor(storagePath, owner) || storagePath.split("/")[3] !== "photos") {
      return NextResponse.json({ error: "Invalid upload reference." }, { status: 400 });
    }

    const verified = await verifyUploadedEvidence(admin, storagePath, mimeType);

    if (!verified.ok) {
      return NextResponse.json({ error: verified.message }, { status: verified.status });
    }

    const evidence = await recordEvidenceRow(admin, {
      ...owner,
      evidenceType: "photo",
      storagePath,
      originalFilename: typeof body.originalFilename === "string" ? body.originalFilename : null,
      mimeType,
      size: verified.size,
      createdBy: session.userId,
    });

    return NextResponse.json({ ok: true, evidence }, { status: 201 });
  } catch (error) {
    const response = driverErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
