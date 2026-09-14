/*
  Server-only: load a job and one of its stops for the signed-in driver, with
  the fields every driver write route checks (review POD-12). Returns null when
  the job is not assigned to this driver or the stop is not on it, so routes
  answer 404 without revealing which part failed.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverSession } from "./server";

export type DriverJob = {
  id: string;
  status: string | null;
  subcontractor_id: string | null;
};

export type DriverStop = {
  id: string;
  type: string;
  pod_status: string | null;
  pod_photo_url: string | null;
  delivered_at: string | null;
};

export async function loadDriverJobStop(
  admin: SupabaseClient,
  session: DriverSession,
  jobId: string,
  stopId: string,
): Promise<{ job: DriverJob; stop: DriverStop } | null> {
  let jobQuery = admin
    .from("jobs")
    .select("id,status,subcontractor_id")
    .eq("id", jobId)
    .eq("tenant_id", session.tenantId)
    .eq("driver_id", session.driverId);

  if (session.subcontractorId) {
    jobQuery = jobQuery.eq("subcontractor_id", session.subcontractorId);
  }

  const { data: job, error: jobError } = await jobQuery.maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) return null;

  const { data: stop, error: stopError } = await admin
    .from("job_stops")
    .select("id,type,pod_status,pod_photo_url,delivered_at")
    .eq("id", stopId)
    .eq("job_id", jobId)
    .eq("tenant_id", session.tenantId)
    .maybeSingle();
  if (stopError) throw new Error(stopError.message);
  if (!stop) return null;

  return { job: job as DriverJob, stop: stop as DriverStop };
}
