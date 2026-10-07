/*
  Server-only store for tracking links. Rules and rationale: lib/tracking/links.ts.
  Backed by docs/sql/tracking_01_links_and_eta_cache.sql (RLS on, no policies,
  no client grants), so every call takes the service-role client. Never import
  from client code: it pulls in node:crypto through links.ts.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateTrackingLink, generateTrackingToken, hashTrackingToken, isWellFormedTrackingToken, trackingLinkExpiry } from "./links";
import { isStopCompleted } from "./viewInputs";

const TABLE = "stop_tracking_links";
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);

export class TrackingUnavailableError extends Error {
  constructor() {
    super("Tracking links are not available yet. An administrator needs to apply the tracking_01 database migration.");
  }
}

export class TrackableStopError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function isMissingTable(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING_RELATION_CODES.has(error.code));
}

export type TrackableStop = {
  stopId: string;
  jobId: string;
  tenantId: string;
  /** YYYY-MM-DD from jobs.planning_date, falling back to scheduled_date. */
  plannedDate: string | null;
  customerId: string | null;
  reference: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
  A delivery stop the office may send a tracking link for: in this tenant, on
  a job that is not cancelled, and not already delivered. The contact columns
  come from the stop-contacts migration (docs/sql/20260929093000_job_stop_contacts.sql);
  when it is unapplied the select falls back to the columns that always exist.
*/
export async function loadTrackableStop(admin: SupabaseClient, tenantId: string, stopId: string): Promise<TrackableStop> {
  const base = "id,job_id,type,status,pod_status,delivered_at";
  let result = await admin
    .from("job_stops")
    .select(`${base},contact_name,contact_email,contact_phone`)
    .eq("id", stopId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (result.error?.code === "42703") {
    result = await admin.from("job_stops").select(base).eq("id", stopId).eq("tenant_id", tenantId).maybeSingle();
  }
  if (result.error) throw new Error(result.error.message);
  const stop = result.data as Record<string, unknown> | null;
  if (!stop || stop.type !== "delivery") throw new TrackableStopError("Delivery stop not found.", 404);

  const { data: job, error: jobError } = await admin
    .from("jobs")
    .select("id,status,reference,customer_id,planning_date,scheduled_date")
    .eq("id", String(stop.job_id))
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) throw new TrackableStopError("Job not found.", 404);
  if (job.status === "cancelled") throw new TrackableStopError("This job is cancelled.", 409);
  if (isStopCompleted(stop)) throw new TrackableStopError("This delivery is already complete.", 409);

  const plannedDate = str(job.planning_date ?? job.scheduled_date);

  return {
    stopId,
    jobId: String(job.id),
    tenantId,
    plannedDate: plannedDate ? plannedDate.slice(0, 10) : null,
    customerId: job.customer_id ? String(job.customer_id) : null,
    reference: str(job.reference),
    contactName: str(stop.contact_name),
    contactEmail: str(stop.contact_email),
    contactPhone: str(stop.contact_phone),
  };
}

export async function issueTrackingLink(
  admin: SupabaseClient,
  input: { stop: TrackableStop; createdBy: string; sentToEmail?: string | null; now?: Date },
): Promise<{ token: string; tokenHash: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  const token = generateTrackingToken();
  const tokenHash = hashTrackingToken(token);
  const expiresAt = trackingLinkExpiry(input.stop.plannedDate, now);

  const { error } = await admin.from(TABLE).insert({
    tenant_id: input.stop.tenantId,
    job_id: input.stop.jobId,
    stop_id: input.stop.stopId,
    token_hash: tokenHash,
    created_by: input.createdBy,
    sent_to_email: input.sentToEmail ?? null,
    created_at: now.toISOString(),
    expires_at: expiresAt,
  });

  if (error) {
    if (isMissingTable(error)) throw new TrackingUnavailableError();
    console.error("[tracking] unable to store link", error.code);
    throw new Error("Unable to create the tracking link.");
  }

  return { token, tokenHash, expiresAt };
}

export type ResolvedTrackingLink = { linkId: string; tenantId: string; jobId: string; stopId: string };

/** Null for every refusal (malformed, unknown, revoked, expired, missing table) so callers cannot tell them apart. */
export async function resolveTrackingToken(admin: SupabaseClient, rawToken: string, now: Date = new Date()): Promise<ResolvedTrackingLink | null> {
  if (!isWellFormedTrackingToken(rawToken)) return null;

  const { data, error } = await admin
    .from(TABLE)
    .select("id,tenant_id,job_id,stop_id,expires_at,revoked_at")
    .eq("token_hash", hashTrackingToken(rawToken))
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) {
      console.warn("[tracking] stop_tracking_links is missing; refusing link. Apply tracking_01.");
      return null;
    }
    console.error("[tracking] link lookup failed", error.code);
    throw new Error("Unable to verify the tracking link.");
  }

  if (!data || !evaluateTrackingLink(data as { expires_at: string; revoked_at: string | null }, now)) return null;

  /* Awaited: a serverless function may be frozen as soon as the response is
     sent, so a fire-and-forget update can be lost. A failure only logs. */
  const { error: touchError } = await admin.from(TABLE).update({ last_viewed_at: now.toISOString() }).eq("id", data.id);
  if (touchError) console.warn("[tracking] unable to record view", touchError.code);

  return { linkId: String(data.id), tenantId: String(data.tenant_id), jobId: String(data.job_id), stopId: String(data.stop_id) };
}

export async function revokeTrackingLinks(
  admin: SupabaseClient,
  input: { tenantId: string; stopId: string; revokedBy: string; now?: Date },
): Promise<number> {
  const now = (input.now ?? new Date()).toISOString();
  const { data, error } = await admin
    .from(TABLE)
    .update({ revoked_at: now, revoked_by: input.revokedBy })
    .eq("tenant_id", input.tenantId)
    .eq("stop_id", input.stopId)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    if (isMissingTable(error)) throw new TrackingUnavailableError();
    throw new Error(error.message);
  }
  return data?.length ?? 0;
}
