/*
  Server-only store for POD share links. Rules and rationale: lib/pod/shareLinks.ts.
  Backed by docs/sql/prodfix_60_pod_share_links.sql. Never import from client code.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  POD_SHARE_LIFETIME_SECONDS,
  evaluatePodShare,
  generatePodShareToken,
  hashPodShareToken,
  isShareableJobStatus,
  isWellFormedPodShareToken,
} from "./shareLinks";

const TABLE = "pod_share_links";
const MISSING_RELATION_CODES = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);

export class PodShareUnavailableError extends Error {
  constructor() {
    super("POD sharing is not available yet. An administrator needs to apply the pod_share_links database migration.");
  }
}

function isMissingTable(error: { code?: string } | null): boolean {
  return Boolean(error?.code && MISSING_RELATION_CODES.has(error.code));
}

export async function issuePodShareLink(
  admin: SupabaseClient,
  input: { tenantId: string; jobId: string; createdBy: string; sentToEmail?: string | null; now?: Date },
): Promise<{ token: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  const token = generatePodShareToken();
  const expiresAt = new Date(now.getTime() + POD_SHARE_LIFETIME_SECONDS * 1000).toISOString();

  const { error } = await admin.from(TABLE).insert({
    tenant_id: input.tenantId,
    job_id: input.jobId,
    token_hash: hashPodShareToken(token),
    created_by: input.createdBy,
    sent_to_email: input.sentToEmail ?? null,
    created_at: now.toISOString(),
    expires_at: expiresAt,
  });

  if (error) {
    if (isMissingTable(error)) throw new PodShareUnavailableError();
    console.error("[pod-share] unable to store share link", error.code);
    throw new Error("Unable to create the POD share link.");
  }

  return { token, expiresAt };
}

export type ResolvedPodShare = {
  shareId: string;
  tenantId: string;
  jobId: string;
  expiresAt: string;
};

/**
  Resolve a raw token to the job it shares, or null. Null covers every refusal
  (malformed, unknown, revoked, expired, job gone or no longer completed,
  tenant gone) so a caller cannot tell them apart.
*/
export async function resolvePodShareToken(
  admin: SupabaseClient,
  rawToken: string,
  now: Date = new Date(),
): Promise<ResolvedPodShare | null> {
  if (!isWellFormedPodShareToken(rawToken)) return null;

  const { data: share, error } = await admin
    .from(TABLE)
    .select("id, tenant_id, job_id, expires_at, revoked_at")
    .eq("token_hash", hashPodShareToken(rawToken))
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) {
      console.warn("[pod-share] pod_share_links is missing; refusing share link. Apply prodfix_60.");
      return null;
    }
    console.error("[pod-share] share lookup failed", error.code);
    throw new Error("Unable to verify the POD share link.");
  }

  if (!evaluatePodShare(share, now).ok || !share) return null;

  const tenantId = String(share.tenant_id);
  const jobId = String(share.job_id);

  const [jobResult, tenantResult] = await Promise.all([
    admin.from("jobs").select("id, status").eq("id", jobId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("tenants").select("id").eq("id", tenantId).maybeSingle(),
  ]);

  if (jobResult.error || tenantResult.error) {
    console.error("[pod-share] job or tenant lookup failed", jobResult.error?.code, tenantResult.error?.code);
    throw new Error("Unable to verify the POD share link.");
  }

  if (!jobResult.data || !tenantResult.data || !isShareableJobStatus(jobResult.data.status)) return null;

  void admin
    .from(TABLE)
    .update({ last_viewed_at: now.toISOString() })
    .eq("id", share.id)
    .then(({ error: touchError }) => {
      if (touchError) console.warn("[pod-share] unable to record view", touchError.code);
    });

  return { shareId: String(share.id), tenantId, jobId, expiresAt: String(share.expires_at) };
}

export async function revokePodShareLinks(
  admin: SupabaseClient,
  input: { tenantId: string; jobId: string; revokedBy: string; now?: Date },
): Promise<number> {
  const now = input.now ?? new Date();
  const { data, error } = await admin
    .from(TABLE)
    .update({ revoked_at: now.toISOString(), revoked_by: input.revokedBy })
    .eq("tenant_id", input.tenantId)
    .eq("job_id", input.jobId)
    .is("revoked_at", null)
    .select("id");

  if (error) {
    if (isMissingTable(error)) throw new PodShareUnavailableError();
    console.error("[pod-share] revoke failed", error.code);
    throw new Error("Unable to revoke POD share links.");
  }

  return data?.length ?? 0;
}
