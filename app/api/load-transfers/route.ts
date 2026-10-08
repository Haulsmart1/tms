import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  ApiError,
  requireTenant,
} from "../../../lib/api/server";
import { TenantAccessError } from "../../../lib/auth/serverTenantAccess";
import {
  parseLoadTransferScanInput,
  resolveLoadTransferScans,
  type LoadTransferCandidateItem,
} from "../../../lib/driver/loadTransfer";
import { chunk } from "../../../lib/jobs/fetchPages";
import { isWorkableJobStatus } from "../../../lib/jobs/jobStatus";
import { authorizeOfficeTenant } from "../../../lib/jobs/officeAccess";
import { loadTransferRpcError } from "../../../lib/loadTransfers/rpcError";
import { serialOverlapLiteral } from "../../../lib/loadTransfers/serialFilter";
import { createAdminClient } from "../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LoadTransferRpcRow = {
  transfer_batch_id: string;
  transferred_item_count: number;
  affected_job_count: number;
  fully_moved_job_count: number;
  confirmed_at: string;
};

function mapTransferRpcError(
  error: {
    code?: string;
    message?: string;
    hint?: string;
  },
): ApiError {
  const result =
    loadTransferRpcError(error);

  if (result.log) {
    console.error(
      "Load transfer RPC error",
      error.code,
      error.message,
    );
  }

  return new ApiError(
    result.status,
    result.message,
  );
}

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
      await authorizeOfficeTenant(
        admin,
        user.id,
        tenantId,
      );
    } catch (error) {
      if (
        error instanceof TenantAccessError
        && error.status === 403
      ) {
        throw new ApiError(
          403,
          "Only office staff can transfer loads.",
        );
      }

      throw new ApiError(
        500,
        "Unable to verify tenant access.",
      );
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      throw new ApiError(
        400,
        "Invalid load transfer request.",
      );
    }

    let input;

    try {
      input =
        parseLoadTransferScanInput(body);
    } catch (error) {
      throw new ApiError(
        400,
        error instanceof Error
          ? error.message
          : "Invalid load transfer request.",
      );
    }

    /*
     * Fetch only job items that overlap the scanned values.
     * The domain resolver still performs exact normalized matching and
     * rejects unknown or ambiguous serials.
     */
    const candidates:
      LoadTransferCandidateItem[] = [];

    for (
      const scannedChunk of
      chunk(input.scannedValues, 100)
    ) {
      const {
        data,
        error,
      } = await admin
        .from("job_items")
        .select(
          "id,job_id,serial_numbers",
        )
        .eq("tenant_id", tenantId)
        // A quoted literal, not the array: postgrest-js
        // would join the values unquoted (review S-11).
        .overlaps(
          "serial_numbers",
          serialOverlapLiteral(scannedChunk),
        );

      if (error) {
        console.error(
          "Load transfer item lookup error",
          error.code,
          error.message,
        );

        throw new ApiError(
          500,
          "Unable to check scanned load items.",
        );
      }

      const rows =
        (data ?? []) as LoadTransferCandidateItem[];

      candidates.push(...rows);
    }

    /*
     * De-duplicate rows returned by overlapping chunks.
     */
    const uniqueCandidates = [
      ...new Map(
        candidates.map((item) => [
          item.id,
          item,
        ]),
      ).values(),
    ];

    const resolution =
      resolveLoadTransferScans(
        input.scannedValues,
        uniqueCandidates,
      );

    if (!resolution.ok) {
      const status =
        resolution.reason === "ambiguous"
        || resolution.reason === "duplicate"
          ? 409
          : 422;

      throw new ApiError(
        status,
        resolution.message,
      );
    }

    const jobIds = [
      ...new Set(
        resolution.items.map(
          (item) => item.jobId,
        ),
      ),
    ];

    const {
      data: jobs,
      error: jobsError,
    } = await admin
      .from("jobs")
      .select("id,reference,status")
      .eq("tenant_id", tenantId)
      .in("id", jobIds);

    if (jobsError) {
      throw new ApiError(
        500,
        "Unable to check transfer jobs.",
      );
    }

    if (
      (jobs ?? []).length
      !== jobIds.length
    ) {
      throw new ApiError(
        409,
        "One or more transfer jobs were not found in this tenant.",
      );
    }

    const closedJob =
      (jobs ?? []).find(
        (job) =>
          !isWorkableJobStatus(
            job.status,
          ),
      );

    if (closedJob) {
      throw new ApiError(
        409,
        `Job ${
          closedJob.reference
          ?? closedJob.id
        } is ${
          String(
            closedJob.status
            ?? "not open",
          ).replaceAll("_", " ")
        } and cannot be transferred.`,
      );
    }

    const {
      data,
      error,
    } = await admin.rpc(
      "create_and_confirm_load_transfer",
      {
        p_tenant_id: tenantId,
        p_source_vehicle_id:
          input.sourceVehicleId,
        p_destination_vehicle_id:
          input.destinationVehicleId,
        p_destination_driver_id:
          input.destinationDriverId,
        p_created_by: user.id,
        p_items:
          resolution.items.map(
            (item) => ({
              job_id: item.jobId,
              job_item_id:
                item.jobItemId,
              serial_number:
                item.serialNumber,
            }),
          ),
      },
    );

    if (error) {
      throw mapTransferRpcError(error);
    }

    const rows =
      (data ?? []) as LoadTransferRpcRow[];

    if (rows.length !== 1) {
      throw new ApiError(
        500,
        "Unable to transfer load.",
      );
    }

    const result = rows[0];

    return NextResponse.json(
      {
        ok: true,
        transfer: {
          id:
            result.transfer_batch_id,
          sourceVehicleId:
            input.sourceVehicleId,
          destinationVehicleId:
            input.destinationVehicleId,
          destinationDriverId:
            input.destinationDriverId,
          itemCount:
            Number(
              result.transferred_item_count,
            ),
          affectedJobCount:
            Number(
              result.affected_job_count,
            ),
          fullyMovedJobCount:
            Number(
              result.fully_moved_job_count,
            ),
          confirmedAt:
            result.confirmed_at,
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        {
          status: error.status,
        },
      );
    }

    console.error(
      "Load transfer API error",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to transfer load.",
      },
      {
        status: 500,
      },
    );
  }
}