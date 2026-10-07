import { NextResponse } from "next/server";
import { isUuid } from "../../../../../../../../../lib/auth/serverTenantAccess";
import { loadDriverJobStop } from "../../../../../../../../../lib/driver/jobAccess";
import { driverErrorResponse, requireDriverSession } from "../../../../../../../../../lib/driver/server";
import { isWorkableJobStatus, jobNotWorkableMessage } from "../../../../../../../../../lib/jobs/jobStatus";
import { validateEvidenceMetadata } from "../../../../../../../../../lib/pod/evidenceRules";
import { createEvidenceUploadUrl } from "../../../../../../../../../lib/pod/evidenceServer";
import { hasInvalidClientId, parseQueuedMeta } from "../../../../../../../../../lib/pod/queuedMeta";
import { createAdminClient } from "../../../../../../../../../lib/supabase/admin";
import { jobGateResponse, queuedJobGate } from "../../../../../../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string; stopId: string }> };

/*
  Step 1 of a driver POD photo upload (review POD-2): authorize the driver for
  this job and stop, check the declared type and size, and hand back a signed
  upload token for a path the server chose. A photo from the offline queue
  (body carries clientId) gets a path derived from that id, and token null
  when that object is already stored: the phone then skips the upload and
  goes straight to the record route.
*/
export async function POST(request: Request, context: RouteContext) {
  try {
    const { jobId, stopId } = await context.params;

    if (!isUuid(jobId) || !isUuid(stopId)) {
      return NextResponse.json({ error: "Job stop not found." }, { status: 404 });
    }

    let body: {
      filename?: unknown;
      mimeType?: unknown;
      size?: unknown;
      clientId?: unknown;
      shiftClientId?: unknown;
      recordedAt?: unknown;
    };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const meta = parseQueuedMeta(body);

    if (hasInvalidClientId(body, meta)) {
      return NextResponse.json({ error: "Invalid clientId." }, { status: 400 });
    }

    const validation = validateEvidenceMetadata({ evidenceType: "photo", mimeType: body.mimeType, size: body.size });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: validation.status });
    }

    const session = await requireDriverSession({ jobId });
    const admin = createAdminClient();
    // A request from the offline queue is gated at the time it was recorded.
    if (meta) {
      const queued = await queuedJobGate(admin, session, meta);
      if (queued.response) return queued.response;
    } else {
      const gate = await jobGateResponse(admin, session);
      if (gate) return gate;
    }

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
      { clientId: meta?.clientId ?? null },
    );

    return NextResponse.json({ ok: true, path: upload.path, token: upload.token });
  } catch (error) {
    const response = driverErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
