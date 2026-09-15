import type { RoleTier } from "../auth/tenantAccess";
import { isOfficeCaller } from "../jobs/officeRoles";

// Roles permitted to perform admin-only accounts actions (integration config,
// Stripe/Xero connection, document settings, document email).
// Matches the admin gate used in app/api/settings/users/invite/route.ts.
export const ACCOUNTS_ADMIN_ROLES = ["admin", "super_admin"] as const;

export function isRoleAuthorized(
  role: string | null | undefined,
  allowedRoles?: readonly string[],
): boolean {
  if (!allowedRoles) return true; // no allow-list => any authenticated member (read semantics)
  const normalized = String(role ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return allowedRoles.some((r) => r.toLowerCase() === normalized);
}

/**
 * Whether a tenant member may use an accounts route. Accounts is office work:
 * get_tenant_context() folds drivers into "staff", so tenant access alone let a
 * driver login record payments, approve invoices and credit notes, and convert
 * quotations. Drivers are refused by the same office rule POD sharing and job
 * deletion use (lib/jobs/officeRoles.ts); an allow-list, when given, then
 * applies on top, matching either the exact role or the tier.
 */
export function accountsAccessAllowed(
  input: { tier: RoleTier; roleName: string | null; hasActiveDriverLink: boolean },
  allowedRoles?: readonly string[],
): boolean {
  if (!isOfficeCaller(input)) return false;
  if (!allowedRoles) return true;
  return isRoleAuthorized(input.roleName, allowedRoles) || allowedRoles.includes(input.tier);
}
