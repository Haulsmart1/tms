
import { NextResponse } from "next/server";
import {
  findExpectedSerial,
  normalizeScannedSerial,
} from "../../../../../../../../lib/driver/barcode";
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

type ScanBody = {
  serial_number?: unknown;
  scan_format?: unknown;
};

function normalizeScanFormat(
  value: unknown,
):
  | {
      ok: true;
      value: string | null;
    }
  | {
      ok: false;
      message: string;
    } {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return {
      ok: true,
      value: null,
    };
  }

  if (typeof value !== "string") {
    return {
      ok: false,
      message: "Invalid barcode format.",
    };
  }

  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return {
      ok: false,
      message: "Invalid barcode format.",
    };
  }

  return {
    ok: true,
    value: normalized,
  };
}

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

    let body: ScanBody;

    try {
      body =
        (await request.json()) as ScanBody;
    } catch {
      return NextResponse.json(
        {
          error:
            "Invalid request body.",
        },
        { status: 400 },
      );
    }

    const serial =
      normalizeScannedSerial(
        body.serial_number,
      );

    if (!serial.ok) {
      return NextResponse.json(
        {
          error:
            serial.message,
        },
        { status: 400 },
      );
    }

    const scanFormat =
      normalizeScanFormat(
        body.scan_format,
      );

    if (!scanFormat.ok) {
      return NextResponse.json(
        {
          error:
            scanFormat.message,
        },
        { status: 400 },
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
      .select("id")
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

    if (!stop) {
      return NextResponse.json(
        {
          error:
            "Job stop not found.",
        },
        { status: 404 },
      );
    }

    const {
      data: items,
      error: itemsError,
    } = await admin
      .from("job_items")
      .select(
        "id,serial_numbers",
      )
      .eq(
        "tenant_id",
        session.tenantId,
      )
      .eq(
        "job_id",
        jobId,
      );

    if (itemsError) {
      throw new Error(
        itemsError.message,
      );
    }

    const match =
      findExpectedSerial(
        items ?? [],
        serial.value,
      );

    if (!match.ok) {
      const status =
        match.reason === "ambiguous"
          ? 409
          : match.reason === "unknown"
            ? 422
            : 400;

      return NextResponse.json(
        {
          error:
            match.message,
          code:
            match.reason,
        },
        { status },
      );
    }

    const {
      data: existing,
      error: existingError,
    } = await admin
      .from("job_item_scans")
      .select(
        "id,stop_id,job_item_id,serial_number,scan_format,scanned_by,scanned_at",
      )
      .eq(
        "tenant_id",
        session.tenantId,
      )
      .eq(
        "job_id",
        jobId,
      )
      .eq(
        "job_item_id",
        match.itemId,
      )
      .eq(
        "serial_number",
        match.serialNumber,
      )
      .maybeSingle();

    if (existingError) {
      throw new Error(
        existingError.message,
      );
    }

    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        message:
          "This item has already been verified on this job.",
        scan: existing,
      });
    }

    const {
      data: inserted,
      error: insertError,
    } = await admin
      .from("job_item_scans")
      .insert({
        tenant_id:
          session.tenantId,
        job_id:
          jobId,
        stop_id:
          stopId,
        job_item_id:
          match.itemId,
        serial_number:
          match.serialNumber,
        scan_format:
          scanFormat.value,
        scanned_by:
          session.userId,
      })
      .select(
        "id,stop_id,job_item_id,serial_number,scan_format,scanned_by,scanned_at",
      )
      .single();

    if (insertError) {
      if (
        insertError.code ===
        "23505"
      ) {
        const {
          data: duplicate,
          error: duplicateError,
        } = await admin
          .from("job_item_scans")
          .select(
            "id,stop_id,job_item_id,serial_number,scan_format,scanned_by,scanned_at",
          )
          .eq(
            "tenant_id",
            session.tenantId,
          )
          .eq(
            "job_id",
            jobId,
          )
          .eq(
            "job_item_id",
            match.itemId,
          )
          .eq(
            "serial_number",
            match.serialNumber,
          )
          .maybeSingle();

        if (duplicateError) {
          throw new Error(
            duplicateError.message,
          );
        }

        return NextResponse.json({
          ok: true,
          duplicate: true,
          message:
            "This item has already been verified on this job.",
          scan: duplicate,
        });
      }

      throw new Error(
        insertError.message,
      );
    }

    return NextResponse.json(
      {
        ok: true,
        duplicate: false,
        message:
          "Item verified.",
        scan:
          inserted,
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
