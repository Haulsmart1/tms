import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import {
  driverErrorResponse,
  requireDriverSession,
} from "../../../../lib/driver/server";
import {
  OPERATOR_TIME_ZONE,
  isValidIanaTimeZone,
  operatorDayInTimeZone,
} from "../../../../lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB_SELECT =
  "id,reference,customer_reference,status,job_date,scheduled_date,priority,notes,pod_status,vehicle_id,route_order,completed_at";

/*
  Driver dashboard data. "Today" is the operator's calendar day in the
  company's own time zone, worked out here, and today's jobs are filtered on
  the server (review POD-21): a UTC day showed yesterday's jobs between
  midnight and 01:00 during BST, and filtering the 100 most recent jobs on the
  client could miss today's work entirely.
*/
export async function GET() {
  try {
    const session = await requireDriverSession();
    const admin = createAdminClient();

    const timeZone = await loadOperatorTimeZone(admin, session.tenantId);
    const today = operatorDayInTimeZone(new Date(), timeZone);

    const recentJobsQuery = admin
      .from("jobs")
      .select(JOB_SELECT)
      .eq("tenant_id", session.tenantId)
      .eq("driver_id", session.driverId)
      .order("job_date", { ascending: false })
      .limit(100);

    const todayJobsQuery = admin
      .from("jobs")
      .select(JOB_SELECT)
      .eq("tenant_id", session.tenantId)
      .eq("driver_id", session.driverId)
      .or(`scheduled_date.eq.${today},and(scheduled_date.is.null,job_date.eq.${today})`)
      .limit(500);

    if (session.subcontractorId) {
      recentJobsQuery.eq("subcontractor_id", session.subcontractorId);
      todayJobsQuery.eq("subcontractor_id", session.subcontractorId);
    }

    const [driver, jobs, todayJobs, assignments] = await Promise.all([
      admin
        .from("drivers")
        .select("*")
        .eq("id", session.driverId)
        .eq("tenant_id", session.tenantId)
        .maybeSingle(),

      recentJobsQuery,

      todayJobsQuery,

      admin
        .from("vehicle_assignments")
        .select("id,vehicle_id,driver_id,assigned_from,assigned_to,active,notes")
        .eq("tenant_id", session.tenantId)
        .eq("driver_id", session.driverId)
        .eq("active", true),
    ]);

    const error = driver.error || jobs.error || todayJobs.error || assignments.error;

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      portalType: session.portalType,
      driver: driver.data,
      jobs: jobs.data ?? [],
      today,
      timeZone,
      todayJobs: todayJobs.data ?? [],
      vehicleAssignments: assignments.data ?? [],
    });
  } catch (error) {
    const response = driverErrorResponse(error);

    return NextResponse.json(
      { error: response.message },
      { status: response.status },
    );
  }
}

async function loadOperatorTimeZone(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<string> {
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("company_id")
    .eq("id", tenantId)
    .maybeSingle();

  if (tenantError || !tenant?.company_id) {
    return OPERATOR_TIME_ZONE;
  }

  // company_profiles is keyed by the COMPANY id in its tenant_id column.
  const { data: profile, error: profileError } = await admin
    .from("company_profiles")
    .select("timezone")
    .eq("tenant_id", tenant.company_id)
    .maybeSingle();

  if (profileError) {
    console.warn("[driver-me] company time zone lookup failed", profileError.code);
    return OPERATOR_TIME_ZONE;
  }

  const candidate = typeof profile?.timezone === "string" ? profile.timezone.trim() : "";

  return candidate && isValidIanaTimeZone(candidate) ? candidate : OPERATOR_TIME_ZONE;
}
