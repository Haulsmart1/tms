import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function createAuthenticatedClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase public environment variables are missing.");
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {}
      },
    },
  });
}

function createAdminClient() {
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

export async function GET() {
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

    const admin = createAdminClient();

    const { data: portalUser, error: portalUserError } = await admin
      .from("subcontractor_users")
      .select("id, tenant_id, subcontractor_id, employee_id, role, active")
      .eq("user_id", user.id)
      .eq("role", "driver")
      .eq("active", true)
      .maybeSingle();

    if (portalUserError) {
      throw new Error(portalUserError.message);
    }

    if (!portalUser) {
      return NextResponse.json(
        { error: "No active subcontractor driver access was found." },
        { status: 403 }
      );
    }

    const { data: driverLink, error: driverLinkError } = await admin
      .from("subcontractor_drivers")
      .select("id, driver_id, employee_id, active")
      .eq("tenant_id", portalUser.tenant_id)
      .eq("subcontractor_id", portalUser.subcontractor_id)
      .eq("employee_id", portalUser.employee_id)
      .eq("active", true)
      .maybeSingle();

    if (driverLinkError) {
      throw new Error(driverLinkError.message);
    }

    if (!driverLink?.driver_id) {
      return NextResponse.json(
        {
          error:
            "Your portal user is not linked to a driver record yet. Ask your subcontractor administrator to complete the driver setup.",
        },
        { status: 409 }
      );
    }

    const [driverResult, jobsResult, vehicleAssignmentsResult] = await Promise.all([
      admin
        .from("drivers")
        .select("*")
        .eq("id", driverLink.driver_id)
        .eq("tenant_id", portalUser.tenant_id)
        .maybeSingle(),

      admin
        .from("jobs")
        .select(
          "id, reference, customer_reference, status, job_date, scheduled_date, priority, notes, pod_status, vehicle_id, completed_at"
        )
        .eq("tenant_id", portalUser.tenant_id)
        .eq("subcontractor_id", portalUser.subcontractor_id)
        .eq("driver_id", driverLink.driver_id)
        .order("job_date", { ascending: false })
        .limit(100),

      admin
        .from("vehicle_assignments")
        .select("id, vehicle_id, driver_id, assigned_from, assigned_to, active, notes")
        .eq("tenant_id", portalUser.tenant_id)
        .eq("driver_id", driverLink.driver_id)
        .eq("active", true),
    ]);

    const firstError =
      driverResult.error ||
      jobsResult.error ||
      vehicleAssignmentsResult.error;

    if (firstError) {
      throw new Error(firstError.message);
    }

    return NextResponse.json({
      portalUser,
      driver: driverResult.data,
      jobs: jobsResult.data ?? [],
      vehicleAssignments: vehicleAssignmentsResult.data ?? [],
    });
  } catch (error) {
    console.error("Driver portal GET failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load driver dashboard.",
      },
      { status: 500 }
    );
  }
}
