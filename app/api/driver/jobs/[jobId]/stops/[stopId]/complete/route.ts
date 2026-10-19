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
import { hasInvalidClientId, parseQueuedMeta } from "../../../../../../../../lib/pod/queuedMeta";
import { podTimeFlags } from "../../../../../../../../lib/pod/recordedTime";
import { createAdminClient } from "../../../../../../../../lib/supabase/admin";
import { jobGateResponse, queuedJobGate } from "../../../../../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string; stopId: string }> };

type CompleteBody = {
  recipient_name?: unknown;
  pod_notes?: unknown;
  clientId?: unknown;
  shiftClientId?: unknown;
  recordedAt?: unknown;
};

function matchesQueuedCompletion(stop: { recipient_name: string | null; pod_notes: string | null }, body: CompleteBody): boolean {
  const recipient = typeof body.recipient_name === "string" ? body.recipient_name.trim() : "";
  const notes = typeof body.pod_notes === "string" ? body.pod_notes.trim() || null : null;
  return recipient.length > 0 && recipient.length <= 200 && (notes === null || notes.length <= 4000)
    && recipient === stop.recipient_name && notes === stop.pod_notes;
}

function unconfirmedCompletion() {
  return NextResponse.json(
    { error: "This delivery is complete, but this phone's recipient or notes were not confirmed as saved. Keep your evidence and contact the office." },
    { status: 409 },
  );
}

/*
  Complete a delivery stop from the driver app. Server-side rules (review POD-12):
  - the job must be open (not cancelled, unaccepted or already completed),
  - a delivered stop is never overwritten; repeating the call is a no-op,
  - every serialised item must be scanned before the final delivery,
  - the job only flips to completed while it is still open.
  A completion from the offline queue (body carries clientId, shiftClientId,
  recordedAt) is gated at its recorded time and, when that time is trusted,
  delivered_at is that time; otherwise server time plus the
  pod_time_untrusted flag. A trusted time more than 15 minutes before the
  server received it is kept and flagged pod_late_sync, so a backdated POD is
  always visible to the office (lib/pod/recordedTime.ts podTimeFlags).
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
    let body: CompleteBody = {};
    try {
      body = (await request.json()) as CompleteBody;
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    } catch {
      // Preserve the existing bodyless, non-queued delivered-stop no-op.
      if (!alreadyCompleted || request.body !== null) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
      body = {};
    }
    const meta = parseQueuedMeta(body);
    if (hasInvalidClientId(body, meta)) {
      return NextResponse.json({ error: "Invalid clientId." }, { status: 400 });
    }

    // Another device or the office may have completed this stop while the
    // driver's original recipient/notes were offline. A delivered status is
    // not proof those fields were saved. Never overwrite the saved POD, and
    // do not ACK away a conflicting queued completion.
    if (alreadyCompleted && meta && !matchesQueuedCompletion(stop, body)) return unconfirmedCompletion();

    if (!alreadyCompleted) {
      const receivedAt = new Date();
      let recordedAt = receivedAt.toISOString();
      let timeTrusted = true;

      // A request from the offline queue is gated at the time it was recorded.
      if (meta) {
        const queued = await queuedJobGate(admin, session, meta, { notBefore: job.created_at ?? null, now: receivedAt });
        if (queued.response) return queued.response;
        recordedAt = queued.at;
        timeTrusted = queued.trusted;
      } else {
        const gate = await jobGateResponse(admin, session);
        if (gate) return gate;
      }

      if (!isWorkableJobStatus(job.status)) {
        return NextResponse.json({ error: jobNotWorkableMessage(job.status) }, { status: 409 });
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

      completedAt = recordedAt;

      const stopPatch: Record<string, unknown> = {
        recipient_name: validation.recipientName,
        pod_notes: validation.podNotes,
        delivered_at: completedAt,
        pod_updated_at: completedAt,
        pod_status: "delivered",
        status: "completed",
      };
      // A queued completion always states its flags: pod_time_untrusted when
      // server time was used, pod_late_sync when a trusted time is old, else none.
      if (meta) stopPatch.pod_flags = podTimeFlags({ at: recordedAt, trusted: timeTrusted, serverNow: receivedAt });

      const updateStop = (patch: Record<string, unknown>) =>
        admin
          .from("job_stops")
          .update(patch)
          .eq("id", stopId)
          .eq("job_id", jobId)
          .eq("tenant_id", session.tenantId)
          .or("pod_status.is.null,pod_status.neq.delivered")
          .select("id");

      let { data: updatedStops, error: updateStopError } = await updateStop(stopPatch);

      // PostgREST reports an update naming an unknown column as PGRST204 (schema
      // cache) and Postgres itself as 42703; either means the column is missing.
      const missingColumn = updateStopError?.code === "42703" || updateStopError?.code === "PGRST204";

      if (missingColumn && "pod_flags" in stopPatch) {
        // tracking_02 not applied yet: never block a delivery on a missing flag column.
        console.warn("[driver/complete] job_stops.pod_flags is missing; saved without pod_flags. Apply tracking_02.");
        const { pod_flags: _omit, ...withoutFlag } = stopPatch;
        ({ data: updatedStops, error: updateStopError } = await updateStop(withoutFlag));
      }

      if (updateStopError) throw new Error(updateStopError.message);

      if (!updatedStops || updatedStops.length === 0) {
        // A zero-row update can also mean the stop disappeared or its
        // assignment changed. Re-authorize and confirm a persisted delivery
        // before acknowledging the queue item; an uncertain result must keep
        // the driver's evidence for reconciliation.
        const current = await loadDriverJobStop(admin, session, jobId, stopId);
        if (!current || current.stop.type !== "delivery" || current.stop.pod_status !== "delivered") {
          return NextResponse.json(
            { error: "Delivery completion could not be confirmed. Keep your evidence and contact the office." },
            { status: 409 },
          );
        }
        if (meta && !matchesQueuedCompletion(current.stop, body)) return unconfirmedCompletion();
        alreadyCompleted = true;
        completedAt = current.stop.delivered_at ?? completedAt;
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
    let jobCompleted = allDelivered && job.status === "completed";

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

      const { data: updatedJob, error: updateJobError } = await updateJob.select("id").maybeSingle();

      if (updateJobError) throw new Error(updateJobError.message);
      jobCompleted = Boolean(updatedJob);

      if (!updatedJob) {
        // Dispatch may have reassigned or cancelled the job since the initial
        // read. Keep the saved stop evidence, but never report an unconfirmed
        // job transition. A concurrent completion is safe to acknowledge.
        const { data: currentJob, error: currentJobError } = await admin
          .from("jobs")
          .select("status,pod_status")
          .eq("id", jobId)
          .eq("tenant_id", session.tenantId)
          .maybeSingle();
        if (currentJobError) throw new Error(currentJobError.message);
        jobCompleted = currentJob?.status === "completed" && currentJob?.pod_status === "delivered";
      }
    }

    return NextResponse.json({
      ok: true,
      alreadyCompleted,
      completedAt,
      jobCompleted,
    });
  } catch (error) {
    const response = driverErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
