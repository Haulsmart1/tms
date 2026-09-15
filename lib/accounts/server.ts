import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { accountsAccessAllowed } from "./authz";
import { authorizeTenant, TenantAccessError } from "../auth/serverTenantAccess";
import { hasActiveDriverLink } from "../jobs/officeAccess";
import { toErrorResponse } from "./errors";
export { ACCOUNTS_ADMIN_ROLES } from "./authz";
export { AccountsHttpError } from "./errors";

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

  // Drivers are not accounts users, whether or not the route has an
  // allow-list (lib/accounts/authz.ts accountsAccessAllowed).
  let driverLink = false;
  if (authorized.tier === "staff") {
    try {
      driverLink = await hasActiveDriverLink(admin, user.id);
    } catch {
      throw new Error("TENANT_LOOKUP_FAILED");
    }
  }

  if (
    !accountsAccessAllowed(
      { tier: authorized.tier, roleName: authorized.caller.roleName, hasActiveDriverLink: driverLink },
      allowedRoles,
    )
  ) {
    throw new Error("FORBIDDEN");
  }

  return { admin, user, role, tier: authorized.tier };
}

/**
  Safe HTTP mapping for every accounts route (review ACC-15). Messages from
  AccountsHttpError are shown; anything else is logged and replaced by a
  generic message with a reference. See lib/accounts/errors.ts.
*/
export function errorResponse(error: unknown) {
  return toErrorResponse(error);
}
