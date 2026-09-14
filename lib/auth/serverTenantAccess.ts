/*
  Server-only loaders for lib/auth/tenantAccess.ts. Takes a service-role client
  because the callers already hold one; nothing here trusts request input beyond
  the tenant id being asked about.

  Never import from client code.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decideTenantAccess,
  type AccessLevel,
  type CallerProfile,
  type RoleTier,
  type TenantRef,
} from "./tenantAccess";

export class TenantAccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 500,
    public readonly reason: "unauthenticated" | "no-tenant" | "forbidden" | "lookup-failed",
  ) {
    super(reason);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export async function loadTenantRef(admin: SupabaseClient, tenantId: string | null): Promise<TenantRef | null> {
  if (!isUuid(tenantId)) return null;
  const { data, error } = await admin.from("tenants").select("id, company_id").eq("id", tenantId).maybeSingle();
  if (error) throw new TenantAccessError(500, "lookup-failed");
  if (!data) return null;
  return { id: String(data.id), companyId: data.company_id ? String(data.company_id) : null };
}

export async function loadCallerProfile(admin: SupabaseClient, userId: string): Promise<CallerProfile> {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, tenant_id, company_id, role_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new TenantAccessError(500, "lookup-failed");

  let roleName: string | null = null;
  if (profile?.role_id) {
    const { data: role, error: roleError } = await admin
      .from("roles")
      .select("name")
      .eq("id", profile.role_id)
      .maybeSingle();
    if (roleError) throw new TenantAccessError(500, "lookup-failed");
    roleName = typeof role?.name === "string" ? role.name : null;
  }

  return {
    userId,
    roleName,
    companyId: profile?.company_id ? String(profile.company_id) : null,
    homeTenantId: profile?.tenant_id ? String(profile.tenant_id) : null,
  };
}

export type AuthorizedCaller = {
  caller: CallerProfile;
  tier: RoleTier;
  tenant: TenantRef;
};

/**
  Authorize `userId` against `tenantId` at `level`, using the same rule RLS
  uses. Throws TenantAccessError; an unknown or malformed tenant id is a 403,
  never a 500, so ids cannot be probed.
*/
export async function authorizeTenant(
  admin: SupabaseClient,
  userId: string,
  tenantId: string,
  level: AccessLevel,
  allowedRoles?: readonly string[],
): Promise<AuthorizedCaller> {
  const caller = await loadCallerProfile(admin, userId);
  const [target, homeTenant] = await Promise.all([
    loadTenantRef(admin, tenantId),
    loadTenantRef(admin, caller.homeTenantId),
  ]);
  if (!target) throw new TenantAccessError(403, "forbidden");

  const decision = decideTenantAccess({ caller, homeTenant, target, level, allowedRoles });
  if (!decision.ok) throw new TenantAccessError(403, decision.reason);
  return { caller, tier: decision.tier, tenant: target };
}
