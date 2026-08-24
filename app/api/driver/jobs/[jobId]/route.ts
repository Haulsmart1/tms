import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import {
  driverErrorResponse,
  requireDriverSession,
} from "../../../../../lib/driver/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{
    jobId: string;
  }>;
};

export async function GET(
  _request: Request,
  context: RouteContext,
) {
  try {
    const { jobId } = await context.params;

    if (!UUID.test(jobId)) {
      return NextResponse.json(
        { error: "Job not found." },
        { status: 404 },
      );
    }

    const session = await requireDriverSession();
    const admin = createAdminClient();

    let jobQuery = admin
      .from("jobs")
      .select(
        "id,tenant_id,reference,customer_reference,external_reference,status,job_date,scheduled_date,priority,notes,pod_status,vehicle_id,completed_at,subcontractor_id",
      )
      .eq("id", jobId)
      .eq("tenant_id", session.tenantId)
      .eq("driver_id", session.driverId);

    if (session.subcontractorId) {
      jobQuery = jobQuery.eq(
        "subcontractor_id",
        session.subcontractorId,
      );
    }

    const {
      data: job,
      error: jobError,
    } = await jobQuery.maybeSingle();

    if (jobError) {
      throw new Error(jobError.message);
    }

    /*
     * 404 is deliberate for both a missing job and a job assigned
     * to another driver. Do not leak job existence across drivers.
     */
    if (!job) {
      return NextResponse.json(
        { error: "Job not found." },
        { status: 404 },
      );
    }

    const {
      data: stops,
      error: stopsError,
    } = await admin
      .from("job_stops")
      .select(
        "id,stop_order,type,address_line,city,postcode,planned_at,status,pod_status,recipient_name,collected_at,delivered_at,pod_notes,pod_updated_at",
      )
      .eq("tenant_id", session.tenantId)
      .eq("job_id", job.id)
      .order("stop_order", {
        ascending: true,
      });

    if (stopsError) {
      throw new Error(stopsError.message);
    }

    return NextResponse.json({
      portalType: session.portalType,
      job: {
        ...job,
        stops: stops ?? [],
      },
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