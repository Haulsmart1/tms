/*
  Server-only helpers for the subcontractor write routes (finding M-4).
  Never import from client code: this uses the service-role client.

  Every write route goes through requireSubcontractorWriter, which:
  - resolves the tenant from x-tenant-id with requireTenant (the record's own
    tenant, never the selector),
  - refuses drivers with authorizeOfficeTenant (lib/jobs/officeRoles.ts), and
  - for "manage" also requires an admin of that tenant, the same rule as
    can_manage_tenant. Subcontractor records carry commercial terms that only
    admins can read (lib/accounts/portalScope.ts), so only admins write them.
*/

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, apiDbError, requireTenant } from "../api/server";
import { isUuid, TenantAccessError } from "../auth/serverTenantAccess";
import type { AccessLevel } from "../auth/tenantAccess";
import { authorizeOfficeTenant } from "../jobs/officeAccess";
import { createAdminClient } from "../supabase/admin";

export type SubcontractorWriter = {
  admin: SupabaseClient;
  tenantId: string;
};

export async function requireSubcontractorWriter(
  request: NextRequest,
  level: AccessLevel,
): Promise<SubcontractorWriter> {
  const { user, tenantId } = await requireTenant(request);
  const admin = createAdminClient();

  try {
    await authorizeOfficeTenant(admin, user.id, tenantId, level);
  } catch (error) {
    if (error instanceof TenantAccessError && error.status === 403) {
      throw new ApiError(
        403,
        level === "manage"
          ? "Only an admin can manage subcontractors."
          : "Only office staff can change subcontractor records.",
      );
    }
    throw new ApiError(500, "Unable to verify tenant access.");
  }

  return { admin, tenantId };
}

/** Parse the JSON body, answering 400 for anything that is not JSON. */
export async function readJsonBody(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "The request body must be a JSON object.");
  }
}

/**
  Confirm `subcontractorId` is a subcontractor in `tenantId`. An employee or
  vehicle is only ever attached to a subcontractor of the same tenant, so a
  guessed id from another tenant answers 404 rather than linking across.
*/
export async function requireSubcontractorInTenant(
  admin: SupabaseClient,
  subcontractorId: string,
  tenantId: string,
): Promise<void> {
  if (!isUuid(subcontractorId)) throw new ApiError(404, "Subcontractor not found.");

  const { data, error } = await admin
    .from("subcontractors")
    .select("id")
    .eq("id", subcontractorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw apiDbError(error, "Unable to load the subcontractor.");
  if (!data) throw new ApiError(404, "Subcontractor not found.");
}

export function subcontractorApiError(error: unknown, context: string) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error(`${context} failed:`, error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
