import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import {
  driverErrorResponse,
  requireDriverSession,
} from "../../../../lib/driver/server";
import { operatorDayInTimeZone } from "../../../../lib/time";
import { loadOperatorTimeZone } from "../../../../lib/driver/operatorTimeZone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB_SELECT =
  "id,reference,customer_reference,status,job_date,scheduled_date,planning_date,priority,notes,pod_status,vehicle_id,route_order,completed_at";

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
      // An explicit planning date supersedes both source dates.
      .or(`planning_date.eq.${today},and(planning_date.is.null,scheduled_date.eq.${today}),and(planning_date.is.null,scheduled_date.is.null,job_date.eq.${today})`)
      .order("route_order", { ascending: true, nullsFirst: false })
      .order("reference", { ascending: true })
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
