/*
  Server-only: authorize an office caller for a tenant. See lib/jobs/officeRoles.ts.
  Never import from client code.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authorizeTenant,
  TenantAccessError,
  type AuthorizedCaller,
} from "../auth/serverTenantAccess";
import type { AccessLevel } from "../auth/tenantAccess";
import { isOfficeCaller } from "./officeRoles";

async function hasActiveDriverLink(admin: SupabaseClient, userId: string): Promise<boolean> {
  const [direct, portal] = await Promise.all([
    admin.from("driver_users").select("user_id", { count: "exact", head: true }).eq("user_id", userId).eq("active", true),
    admin
      .from("subcontractor_users")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("role", "driver")
      .eq("active", true),
  ]);
  if (direct.error || portal.error) throw new TenantAccessError(500, "lookup-failed");
  return (direct.count ?? 0) > 0 || (portal.count ?? 0) > 0;
}

export async function authorizeOfficeTenant(
  admin: SupabaseClient,
  userId: string,
  tenantId: string,
  level: AccessLevel = "access",
): Promise<AuthorizedCaller> {
  const authorized = await authorizeTenant(admin, userId, tenantId, level);
  const office = isOfficeCaller({
    tier: authorized.tier,
    roleName: authorized.caller.roleName,
    hasActiveDriverLink:
      authorized.tier === "staff" ? await hasActiveDriverLink(admin, userId) : false,
  });
  if (!office) throw new TenantAccessError(403, "forbidden");
  return authorized;
}

/** Status and a user-safe message for a thrown access error. */
export function officeAccessErrorResponse(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof TenantAccessError)) return null;
  if (error.status === 401) return { status: 401, message: "You must be signed in." };
  if (error.status === 403) return { status: 403, message: "You do not have permission to do this for this tenant." };
  return { status: 500, message: "Unable to verify tenant access." };
}
