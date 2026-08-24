import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  validatePodPhotoContent,
  validatePodPhotoMetadata,
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

const POD_BUCKET = "pod-files";

type RouteContext = {
  params: Promise<{
    jobId: string;
    stopId: string;
  }>;
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
      .select("id,type")
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

    const formData =
      await request.formData();

    const file =
      formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error:
            "A POD photo is required.",
        },
        { status: 400 },
      );
    }

    const validation =
      validatePodPhotoMetadata({
        size: file.size,
        mimeType: file.type,
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

    const safeName =
      (file.name || "pod-photo")
        .replace(
          /[^a-zA-Z0-9.\-_]/g,
          "_",
        )
        .slice(0, 160);

    const storagePath =
      `${session.tenantId}/${jobId}/${stopId}/photos/` +
      `${Date.now()}-${randomUUID()}-${safeName}`;

    const fileBytes =
      new Uint8Array(
        await file.arrayBuffer(),
      );

    const contentValidation =
      validatePodPhotoContent({
        bytes: fileBytes,
        mimeType: file.type,
      });

    if (!contentValidation.ok) {
      return NextResponse.json(
        {
          error:
            contentValidation.message,
        },
        {
          status:
            contentValidation.status,
        },
      );
    }

    const bytes =
      Buffer.from(fileBytes);

    const {
      error: uploadError,
    } = await admin.storage
      .from(POD_BUCKET)
      .upload(
        storagePath,
        bytes,
        {
          upsert: false,
          contentType:
            file.type,
        },
      );

    if (uploadError) {
      throw new Error(
        uploadError.message,
      );
    }

    const {
      data: evidence,
      error: insertError,
    } = await admin
      .from("pod_evidence")
      .insert({
        tenant_id:
          session.tenantId,
        job_id: jobId,
        stop_id: stopId,
        evidence_type: "photo",
        storage_path:
          storagePath,
        original_filename:
          file.name || null,
        mime_type:
          file.type || null,
        file_size_bytes:
          file.size,
        created_by:
          session.userId,
      })
      .select(
        "id,stop_id,evidence_type,storage_path,original_filename,mime_type,file_size_bytes,created_at",
      )
      .single();

    if (insertError) {
      await admin.storage
        .from(POD_BUCKET)
        .remove([
          storagePath,
        ]);

      throw new Error(
        insertError.message,
      );
    }

    return NextResponse.json(
      {
        ok: true,
        evidence,
      },
      { status: 201 },
    );
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
