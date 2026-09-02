import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  ApiError,
  requireTenant,
} from "../../../lib/api/server";
import {
  manifestBarcodeValue,
  manifestReference,
  parseLoadManifestCreateBody,
} from "../../../lib/driver/loadManifest";
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

export async function POST(
  request: NextRequest,
) {
  try {
    const {
      supabase,
      tenantId,
    } = await requireTenant(request);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new ApiError(
        401,
        "You must be signed in.",
      );
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

    const admin = createAdminClient();

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
