/*
  Server-only helpers shared by the /api/settings/users routes.

  Authorization is decided from profiles with authorizeTenant(..., "manage"),
  the same rule as public.can_manage_tenant, never from memberships
  (review SET-3 / AUTH-4).
*/

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient, createUserClient } from "../../../../lib/accounts/server";
import { authorizeTenant, isUuid, TenantAccessError } from "../../../../lib/auth/serverTenantAccess";
import type { AuthorizedCaller } from "../../../../lib/auth/serverTenantAccess";
import type { ApiOutcome } from "../../../../lib/tenant/userAdmin";

export type UserAdminContext = AuthorizedCaller & {
  admin: SupabaseClient;
  user: User;
};

export function json(outcome: ApiOutcome) {
  return NextResponse.json(outcome.body, { status: outcome.status });
}

export async function requireUserAdmin(
  tenantId: string,
): Promise<{ ok: true; ctx: UserAdminContext } | { ok: false; response: NextResponse }> {
  if (!isUuid(tenantId)) {
    return { ok: false, response: NextResponse.json({ error: "A tenant must be selected." }, { status: 400 }) };
  }

  const userClient = await createUserClient();
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser();

  if (error || !user) {
    return { ok: false, response: NextResponse.json({ error: "You must be signed in." }, { status: 401 }) };
  }

  const admin = createAdminClient();

  try {
    const authorized = await authorizeTenant(admin, user.id, tenantId, "manage");
    return { ok: true, ctx: { ...authorized, admin, user } };
  } catch (accessError) {
    if (accessError instanceof TenantAccessError && accessError.status === 403) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Only a company administrator can manage users." }, { status: 403 }),
      };
    }
    console.error("[settings/users] authorization lookup failed", accessError);
    return {
      ok: false,
      response: NextResponse.json({ error: "Unable to verify your permissions." }, { status: 500 }),
    };
  }
}

export type TargetProfile = {
  id: string;
  companyId: string | null;
  roleId: string | null;
  roleName: string | null;
};

/**
  Loads the target profile and resolves its company the same way the SQL
  functions do: profiles.company_id, else the company of its home tenant.
  Returns null when the user is not in `companyId`, so another company's
  users read as "not found" and cannot be probed.
*/
export async function loadCompanyTarget(
  admin: SupabaseClient,
  userId: string,
  companyId: string | null,
): Promise<TargetProfile | null> {
  if (!isUuid(userId) || !companyId) return null;

  const { data, error } = await admin
    .from("profiles")
    .select("id, company_id, tenant_id, role_id, roles(name)")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error("profile lookup failed");
  if (!data) return null;

  let resolvedCompany: string | null = data.company_id ? String(data.company_id) : null;
  if (!resolvedCompany && data.tenant_id) {
    const { data: tenantRow, error: tenantError } = await admin
      .from("tenants")
      .select("company_id")
      .eq("id", data.tenant_id)
      .maybeSingle();
    if (tenantError) throw new Error("tenant lookup failed");
    resolvedCompany = tenantRow?.company_id ? String(tenantRow.company_id) : null;
  }

  if (resolvedCompany !== companyId) return null;

  const roles = data.roles as { name?: unknown } | { name?: unknown }[] | null;
  const role = Array.isArray(roles) ? roles[0] : roles;

  return {
    id: String(data.id),
    companyId: resolvedCompany,
    roleId: data.role_id ? String(data.role_id) : null,
    roleName: typeof role?.name === "string" ? role.name : null,
  };
}
