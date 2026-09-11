import { createAdminClient } from "../supabase/admin";

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

  const {
    data: membership,
    error,
  } = await admin
    .from("memberships")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Unable to verify tachograph tenant permissions: ${error.message}`
    );
  }

  if (
    !membership ||
    !isTachographAdminRole(membership.role)
  ) {
    throw new Error("TACHOGRAPH_FORBIDDEN");
  }
}
