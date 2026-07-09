// The role name that unlocks super-admin UI and routes.
// ⚠️ Must match roles.name in the database EXACTLY.
export const SUPER_ADMIN_ROLE = "super_admin";

export function extractRoleName(roles: unknown): string | null {
  if (!roles) return null;

  if (Array.isArray(roles)) {
    const first = roles[0];
    return first && typeof first.name === "string" ? first.name : null;
  }

  if (
    typeof roles === "object" &&
    "name" in roles &&
    typeof (roles as { name: unknown }).name === "string"
  ) {
    return (roles as { name: string }).name;
  }

  return null;
}
