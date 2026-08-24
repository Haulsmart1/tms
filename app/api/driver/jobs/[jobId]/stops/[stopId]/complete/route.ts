import { NextResponse } from "next/server";
import {
  areAllDeliveryStopsDelivered,
  validatePodCompletion,
} from "../../../../../../../../lib/driver/pod";
import {
  driverErrorResponse,
  requireDriverSession,
} from "../../../../../../../../lib/driver/server";
import { createAdminClient } from "../../../../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{
    jobId: string;
    stopId: string;
  }>;
};

type CompleteBody = {
  recipient_name?: unknown;
  pod_notes?: unknown;
};

export async function POST(
  request: Request,
  context: RouteContext,
) {
  try {
    const {
      jobId,
      stopId,
    } = await context.params;

    if (
      !UUID.test(jobId) ||
      !UUID.test(stopId)
    ) {
      return NextResponse.json(
        {
          error:
            "Job stop not found.",
        },
        { status: 404 },
      );
    }

    const session =
      await requireDriverSession();

    const admin =
      createAdminClient();

    let jobQuery = admin
      .from("jobs")
      .select(
        "id,subcontractor_id",
      )
      .eq("id", jobId)
      .eq(
        "tenant_id",
        session.tenantId,
      )
      .eq(
        "driver_id",
        session.driverId,
      );

    if (session.subcontractorId) {
      jobQuery = jobQuery.eq(
        "subcontractor_id",
        session.subcontractorId,
      );
    }

    const {
      data: job,
      error: jobError,
    } =
      await jobQuery.maybeSingle();

    if (jobError) {
      throw new Error(
        jobError.message,
      );
    }

    if (!job) {
      return NextResponse.json(
        {
          error:
            "Job stop not found.",
        },
        { status: 404 },
      );
    }

    const {
      data: stop,
      error: stopError,
    } = await admin
      .from("job_stops")
      .select(
        "id,type,pod_status,pod_photo_url,delivered_at",
      )
      .eq("id", stopId)
      .eq("job_id", jobId)
      .eq(
        "tenant_id",
        session.tenantId,
      )
      .maybeSingle();

    if (stopError) {
      throw new Error(
        stopError.message,
      );
    }

    if (
      !stop ||
      stop.type !== "delivery"
    ) {
      return NextResponse.json(
        {
          error:
            "Delivery stop not found.",
        },
        { status: 404 },
      );
    }

    const alreadyCompleted =
      stop.pod_status ===
      "delivered";

    let completedAt =
      stop.delivered_at ??
      new Date().toISOString();

    if (!alreadyCompleted) {
      let body: CompleteBody;

      try {
        body =
          (await request.json()) as CompleteBody;
      } catch {
        return NextResponse.json(
          {
            error:
              "Invalid request body.",
          },
          { status: 400 },
        );
      }

      const {
        count: evidenceCount,
        error: evidenceError,
      } = await admin
        .from("pod_evidence")
        .select(
          "id",
          {
            count: "exact",
            head: true,
          },
        )
        .eq(
          "tenant_id",
          session.tenantId,
        )
        .eq("job_id", jobId)
        .eq("stop_id", stopId);

      if (evidenceError) {
        throw new Error(
          evidenceError.message,
        );
      }

      const validation =
        validatePodCompletion({
          recipientName:
            body.recipient_name,
          podNotes:
            body.pod_notes,
          evidenceCount:
            evidenceCount ?? 0,
          legacyPhotoUrl:
            stop.pod_photo_url,
        });

      if (!validation.ok) {
        return NextResponse.json(
          {
            error:
              validation.message,
          },
          {
            status:
              validation.status,
          },
        );
      }

      completedAt =
        new Date().toISOString();

      const {
        error: updateStopError,
      } = await admin
        .from("job_stops")
        .update({
          recipient_name:
            validation.recipientName,
          pod_notes:
            validation.podNotes,
          delivered_at:
            completedAt,
          pod_updated_at:
            completedAt,
          pod_status:
            "delivered",
          status:
            "completed",
        })
        .eq("id", stopId)
        .eq("job_id", jobId)
        .eq(
          "tenant_id",
          session.tenantId,
        );

      if (updateStopError) {
        throw new Error(
          updateStopError.message,
        );
      }
    }
    const {
      data: deliveryStops,
      error: deliveryStopsError,
    } = await admin
      .from("job_stops")
      .select(
        "id,pod_status,delivered_at",
      )
      .eq(
        "tenant_id",
        session.tenantId,
      )
      .eq("job_id", jobId)
      .eq(
        "type",
        "delivery",
      );

    if (deliveryStopsError) {
      throw new Error(
        deliveryStopsError.message,
      );
    }

    const allDelivered =
      areAllDeliveryStopsDelivered(
        deliveryStops ?? [],
      );

    const deliveryTimes =
      (deliveryStops ?? [])
        .map(
          (deliveryStop) =>
            deliveryStop.delivered_at,
        )
        .filter(
          (
            value,
          ): value is string =>
            typeof value === "string" &&
            value.length > 0,
        )
        .map((value) => ({
          value,
          timestamp:
            Date.parse(value),
        }))
        .filter(
          (item) =>
            !Number.isNaN(
              item.timestamp,
            ),
        )
        .sort(
          (left, right) =>
            left.timestamp -
            right.timestamp,
        );

    const jobCompletedAt =
      deliveryTimes.at(-1)?.value ??
      completedAt;

    if (allDelivered) {
      let updateJob = admin
        .from("jobs")
        .update({
          status: "completed",
          pod_status:
            "delivered",
          completed_at:
            jobCompletedAt,
        })
        .eq("id", jobId)
        .eq(
          "tenant_id",
          session.tenantId,
        )
        .eq(
          "driver_id",
          session.driverId,
        );

      if (session.subcontractorId) {
        updateJob = updateJob.eq(
          "subcontractor_id",
          session.subcontractorId,
        );
      }

      const {
        error: updateJobError,
      } = await updateJob;

      if (updateJobError) {
        throw new Error(
          updateJobError.message,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      alreadyCompleted,
      completedAt,
      jobCompleted:
        allDelivered,
    });
  } catch (error) {
    const response =
      driverErrorResponse(error);

    return NextResponse.json(
      {
        error:
          response.message,
      },
      {
        status:
          response.status,
      },
    );
  }
}
