import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

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

export async function requireTenantAccess(tenantId: string) {
  const userClient = await createUserClient();

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    throw new Error("UNAUTHENTICATED");
  }

  const admin = createAdminClient();

  const { data: membership, error } = await admin
    .from("memberships")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!membership) {
    throw new Error("FORBIDDEN");
  }

  return {
    admin,
    user,
    role: String(membership.role ?? ""),
  };
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
