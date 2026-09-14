import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { createAdminClient } from "../supabase/admin";
import { authorizeTenant, loadCallerProfile, TenantAccessError } from "../auth/serverTenantAccess";

export async function createApiSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Cookie writes can be unavailable in some render contexts.
          }
        },
      },
    }
  );
}

export async function requireTenant(request: NextRequest) {
  const supabase = await createApiSupabase();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new ApiError(401, "Not authenticated");
  }

  const requestedTenantId = request.headers.get("x-tenant-id")?.trim() || null;

  // Authorize from profiles, the same rule RLS applies (can_access_tenant),
  // not the legacy memberships table (review AUTH-4 / SET-3).
  const admin = createAdminClient();
  let caller;
  try {
    caller = await loadCallerProfile(admin, user.id);
  } catch {
    throw new ApiError(500, "Unable to verify tenant access");
  }

  const tenantId = requestedTenantId ?? caller.homeTenantId;
  if (!tenantId) {
    throw new ApiError(403, "No tenant is linked to this user");
  }

  let authorized;
  try {
    authorized = await authorizeTenant(admin, user.id, tenantId, "access");
  } catch (error) {
    if (error instanceof TenantAccessError && error.status === 403) {
      throw new ApiError(403, "You do not have access to this tenant");
    }
    throw new ApiError(500, "Unable to verify tenant access");
  }

  return {
    supabase,
    user,
    tenantId,
    /** profiles-based tier, the same one RLS uses: super_admin, admin or staff. */
    tier: authorized.tier,
    /** Exact roles.name for the caller, or null. */
    roleName: authorized.caller.roleName,
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
  Wraps a PostgREST/Postgres error without echoing its text (review ACC-15).
  The raw error is logged. Data problems the client can fix (class 22 data
  exceptions and class 23 constraint violations, plus PostgREST's malformed
  filter codes) answer 400 with a generic sentence; anything else is a 500.
*/
export function apiDbError(
  error: { code?: string | null; message?: string | null },
  message: string
): ApiError {
  console.error("[api] database error", error.code, error.message);
  const code = String(error.code ?? "");
  if (code.startsWith("22") || code.startsWith("23") || code === "PGRST100") {
    return new ApiError(400, `${message} Some of the details are not valid.`);
  }
  return new ApiError(500, message);
}
