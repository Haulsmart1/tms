import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  driverErrorResponse,
  requireDriverSession,
} from "../../../../../lib/driver/server";
import {
  manifestReference,
  parseLoadManifestScanBody,
} from "../../../../../lib/driver/loadManifest";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManifestRow = {
  id: string;
  manifest_number: number;
  vehicle_id: string;
  driver_id: string;
};

type ManifestItemRow = {
  job_id: string;
};

type JobAssignmentRow = {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  subcontractor_id: string | null;
};

type ScanRpcRow = {
  manifest_id: string;
  manifest_number: number;
  event_id: string;
  event_type: "loaded" | "unloaded";
  manifest_state: "loaded" | "unloaded";
  item_count: number;
  job_count: number;
  scanned_at: string;
};

function rpcErrorResponse(
  error: {
    code?: string;
    message?: string;
  },
) {
  const message =
    error.message
    || "Unable to record load manifest scan.";

  if (error.code === "22023") {
    return {
      status: 400,
      message,
    };
  }

  if (error.code === "42501") {
    return {
      status: 403,
      message,
    };
  }

  if (error.code === "P0002") {
    return {
      status: 404,
      message,
    };
  }

  if (
    error.code === "P0001"
    || error.code === "23514"
  ) {
    return {
      status: 409,
      message,
    };
  }

  return {
    status: 500,
    message:
      "Unable to record load manifest scan.",
  };
}

export async function POST(
  request: NextRequest,
) {
  try {
    const session =
      await requireDriverSession();

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error:
            "Invalid load manifest scan request.",
        },
        { status: 400 },
      );
    }

    let input;

    try {
      input =
        parseLoadManifestScanBody(body);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Invalid load manifest scan request.",
        },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    const {
      data: assignments,
      error: assignmentError,
    } = await admin
      .from("vehicle_assignments")
      .select("id,vehicle_id")
      .eq("tenant_id", session.tenantId)
      .eq("driver_id", session.driverId)
      .eq("active", true);

    if (assignmentError) {
      throw new Error(
        assignmentError.message,
      );
    }

    if (
      !assignments
      || assignments.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "No active vehicle is assigned to this driver.",
        },
        { status: 409 },
      );
    }

    if (assignments.length !== 1) {
      return NextResponse.json(
        {
          error:
            "Multiple active vehicles are assigned. The load scan cannot determine the correct vehicle.",
        },
        { status: 409 },
      );
    }

    const vehicleId =
      assignments[0].vehicle_id as string | null;

    if (!vehicleId) {
      return NextResponse.json(
        {
          error:
            "The active vehicle assignment is invalid.",
        },
        { status: 409 },
      );
    }

    const {
      data: manifest,
      error: manifestError,
    } = await admin
      .from("load_manifests")
      .select(
        "id,manifest_number,vehicle_id,driver_id",
      )
      .eq("tenant_id", session.tenantId)
      .eq(
        "barcode_token",
        input.barcodeToken,
      )
      .maybeSingle();

    if (manifestError) {
      throw new Error(
        manifestError.message,
      );
    }

    if (!manifest) {
      return NextResponse.json(
        {
          error:
            "Load manifest was not found.",
        },
        { status: 404 },
      );
    }

    const typedManifest =
      manifest as ManifestRow;

    if (
      typedManifest.driver_id
      !== session.driverId
    ) {
      return NextResponse.json(
        {
          error:
            "This load manifest is assigned to another driver.",
        },
        { status: 403 },
      );
    }

    if (
      typedManifest.vehicle_id
      !== vehicleId
    ) {
      return NextResponse.json(
        {
          error:
            "This load manifest is assigned to another vehicle.",
        },
        { status: 409 },
      );
    }

    const {
      data: manifestItems,
      error: itemsError,
    } = await admin
      .from("load_manifest_items")
      .select("job_id")
      .eq("tenant_id", session.tenantId)
      .eq(
        "manifest_id",
        typedManifest.id,
      );

    if (itemsError) {
      throw new Error(
        itemsError.message,
      );
    }

    const itemRows = (
      manifestItems ?? []
    ) as ManifestItemRow[];

    const jobIds = [
      ...new Set(
        itemRows.map(
          (item) => item.job_id,
        ),
      ),
    ];

    if (jobIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "This load manifest contains no jobs.",
        },
        { status: 409 },
      );
    }

    const {
      data: jobs,
      error: jobsError,
    } = await admin
      .from("jobs")
      .select(
        "id,vehicle_id,driver_id,subcontractor_id",
      )
      .eq("tenant_id", session.tenantId)
      .in("id", jobIds);

    if (jobsError) {
      throw new Error(
        jobsError.message,
      );
    }

    const jobRows = (
      jobs ?? []
    ) as JobAssignmentRow[];

    if (jobRows.length !== jobIds.length) {
      return NextResponse.json(
        {
          error:
            "One or more manifest jobs are no longer available.",
        },
        { status: 409 },
      );
    }

    const staleAssignment =
      jobRows.some((job) => {
        if (
          job.driver_id !== session.driverId
          || job.vehicle_id !== vehicleId
        ) {
          return true;
        }

        if (
          session.subcontractorId
          && job.subcontractor_id
            !== session.subcontractorId
        ) {
          return true;
        }

        return false;
      });

    if (staleAssignment) {
      return NextResponse.json(
        {
          error:
            "This load manifest is stale because one or more jobs have been reassigned. Create a new manifest before scanning.",
        },
        { status: 409 },
      );
    }

    const {
      data: scanData,
      error: scanError,
    } = await admin.rpc(
      "record_load_manifest_event",
      {
        p_tenant_id:
          session.tenantId,
        p_barcode_token:
          input.barcodeToken,
        p_driver_id:
          session.driverId,
        p_vehicle_id:
          vehicleId,
        p_scanned_by:
          session.userId,
        p_action:
          input.action,
        p_stop_id:
          null,
        p_latitude:
          input.latitude,
        p_longitude:
          input.longitude,
        p_accuracy_m:
          input.accuracyM,
      },
    );

    if (scanError) {
      const mapped =
        rpcErrorResponse(scanError);

      return NextResponse.json(
        { error: mapped.message },
        { status: mapped.status },
      );
    }

    const rows =
      (scanData ?? []) as ScanRpcRow[];

    if (rows.length !== 1) {
      throw new Error(
        "Manifest scan RPC returned an unexpected result.",
      );
    }

    const result = rows[0];

    return NextResponse.json({
      ok: true,
      manifest: {
        id: result.manifest_id,
        reference:
          manifestReference(
            Number(
              result.manifest_number,
            ),
          ),
        state:
          result.manifest_state,
        eventType:
          result.event_type,
        eventId:
          result.event_id,
        itemCount:
          Number(result.item_count),
        jobCount:
          Number(result.job_count),
        scannedAt:
          result.scanned_at,
        vehicleId,
      },
    });
  } catch (error) {
    const response =
      driverErrorResponse(error);

    if (response.status !== 500) {
      return NextResponse.json(
        { error: response.message },
        { status: response.status },
      );
    }

    console.error(
      "Load manifest scan API error",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to record load manifest scan.",
      },
      { status: 500 },
    );
  }
}
