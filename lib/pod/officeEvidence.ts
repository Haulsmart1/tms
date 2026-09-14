/*
  Server-only: the checks shared by the console evidence routes under
  app/api/pod/evidence. Console uploads used to write storage and pod_evidence
  straight from the browser with a client-chosen path (review POD-10), and
  deletes silently left the file behind because the bucket denies client
  deletes (review POD-17). Both now go through these routes, which authorize
  an office caller and do the storage work with the service role.
  Never import from client code.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { createApiSupabase } from "../api/server";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../jobs/officeAccess";
import type { AuthorizedCaller } from "../auth/serverTenantAccess";
import { isUuid } from "../auth/serverTenantAccess";
import { createAdminClient } from "../supabase/admin";

export class OfficeEvidenceError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function requireOfficeCaller(tenantId: unknown): Promise<{
  admin: SupabaseClient;
  userId: string;
  authorized: AuthorizedCaller;
  tenantId: string;
}> {
  if (!isUuid(tenantId)) throw new OfficeEvidenceError(400, "tenantId is required.");

  const userClient = await createApiSupabase();
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();
  if (error || !user) throw new OfficeEvidenceError(401, "You must be signed in.");

  const admin = createAdminClient();
  const authorized = await authorizeOfficeTenant(admin, user.id, tenantId);
  return { admin, userId: user.id, authorized, tenantId };
}

export async function loadOfficeStop(
  admin: SupabaseClient,
  tenantId: string,
  jobId: unknown,
  stopId: unknown,
): Promise<{ job: { id: string; status: string | null }; stop: { id: string; type: string; pod_status: string | null } }> {
  if (!isUuid(jobId) || !isUuid(stopId)) throw new OfficeEvidenceError(404, "Job stop not found.");

  const [jobResult, stopResult] = await Promise.all([
    admin.from("jobs").select("id,status").eq("id", jobId).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("job_stops").select("id,type,pod_status").eq("id", stopId).eq("job_id", jobId).eq("tenant_id", tenantId).maybeSingle(),
  ]);

  if (jobResult.error || stopResult.error) {
    throw new Error(jobResult.error?.message ?? stopResult.error?.message ?? "Lookup failed");
  }
  if (!jobResult.data || !stopResult.data) throw new OfficeEvidenceError(404, "Job stop not found.");

  return { job: jobResult.data, stop: stopResult.data };
}

export function isStopPodFinished(podStatus: string | null): boolean {
  return podStatus === "delivered" || podStatus === "collected";
}

export function officeEvidenceErrorResponse(error: unknown): { status: number; message: string } {
  if (error instanceof OfficeEvidenceError) return { status: error.status, message: error.message };
  const access = officeAccessErrorResponse(error);
  if (access) return access;
  console.error("[pod-evidence] request failed", error);
  return { status: 500, message: "Unable to process the POD evidence request." };
}
