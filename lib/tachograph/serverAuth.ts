import { createAdminClient } from "../supabase/admin";
import { authorizeTenant, TenantAccessError } from "../auth/serverTenantAccess";

const ADMIN_ROLES = new Set([
  "admin",
  "super_admin",
]);

export function isTachographAdminRole(
  role: unknown
): boolean {
  return (
    typeof role === "string" &&
    ADMIN_ROLES.has(role)
  );
}

/*
  Tachograph writes are admin-only. The check now comes from profiles, the same
  rule as public.can_manage_tenant, instead of the legacy memberships table,
  which company admins often have no row in (review PLAN-15).
*/
export async function requireTachographTenantAdmin(
  userId: string,
  tenantId: string
): Promise<void> {
  if (!userId.trim() || !tenantId.trim()) {
    throw new Error(
      "Unable to verify tachograph tenant permissions."
    );
  }

  const admin = createAdminClient();

  try {
    await authorizeTenant(admin, userId, tenantId, "manage");
  } catch (error) {
    if (error instanceof TenantAccessError && error.status === 403) {
      throw new Error("TACHOGRAPH_FORBIDDEN");
    }
    throw new Error(
      "Unable to verify tachograph tenant permissions."
    );
  }
}
