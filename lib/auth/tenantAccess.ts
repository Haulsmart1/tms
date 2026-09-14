/*
  Server-side tenant authorization, decided from `profiles` the same way RLS
  decides it.

  Why this exists: route handlers that use the service-role client bypass RLS,
  so they must authorize the caller themselves. They used to read the legacy
  `memberships` table, while RLS (`can_access_tenant`, `can_manage_tenant` in
  docs/sql/rls_02_helpers.sql) and `get_tenant_context()` read
  `profiles.role_id`, `profiles.company_id` and `profiles.tenant_id`. The two
  drifted: a memberships "admin" could do things RLS would refuse, and a
  profiles admin with no memberships row got a 403. Everything now decides from
  profiles, so the app is never more permissive than the database.

  These functions are pure and mirror the SQL exactly, including the exact,
  case-sensitive role comparison the SQL helpers use.
*/

import { SUPER_ADMIN_ROLE } from "../roles";

export const ADMIN_ROLE = "admin";

export type CallerProfile = {
  userId: string;
  /** roles.name via profiles.role_id, exactly as stored. */
  roleName: string | null;
  companyId: string | null;
  homeTenantId: string | null;
};

export type TenantRef = {
  id: string;
  companyId: string | null;
};

export type RoleTier = "super_admin" | "admin" | "staff";

/** Same normalization as get_tenant_context(): only exact matches are elevated. */
export function roleTier(roleName: string | null | undefined): RoleTier {
  if (roleName === SUPER_ADMIN_ROLE) return "super_admin";
  if (roleName === ADMIN_ROLE) return "admin";
  return "staff";
}

/** Mirrors public.can_access_tenant(target_tenant). */
export function canAccessTenant(caller: CallerProfile, tenant: TenantRef): boolean {
  const tier = roleTier(caller.roleName);
  if (tier === "super_admin") return true;
  if (caller.homeTenantId !== null && tenant.id === caller.homeTenantId) return true;
  return (
    tier === "admin" &&
    caller.companyId !== null &&
    tenant.companyId !== null &&
    tenant.companyId === caller.companyId
  );
}

/** Mirrors public.can_manage_tenant(target_tenant): no own-tenant branch. */
export function canManageTenant(caller: CallerProfile, tenant: TenantRef): boolean {
  const tier = roleTier(caller.roleName);
  if (tier === "super_admin") return true;
  return (
    tier === "admin" &&
    caller.companyId !== null &&
    tenant.companyId !== null &&
    tenant.companyId === caller.companyId
  );
}

/**
  Mirrors the integrity check in get_tenant_context(): a non-super caller whose
  home tenant is missing or belongs to another company is treated as having no
  tenant at all, so a half-provisioned or re-parented profile fails closed.
*/
export function hasValidHome(caller: CallerProfile, homeTenant: TenantRef | null): boolean {
  if (roleTier(caller.roleName) === "super_admin") return true;
  return (
    caller.homeTenantId !== null &&
    homeTenant !== null &&
    homeTenant.id === caller.homeTenantId &&
    caller.companyId !== null &&
    homeTenant.companyId === caller.companyId
  );
}

export type AccessLevel = "access" | "manage";

export type AccessDecision =
  | { ok: true; tier: RoleTier }
  | { ok: false; reason: "no-tenant" | "forbidden" };

/**
  The full decision a route needs. `allowedRoles`, when given, additionally
  requires the caller's exact role name (or tier) to be in the list; it can only
  narrow access, never widen it past the RLS rule for `level`.
*/
export function decideTenantAccess(input: {
  caller: CallerProfile;
  homeTenant: TenantRef | null;
  target: TenantRef;
  level: AccessLevel;
  allowedRoles?: readonly string[];
}): AccessDecision {
  const { caller, homeTenant, target, level, allowedRoles } = input;
  const tier = roleTier(caller.roleName);

  if (!hasValidHome(caller, homeTenant)) return { ok: false, reason: "no-tenant" };

  const allowed = level === "manage" ? canManageTenant(caller, target) : canAccessTenant(caller, target);
  if (!allowed) return { ok: false, reason: "forbidden" };

  if (allowedRoles) {
    const matches = allowedRoles.some((r) => r === caller.roleName || r === tier);
    if (!matches) return { ok: false, reason: "forbidden" };
  }

  return { ok: true, tier };
}
