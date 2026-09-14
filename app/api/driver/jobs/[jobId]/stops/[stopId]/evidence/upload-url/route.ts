import { NextResponse } from "next/server";
import { isUuid } from "../../../../../../../../../lib/auth/serverTenantAccess";
import { loadDriverJobStop } from "../../../../../../../../../lib/driver/jobAccess";
import { driverErrorResponse, requireDriverSession } from "../../../../../../../../../lib/driver/server";
import { isWorkableJobStatus, jobNotWorkableMessage } from "../../../../../../../../../lib/jobs/jobStatus";
import { validateEvidenceMetadata } from "../../../../../../../../../lib/pod/evidenceRules";
import { createEvidenceUploadUrl } from "../../../../../../../../../lib/pod/evidenceServer";
import { createAdminClient } from "../../../../../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string; stopId: string }> };

/*
  Step 1 of a driver POD photo upload (review POD-2): authorize the driver for
  this job and stop, check the declared type and size, and hand back a signed
  upload token for a path the server chose.
*/
export async function POST(request: Request, context: RouteContext) {
  try {
    const { jobId, stopId } = await context.params;

    if (!isUuid(jobId) || !isUuid(stopId)) {
      return NextResponse.json({ error: "Job stop not found." }, { status: 404 });
    }

    let body: { filename?: unknown; mimeType?: unknown; size?: unknown };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateEvidenceMetadata({ evidenceType: "photo", mimeType: body.mimeType, size: body.size });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: validation.status });
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

    const upload = await createEvidenceUploadUrl(
      admin,
      { tenantId: session.tenantId, jobId, stopId },
      "photos",
      typeof body.filename === "string" ? body.filename : null,
    );

    return NextResponse.json({ ok: true, path: upload.path, token: upload.token });
  } catch (error) {
    const response = driverErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
