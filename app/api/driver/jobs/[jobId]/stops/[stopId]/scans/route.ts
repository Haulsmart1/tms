import { NextResponse } from "next/server";
import { isUuid } from "../../../../../../../../lib/auth/serverTenantAccess";
import {
  findExpectedSerial,
  normalizeScanFormat,
  normalizeScannedSerial,
} from "../../../../../../../../lib/driver/barcode";
import { loadDriverJobStop } from "../../../../../../../../lib/driver/jobAccess";
import { driverErrorResponse, requireDriverSession } from "../../../../../../../../lib/driver/server";
import { isWorkableJobStatus, jobNotWorkableMessage } from "../../../../../../../../lib/jobs/jobStatus";
import { createAdminClient } from "../../../../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string; stopId: string }> };

type ScanBody = {
  serial_number?: unknown;
  scan_format?: unknown;
};

const SCAN_SELECT = "id,stop_id,job_item_id,serial_number,scan_format,scanned_by,scanned_at";

/*
  Record a barcode verification. Scan model (review POD-20, see
  lib/driver/completionRules.ts): verification is job-wide, a serial counts
  once per job, and a scan is taken at a delivery stop that is not yet
  complete, on a job that is still open (review POD-12).
*/
export async function POST(request: Request, context: RouteContext) {
  try {
    const { jobId, stopId } = await context.params;

    if (!isUuid(jobId) || !isUuid(stopId)) {
      return NextResponse.json({ error: "Job stop not found." }, { status: 404 });
    }

    let body: ScanBody;

    try {
      body = (await request.json()) as ScanBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const serial = normalizeScannedSerial(body.serial_number);

    if (!serial.ok) {
      return NextResponse.json({ error: serial.message }, { status: 400 });
    }

    const scanFormat = normalizeScanFormat(body.scan_format);

    if (!scanFormat.ok) {
      return NextResponse.json({ error: scanFormat.message }, { status: 400 });
    }

    const session = await requireDriverSession({ jobId });
    const admin = createAdminClient();
    const loaded = await loadDriverJobStop(admin, session, jobId, stopId);

    if (!loaded) {
      return NextResponse.json({ error: "Job stop not found." }, { status: 404 });
    }

    if (loaded.stop.type !== "delivery") {
      return NextResponse.json(
        { error: "Barcode verification is recorded at delivery stops." },
        { status: 409 },
      );
    }

    const { data: items, error: itemsError } = await admin
      .from("job_items")
      .select("id,serial_numbers")
      .eq("tenant_id", session.tenantId)
      .eq("job_id", jobId);

    if (itemsError) throw new Error(itemsError.message);

    const match = findExpectedSerial(items ?? [], serial.value);

    if (!match.ok) {
      const status = match.reason === "ambiguous" ? 409 : match.reason === "unknown" ? 422 : 400;
      return NextResponse.json({ error: match.message, code: match.reason }, { status });
    }

    const findExisting = () =>
      admin
        .from("job_item_scans")
        .select(SCAN_SELECT)
        .eq("tenant_id", session.tenantId)
        .eq("job_id", jobId)
        .eq("job_item_id", match.itemId)
        .eq("serial_number", match.serialNumber)
        .maybeSingle();

    const { data: existing, error: existingError } = await findExisting();

    if (existingError) throw new Error(existingError.message);

    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        message: "This item has already been verified on this job.",
        scan: existing,
      });
    }

    // A saved job-wide verification remains an acknowledged no-op after
    // dispatch or another device completes the stop. Its original reply may
    // have been lost while the phone still holds the scan in its offline
    // queue. Ownership, delivery type and expected serial are checked above;
    // only an absent verification reaches these new-write gates.
    if (!isWorkableJobStatus(loaded.job.status)) {
      return NextResponse.json({ error: jobNotWorkableMessage(loaded.job.status) }, { status: 409 });
    }

    if (loaded.stop.pod_status === "delivered") {
      return NextResponse.json(
        { error: "This delivery is already complete." },
        { status: 409 },
      );
    }

    const { data: inserted, error: insertError } = await admin
      .from("job_item_scans")
      .insert({
        tenant_id: session.tenantId,
        job_id: jobId,
        stop_id: stopId,
        job_item_id: match.itemId,
        serial_number: match.serialNumber,
        scan_format: scanFormat.value,
        scanned_by: session.userId,
      })
      .select(SCAN_SELECT)
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: duplicate, error: duplicateError } = await findExisting();

        if (duplicateError) throw new Error(duplicateError.message);

        // A unique conflict alone does not prove this authorized scan was
        // saved. A 2xx would delete its offline queue item even when the
        // scoped read cannot confirm a persisted row. Hold for reconciliation.
        if (!duplicate) {
          return NextResponse.json(
            { error: "The barcode scan could not be confirmed. Tell the office before retrying." },
            { status: 409 },
          );
        }

        return NextResponse.json({
          ok: true,
          duplicate: true,
          message: "This item has already been verified on this job.",
          scan: duplicate,
        });
      }

      throw new Error(insertError.message);
    }

    return NextResponse.json(
      { ok: true, duplicate: false, message: "Item verified.", scan: inserted },
      { status: 201 },
    );
  } catch (error) {
    const response = driverErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
