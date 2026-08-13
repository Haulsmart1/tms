import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

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

  const requestedTenantId = request.headers.get("x-tenant-id");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new ApiError(500, profileError.message);
  }

  if (!requestedTenantId) {
    if (!profile?.tenant_id) {
      throw new ApiError(403, "No tenant is linked to this user");
    }

    return {
      supabase,
      user,
      tenantId: profile.tenant_id as string,
    };
  }

  if (profile?.tenant_id === requestedTenantId) {
    return {
      supabase,
      user,
      tenantId: requestedTenantId,
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("tenant_id", requestedTenantId)
    .maybeSingle();

  if (membershipError) {
    throw new ApiError(500, membershipError.message);
  }

  if (!membership) {
    throw new ApiError(403, "You do not have access to this tenant");
  }

  return {
    supabase,
    user,
    tenantId: requestedTenantId,
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
