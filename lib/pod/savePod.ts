/*
  The one console POD save (review POD-14, POD-12).

  /jobs and /pod each wrote POD differently: /jobs skipped pod_updated_at,
  filtered the stop only by id and completed the job with no tenant filter,
  and neither checked the job's status. Both consoles now call this, which
  writes the same fields as the driver complete route, filters every write by
  tenant and job, refuses to complete work on a job that is cancelled or not
  yet accepted, and never overwrites a stop someone else already completed.

  Runs with the browser client, so RLS still applies underneath.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { WORKABLE_JOB_STATUSES, isWorkableJobStatus, jobNotWorkableMessage } from "../jobs/jobStatus";

export type SavePodInput = {
  tenantId: string;
  jobId: string;
  stopId: string;
  stopType: string;
  recipientName: string;
  podNotes: string;
  markComplete: boolean;
};

export function buildStopPodPatch(input: Pick<SavePodInput, "stopType" | "recipientName" | "podNotes" | "markComplete">, now: Date): Record<string, unknown> {
  const at = now.toISOString();
  const patch: Record<string, unknown> = {
    recipient_name: input.recipientName.trim() || null,
    pod_notes: input.podNotes.trim() || null,
    pod_updated_at: at,
  };

  if (input.markComplete) {
    patch.status = "completed";
    if (input.stopType === "collection") {
      patch.pod_status = "collected";
      patch.collected_at = at;
    } else {
      patch.pod_status = "delivered";
      patch.delivered_at = at;
    }
  }

  return patch;
}

export async function saveStopPod(
  supabase: SupabaseClient,
  input: SavePodInput,
  now: Date = new Date(),
): Promise<{ jobCompleted: boolean }> {
  if (input.stopType !== "collection" && input.stopType !== "delivery") {
    throw new Error("This stop type does not support POD.");
  }

  if (input.markComplete) {
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, status")
      .eq("id", input.jobId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) throw new Error("Job not found.");
    if (!isWorkableJobStatus(job.status)) throw new Error(jobNotWorkableMessage(job.status));
  }

  let stopUpdate = supabase
    .from("job_stops")
    .update(buildStopPodPatch(input, now))
    .eq("id", input.stopId)
    .eq("tenant_id", input.tenantId)
    .eq("job_id", input.jobId);

  if (input.markComplete) {
    stopUpdate = stopUpdate.or("pod_status.is.null,pod_status.eq.pending");
  }

  const { data: updatedStops, error: stopError } = await stopUpdate.select("id");
  if (stopError) throw new Error(stopError.message);
  if (!updatedStops || updatedStops.length === 0) {
    throw new Error("This stop was already completed or no longer exists. Refresh and try again.");
  }

  if (!input.markComplete || input.stopType !== "delivery") return { jobCompleted: false };

  const { data: deliveryStops, error: deliveryError } = await supabase
    .from("job_stops")
    .select("id, pod_status")
    .eq("tenant_id", input.tenantId)
    .eq("job_id", input.jobId)
    .eq("type", "delivery");
  if (deliveryError) throw new Error(deliveryError.message);

  const allDelivered =
    (deliveryStops ?? []).length > 0 && (deliveryStops ?? []).every((stop) => stop.pod_status === "delivered");
  if (!allDelivered) return { jobCompleted: false };

  const { error: jobUpdateError } = await supabase
    .from("jobs")
    .update({ status: "completed", pod_status: "delivered", completed_at: now.toISOString() })
    .eq("id", input.jobId)
    .eq("tenant_id", input.tenantId)
    .in("status", [...WORKABLE_JOB_STATUSES]);
  if (jobUpdateError) throw new Error(jobUpdateError.message);

  return { jobCompleted: true };
}
