import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function createAuthenticatedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Supabase public environment variables are missing.");
  }

  const cookieStore = await cookies();

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {}
      },
    },
  });
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRole) {
    throw new Error("Supabase server environment variables are missing.");
  }

  return createClient(url, serviceRole, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    const userClient = await createAuthenticatedClient();

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();

    if (!tenantId) {
      return NextResponse.json(
        { error: "A tenant must be selected." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const { data: membership, error: membershipError } = await admin
      .from("memberships")
      .select("id, role")
      .eq("tenant_id", tenantId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      throw new Error(membershipError.message);
    }

    if (!membership) {
      return NextResponse.json(
        { error: "You do not belong to the selected tenant." },
        { status: 403 }
      );
    }

    const { data, error } = await admin
      .from("subcontractors")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name");

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      subcontractors: data ?? [],
    });
  } catch (error) {
    console.error("Subcontractors API failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load subcontractors.",
      },
      { status: 500 }
    );
  }
}
