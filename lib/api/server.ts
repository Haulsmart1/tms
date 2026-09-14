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

  try {
    await authorizeTenant(admin, user.id, tenantId, "access");
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
