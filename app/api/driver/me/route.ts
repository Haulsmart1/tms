import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase public env vars.");

  const store = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) =>
            store.set(name, value, options)
          );
        } catch {}
      },
    },
  });
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server env vars.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function loadDriverBundle(
  admin: ReturnType<typeof adminClient>,
  tenantId: string,
  driverId: string,
  subcontractorId?: string
) {
  const jobsQuery = admin
    .from("jobs")
    .select(
      "id,reference,customer_reference,status,job_date,scheduled_date,priority,notes,pod_status,vehicle_id,completed_at"
    )
    .eq("tenant_id", tenantId)
    .eq("driver_id", driverId)
    .order("job_date", { ascending: false })
    .limit(100);

  if (subcontractorId) {
    jobsQuery.eq("subcontractor_id", subcontractorId);
  }

  const [driver, jobs, assignments] = await Promise.all([
    admin
      .from("drivers")
      .select("*")
      .eq("id", driverId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    jobsQuery,
    admin
      .from("vehicle_assignments")
      .select("id,vehicle_id,driver_id,assigned_from,assigned_to,active,notes")
      .eq("tenant_id", tenantId)
      .eq("driver_id", driverId)
      .eq("active", true),
  ]);

  const error = driver.error || jobs.error || assignments.error;
  if (error) throw new Error(error.message);

  return {
    driver: driver.data,
    jobs: jobs.data ?? [],
    vehicleAssignments: assignments.data ?? [],
  };
}

export async function GET() {
  try {
    const client = await authClient();

    const {
      data: { user },
      error,
    } = await client.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const admin = adminClient();

    const { data: direct, error: directError } = await admin
      .from("driver_users")
      .select("tenant_id,driver_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (directError) throw new Error(directError.message);

    if (direct) {
      return NextResponse.json({
        portalType: "direct_driver",
        ...(await loadDriverBundle(admin, direct.tenant_id, direct.driver_id)),
      });
    }

    const { data: portalUser, error: portalError } = await admin
      .from("subcontractor_users")
      .select("tenant_id,subcontractor_id,employee_id")
      .eq("user_id", user.id)
      .eq("role", "driver")
      .eq("active", true)
      .maybeSingle();

    if (portalError) throw new Error(portalError.message);
    if (!portalUser) {
      return NextResponse.json(
        { error: "No active driver portal access was found." },
        { status: 403 }
      );
    }

    const { data: link, error: linkError } = await admin
      .from("subcontractor_drivers")
      .select("driver_id")
      .eq("tenant_id", portalUser.tenant_id)
      .eq("subcontractor_id", portalUser.subcontractor_id)
      .eq("employee_id", portalUser.employee_id)
      .eq("active", true)
      .maybeSingle();

    if (linkError) throw new Error(linkError.message);
    if (!link?.driver_id) {
      return NextResponse.json(
        { error: "Subcontractor employee is not linked to a driver record yet." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      portalType: "subcontractor_driver",
      ...(await loadDriverBundle(
        admin,
        portalUser.tenant_id,
        link.driver_id,
        portalUser.subcontractor_id
      )),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to load driver dashboard.",
      },
      { status: 500 }
    );
  }
}
