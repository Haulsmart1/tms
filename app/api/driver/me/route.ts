import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import {
  driverErrorResponse,
  requireDriverSession,
} from "../../../../lib/driver/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireDriverSession();
    const admin = createAdminClient();

    const jobsQuery = admin
      .from("jobs")
      .select(
        "id,reference,customer_reference,status,job_date,scheduled_date,priority,notes,pod_status,vehicle_id,completed_at",
      )
      .eq("tenant_id", session.tenantId)
      .eq("driver_id", session.driverId)
      .order("job_date", { ascending: false })
      .limit(100);

    if (session.subcontractorId) {
      jobsQuery.eq(
        "subcontractor_id",
        session.subcontractorId,
      );
    }

    const [driver, jobs, assignments] =
      await Promise.all([
        admin
          .from("drivers")
          .select("*")
          .eq("id", session.driverId)
          .eq("tenant_id", session.tenantId)
          .maybeSingle(),

        jobsQuery,

        admin
          .from("vehicle_assignments")
          .select(
            "id,vehicle_id,driver_id,assigned_from,assigned_to,active,notes",
          )
          .eq("tenant_id", session.tenantId)
          .eq("driver_id", session.driverId)
          .eq("active", true),
      ]);

    const error =
      driver.error ||
      jobs.error ||
      assignments.error;

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      portalType: session.portalType,
      driver: driver.data,
      jobs: jobs.data ?? [],
      vehicleAssignments:
        assignments.data ?? [],
    });
  } catch (error) {
    const response =
      driverErrorResponse(error);

    return NextResponse.json(
      { error: response.message },
      { status: response.status },
    );
  }
}