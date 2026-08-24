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
        "id,stop_order,type,address_line,city,postcode,planned_at,status,pod_status,recipient_name,collected_at,delivered_at,pod_notes,pod_updated_at,pod_photo_url",
      )
      .eq("tenant_id", session.tenantId)
      .eq("job_id", job.id)
      .order("stop_order", {
        ascending: true,
      });

    if (stopsError) {
      throw new Error(stopsError.message);
    }

    const {
      data: evidence,
      error: evidenceError,
    } = await admin
      .from("pod_evidence")
      .select(
        "id,stop_id,evidence_type,storage_path,original_filename,mime_type,file_size_bytes,created_at",
      )
      .eq("tenant_id", session.tenantId)
      .eq("job_id", job.id)
      .order("created_at", {
        ascending: false,
      });

    if (evidenceError) {
      throw new Error(evidenceError.message);
    }

    const evidenceByStop =
      new Map<string, typeof evidence>();

    for (const item of evidence ?? []) {
      const current =
        evidenceByStop.get(item.stop_id) ?? [];

      current.push(item);
      evidenceByStop.set(
        item.stop_id,
        current,
      );
    }

    return NextResponse.json({
      portalType: session.portalType,
      job: {
        ...job,
        stops: (stops ?? []).map(
          (stop) => ({
            ...stop,
            evidence:
              evidenceByStop.get(stop.id) ??
              [],
          }),
        ),
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
