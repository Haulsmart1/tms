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
