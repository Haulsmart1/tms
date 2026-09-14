import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { isRoleAuthorized } from "./authz";
import { authorizeTenant, TenantAccessError } from "../auth/serverTenantAccess";
export { ACCOUNTS_ADMIN_ROLES } from "./authz";

export async function createUserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase public environment variables are missing.");
  }

  const store = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => {
            store.set(name, value, options);
          });
        } catch {}
      },
    },
  });
}

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server environment variables are missing.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function requireTenantAccess(
  tenantId: string,
  allowedRoles?: readonly string[],
) {
  const userClient = await createUserClient();

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    throw new Error("UNAUTHENTICATED");
  }

  const admin = createAdminClient();

  // Authorize from profiles, the same rule RLS applies (can_access_tenant),
  // not the legacy memberships table (review ACC-2 / AUTH-4 / SET-3).
  let authorized;
  try {
    authorized = await authorizeTenant(admin, user.id, tenantId, "access");
  } catch (error) {
    if (error instanceof TenantAccessError && error.status === 403) {
      throw new Error("FORBIDDEN");
    }
    throw new Error("TENANT_LOOKUP_FAILED");
  }

  const role = authorized.caller.roleName ?? "";

  if (allowedRoles && !isRoleAuthorized(role, allowedRoles) && !allowedRoles.includes(authorized.tier)) {
    throw new Error("FORBIDDEN");
  }

  return { admin, user, role, tier: authorized.tier };
}

export function errorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unexpected server error.";

  if (message === "UNAUTHENTICATED") {
    return { status: 401, body: { error: "You must be signed in." } };
  }

  if (message === "FORBIDDEN") {
    return { status: 403, body: { error: "You do not have access to this tenant." } };
  }

  return { status: 500, body: { error: message } };
}
