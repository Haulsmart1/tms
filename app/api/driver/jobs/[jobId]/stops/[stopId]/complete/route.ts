import { NextResponse } from "next/server";
import { isUuid } from "../../../../../../../../lib/auth/serverTenantAccess";
import { barcodeCompletionBlock } from "../../../../../../../../lib/driver/completionRules";
import { loadDriverJobStop } from "../../../../../../../../lib/driver/jobAccess";
import {
  areAllDeliveryStopsDelivered,
  validatePodCompletion,
} from "../../../../../../../../lib/driver/pod";
import { driverErrorResponse, requireDriverSession } from "../../../../../../../../lib/driver/server";
import {
  WORKABLE_JOB_STATUSES,
  isWorkableJobStatus,
  jobNotWorkableMessage,
} from "../../../../../../../../lib/jobs/jobStatus";
import { createAdminClient } from "../../../../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string; stopId: string }> };

type CompleteBody = {
  recipient_name?: unknown;
  pod_notes?: unknown;
};

/*
  Complete a delivery stop from the driver app. Server-side rules (review POD-12):
  - the job must be open (not cancelled, unaccepted or already completed),
  - a delivered stop is never overwritten; repeating the call is a no-op,
  - every serialised item must be scanned before the final delivery,
  - the job only flips to completed while it is still open.
*/
export async function POST(request: Request, context: RouteContext) {
  try {
    const { jobId, stopId } = await context.params;

    if (!isUuid(jobId) || !isUuid(stopId)) {
      return NextResponse.json({ error: "Job stop not found." }, { status: 404 });
    }

    const session = await requireDriverSession({ jobId });
    const admin = createAdminClient();
    const loaded = await loadDriverJobStop(admin, session, jobId, stopId);

    if (!loaded || loaded.stop.type !== "delivery") {
      return NextResponse.json({ error: "Delivery stop not found." }, { status: 404 });
    }

    const { job, stop } = loaded;
    let alreadyCompleted = stop.pod_status === "delivered";
    let completedAt = stop.delivered_at ?? new Date().toISOString();

    if (!alreadyCompleted) {
      if (!isWorkableJobStatus(job.status)) {
        return NextResponse.json({ error: jobNotWorkableMessage(job.status) }, { status: 409 });
      }

      let body: CompleteBody;

      try {
        body = (await request.json()) as CompleteBody;
      } catch {
        return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
      }

      const [evidenceResult, stopsResult, itemsResult, scansResult] = await Promise.all([
        admin
          .from("pod_evidence")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", session.tenantId)
          .eq("job_id", jobId)
          .eq("stop_id", stopId),
        admin
          .from("job_stops")
          .select("id,pod_status")
          .eq("tenant_id", session.tenantId)
          .eq("job_id", jobId)
          .eq("type", "delivery"),
        admin
          .from("job_items")
          .select("id,serial_numbers")
          .eq("tenant_id", session.tenantId)
          .eq("job_id", jobId),
        admin
          .from("job_item_scans")
          .select("job_item_id,serial_number")
          .eq("tenant_id", session.tenantId)
          .eq("job_id", jobId),
      ]);

      const lookupError =
        evidenceResult.error || stopsResult.error || itemsResult.error || scansResult.error;

      if (lookupError) throw new Error(lookupError.message);

      const validation = validatePodCompletion({
        recipientName: body.recipient_name,
        podNotes: body.pod_notes,
        evidenceCount: evidenceResult.count ?? 0,
        legacyPhotoUrl: stop.pod_photo_url,
      });

      if (!validation.ok) {
        return NextResponse.json({ error: validation.message }, { status: validation.status });
      }

      const otherOutstanding = (stopsResult.data ?? []).filter(
        (deliveryStop) => deliveryStop.id !== stopId && deliveryStop.pod_status !== "delivered",
      ).length;

      const barcodeBlock = barcodeCompletionBlock({
        items: itemsResult.data ?? [],
        scans: scansResult.data ?? [],
        otherOutstandingDeliveryStops: otherOutstanding,
      });

      if (barcodeBlock) {
        return NextResponse.json({ error: barcodeBlock }, { status: 409 });
      }

      completedAt = new Date().toISOString();

      const { data: updatedStops, error: updateStopError } = await admin
        .from("job_stops")
        .update({
          recipient_name: validation.recipientName,
          pod_notes: validation.podNotes,
          delivered_at: completedAt,
          pod_updated_at: completedAt,
          pod_status: "delivered",
          status: "completed",
        })
        .eq("id", stopId)
        .eq("job_id", jobId)
        .eq("tenant_id", session.tenantId)
        .or("pod_status.is.null,pod_status.neq.delivered")
        .select("id");

      if (updateStopError) throw new Error(updateStopError.message);

      if (!updatedStops || updatedStops.length === 0) {
        // Completed by someone else between the read and the write.
        alreadyCompleted = true;
      }
    }

    const { data: deliveryStops, error: deliveryStopsError } = await admin
      .from("job_stops")
      .select("id,pod_status,delivered_at")
      .eq("tenant_id", session.tenantId)
      .eq("job_id", jobId)
      .eq("type", "delivery");

    if (deliveryStopsError) throw new Error(deliveryStopsError.message);

    const allDelivered = areAllDeliveryStopsDelivered(deliveryStops ?? []);

    const jobCompletedAt =
      (deliveryStops ?? [])
        .map((deliveryStop) => deliveryStop.delivered_at)
        .filter((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)))
        .sort((left, right) => Date.parse(left) - Date.parse(right))
        .at(-1) ?? completedAt;

    if (allDelivered && job.status !== "completed") {
      let updateJob = admin
        .from("jobs")
        .update({
          status: "completed",
          pod_status: "delivered",
          completed_at: jobCompletedAt,
        })
        .eq("id", jobId)
        .eq("tenant_id", session.tenantId)
        .eq("driver_id", session.driverId)
        .in("status", [...WORKABLE_JOB_STATUSES]);

      if (session.subcontractorId) {
        updateJob = updateJob.eq("subcontractor_id", session.subcontractorId);
      }

      const { error: updateJobError } = await updateJob;

      if (updateJobError) throw new Error(updateJobError.message);
    }

    return NextResponse.json({
      ok: true,
      alreadyCompleted,
      completedAt,
      jobCompleted: allDelivered,
    });
  } catch (error) {
    const response = driverErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
