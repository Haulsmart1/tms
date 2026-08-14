import { NextRequest, NextResponse } from "next/server";
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
        } catch {
          // Existing request cookies are enough for auth checks.
        }
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

export async function GET(_request: NextRequest) {
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
      .select(
        "id, tenant_id, subcontractor_id, employee_id, user_id, role, active"
      )
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (portalUserError) {
      throw new Error(portalUserError.message);
    }

    if (!portalUser) {
      return NextResponse.json(
        { error: "No active subcontractor portal access was found." },
        { status: 403 }
      );
    }

    const [subcontractorResult, employeeResult, jobsResult, vehiclesResult, employeesResult, usersResult] =
      await Promise.all([
        admin
          .from("subcontractors")
          .select("*")
          .eq("id", portalUser.subcontractor_id)
          .eq("tenant_id", portalUser.tenant_id)
          .maybeSingle(),

        admin
          .from("subcontractor_employees")
          .select("*")
          .eq("id", portalUser.employee_id)
          .eq("subcontractor_id", portalUser.subcontractor_id)
          .eq("tenant_id", portalUser.tenant_id)
          .maybeSingle(),

        admin
          .from("jobs")
          .select(
            "id, reference, customer_reference, external_reference, status, scheduled_date, job_date, priority, notes, vehicle_id, driver_id, subcontractor_cost, pod_status, completed_at, created_at"
          )
          .eq("tenant_id", portalUser.tenant_id)
          .eq("subcontractor_id", portalUser.subcontractor_id)
          .order("job_date", { ascending: false })
          .limit(100),

        admin
          .from("subcontractor_vehicles")
          .select("*")
          .eq("tenant_id", portalUser.tenant_id)
          .eq("subcontractor_id", portalUser.subcontractor_id)
          .order("registration"),

        admin
          .from("subcontractor_employees")
          .select("*")
          .eq("tenant_id", portalUser.tenant_id)
          .eq("subcontractor_id", portalUser.subcontractor_id)
          .order("full_name"),

        admin
          .from("subcontractor_users")
          .select("id, employee_id, user_id, role, active, created_at")
          .eq("tenant_id", portalUser.tenant_id)
          .eq("subcontractor_id", portalUser.subcontractor_id)
          .order("created_at"),
      ]);

    const firstError =
      subcontractorResult.error ||
      employeeResult.error ||
      jobsResult.error ||
      vehiclesResult.error ||
      employeesResult.error ||
      usersResult.error;

    if (firstError) {
      throw new Error(firstError.message);
    }

    if (!subcontractorResult.data || !employeeResult.data) {
      return NextResponse.json(
        { error: "Subcontractor portal record is incomplete." },
        { status: 403 }
      );
    }

    if (
      employeeResult.data.directly_employed !== true ||
      employeeResult.data.active !== true ||
      (employeeResult.data.employment_end_date &&
        employeeResult.data.employment_end_date < new Date().toISOString().slice(0, 10))
    ) {
      return NextResponse.json(
        { error: "Your employment record is not eligible for portal access." },
        { status: 403 }
      );
    }

    const userIds = Array.from(
      new Set(
        (usersResult.data ?? [])
          .map((row) => row.user_id)
          .filter((value): value is string => Boolean(value))
      )
    );

    let publicUsersById = new Map<string, { id: string; email: string | null }>();

    if (userIds.length > 0) {
      const { data: publicUsers, error: publicUsersError } = await admin
        .from("users")
        .select("id, email")
        .in("id", userIds);

      if (publicUsersError) {
        throw new Error(publicUsersError.message);
      }

      publicUsersById = new Map(
        (publicUsers ?? []).map((row) => [row.id, row])
      );
    }

    const employeesById = new Map(
      (employeesResult.data ?? []).map((employee) => [employee.id, employee])
    );

    const portalUsers = (usersResult.data ?? []).map((row) => ({
      ...row,
      email: row.user_id ? publicUsersById.get(row.user_id)?.email ?? null : null,
      employee: employeesById.get(row.employee_id) ?? null,
    }));

    return NextResponse.json({
      portalUser,
      subcontractor: subcontractorResult.data,
      employee: employeeResult.data,
      jobs: jobsResult.data ?? [],
      vehicles: vehiclesResult.data ?? [],
      employees: employeesResult.data ?? [],
      portalUsers,
    });
  } catch (error) {
    console.error("Subcontractor portal GET failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load subcontractor portal.",
      },
      { status: 500 }
    );
  }
}
