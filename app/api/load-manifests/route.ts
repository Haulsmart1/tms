import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  ApiError,
  requireTenant,
} from "../../../lib/api/server";
import { TenantAccessError } from "../../../lib/auth/serverTenantAccess";
import { isUnlicensedVehicleError, unlicensedVehicleMessage } from "../../../lib/billing/unlicensedVehicle";
import { findOpenManifestConflicts } from "../../../lib/driver/manifestConflicts";
import {
  manifestBarcodeValue,
  manifestReference,
  parseLoadManifestCreateBody,
} from "../../../lib/driver/loadManifest";
import { chunk } from "../../../lib/jobs/fetchPages";
import { isWorkableJobStatus } from "../../../lib/jobs/jobStatus";
import { authorizeOfficeTenant } from "../../../lib/jobs/officeAccess";
import { createAdminClient } from "../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateManifestRpcRow = {
  manifest_id: string;
  manifest_number: number;
  barcode_token: string;
  item_count: number;
  job_count: number;
};

function mapCreateRpcError(
  error: {
    code?: string;
    message?: string;
  },
): ApiError {
  const message =
    error.message
    || "Unable to create load manifest.";

  if (error.code === "22023") {
    return new ApiError(400, message);
  }

  if (isUnlicensedVehicleError(error)) {
    return new ApiError(409, unlicensedVehicleMessage(error));
  }

  if (
    error.code === "23503"
    || error.code === "23505"
    || error.code === "23514"
  ) {
    return new ApiError(409, message);
  }

  return new ApiError(
    500,
    "Unable to create load manifest.",
  );
}

/*
  Create a multi-job load manifest (review POD-19):
  - office callers only (drivers refused),
  - every job must still be open for work,
  - a serial already on another open manifest is refused.
*/
export async function POST(
  request: NextRequest,
) {
  try {
    const {
      tenantId,
      user,
    } = await requireTenant(request);

    const admin = createAdminClient();

    try {
      await authorizeOfficeTenant(admin, user.id, tenantId);
    } catch (error) {
      if (error instanceof TenantAccessError && error.status === 403) {
        throw new ApiError(403, "Only office staff can create load manifests.");
      }
      throw new ApiError(500, "Unable to verify tenant access.");
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new ApiError(
        400,
        "Invalid load manifest request.",
      );
    }

    let input;

    try {
      input =
        parseLoadManifestCreateBody(body);
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error
          ? error.message
          : "Invalid load manifest request.",
      );
    }

    const jobIds = [...new Set(input.items.map((item) => item.jobId))];

    const { data: jobs, error: jobsError } = await admin
      .from("jobs")
      .select("id,reference,status")
      .eq("tenant_id", tenantId)
      .in("id", jobIds);

    if (jobsError) {
      throw new ApiError(500, "Unable to check manifest jobs.");
    }

    if ((jobs ?? []).length !== jobIds.length) {
      throw new ApiError(409, "One or more jobs on this manifest were not found in this tenant.");
    }

    const closedJob = (jobs ?? []).find((job) => !isWorkableJobStatus(job.status));

    if (closedJob) {
      throw new ApiError(
        409,
        `Job ${closedJob.reference ?? closedJob.id} is ${String(closedJob.status ?? "not open").replaceAll("_", " ")} and cannot go on a load manifest.`,
      );
    }

    const itemIds = [...new Set(input.items.map((item) => item.jobItemId))];
    const existing: Array<{ manifest_id: string; job_item_id: string; serial_number: string }> = [];

    for (const ids of chunk(itemIds, 200)) {
      const { data, error } = await admin
        .from("load_manifest_items")
        .select("manifest_id,job_item_id,serial_number")
        .eq("tenant_id", tenantId)
        .in("job_item_id", ids);

      if (error) {
        throw new ApiError(500, "Unable to check existing load manifests.");
      }

      existing.push(...(data ?? []));
    }

    const events: Array<{ manifest_id: string; event_type: string; scanned_at: string }> = [];
    const manifestIds = [...new Set(existing.map((row) => row.manifest_id))];

    for (const ids of chunk(manifestIds, 200)) {
      const { data, error } = await admin
        .from("load_scan_events")
        .select("manifest_id,event_type,scanned_at")
        .eq("tenant_id", tenantId)
        .in("manifest_id", ids);

      if (error) {
        throw new ApiError(500, "Unable to check existing load manifests.");
      }

      events.push(...(data ?? []));
    }

    const conflicts = findOpenManifestConflicts({
      requested: input.items.map((item) => ({ jobItemId: item.jobItemId, serialNumber: item.serialNumber })),
      existing,
      events,
    });

    if (conflicts.length > 0) {
      const serials = conflicts.slice(0, 5).map((item) => item.serialNumber).join(", ");
      throw new ApiError(
        409,
        `Already on an open load manifest: ${serials}${conflicts.length > 5 ? ` and ${conflicts.length - 5} more` : ""}.`,
      );
    }

    const {
      data,
      error,
    } = await admin.rpc(
      "create_load_manifest",
      {
        p_tenant_id: tenantId,
        p_vehicle_id: input.vehicleId,
        p_driver_id: input.driverId,
        p_created_by: user.id,
        p_items: input.items.map((item) => ({
          job_id: item.jobId,
          job_item_id: item.jobItemId,
          serial_number: item.serialNumber,
        })),
      },
    );

    if (error) {
      throw mapCreateRpcError(error);
    }

    const rows =
      (data ?? []) as CreateManifestRpcRow[];

    if (rows.length !== 1) {
      throw new ApiError(
        500,
        "Unable to create load manifest.",
      );
    }

    const manifest = rows[0];

    return NextResponse.json(
      {
        ok: true,
        manifest: {
          id: manifest.manifest_id,
          reference:
            manifestReference(
              Number(manifest.manifest_number),
            ),
          barcode:
            manifestBarcodeValue(
              manifest.barcode_token,
            ),
          itemCount:
            Number(manifest.item_count),
          jobCount:
            Number(manifest.job_count),
          vehicleId: input.vehicleId,
          driverId: input.driverId,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    console.error(
      "Load manifest creation API error",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to create load manifest.",
      },
      { status: 500 },
    );
  }
}
