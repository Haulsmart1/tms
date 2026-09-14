/*
  "Office" callers: people who run jobs, as opposed to drivers who carry them
  out (review POD-3, POD-18, POD-19, POD-23).

  Tenant access alone is not enough for sharing or emailing a POD, deleting a
  job or building a load manifest: get_tenant_context() folds every non-admin
  role into "staff", so an invited driver passes an access check. A caller is
  refused here when their profile role is a driver role, or when they hold an
  active driver link, unless they are an admin or super admin.

  Pure; lib/jobs/officeAccess.ts loads the inputs.
*/

import type { RoleTier } from "../auth/tenantAccess";

const DRIVER_ROLE_NAMES = new Set(["driver", "subcontractor_driver"]);

export function isDriverRoleName(roleName: string | null | undefined): boolean {
  return DRIVER_ROLE_NAMES.has(String(roleName ?? "").trim().toLowerCase());
}

export function isOfficeCaller(input: {
  tier: RoleTier;
  roleName: string | null;
  hasActiveDriverLink: boolean;
}): boolean {
  if (input.tier === "admin" || input.tier === "super_admin") return true;
  if (isDriverRoleName(input.roleName)) return false;
  return !input.hasActiveDriverLink;
}
