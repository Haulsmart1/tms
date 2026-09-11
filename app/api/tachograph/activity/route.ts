import { NextResponse } from "next/server";
import {
  authClient,
  requireOperator,
} from "../../../../lib/tomtom/server";
import {
  requireTachographTenantAdmin,
} from "../../../../lib/tachograph/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActivityBody = {
  tenantId?: unknown;
  driverId?: unknown;
  activityId?: unknown;
  activityKind?: unknown;
  activityType?: unknown;
  startTime?: unknown;
  endTime?: unknown;
};

function stringOrNull(
  value: unknown
): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

export async function POST(request: Request) {
  try {
    const client = await authClient();
    const operator = await requireOperator(client);

    if (!operator) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    if (!operator.companyId) {
      return NextResponse.json(
        { error: "You do not have console access." },
        { status: 403 }
      );
    }

    const body =
      (await request.json().catch(() => null)) as
        | ActivityBody
        | null;

    const tenantId = stringOrNull(body?.tenantId);
    const driverId = stringOrNull(body?.driverId);
    const activityId = stringOrNull(body?.activityId);
    const activityKind = stringOrNull(body?.activityKind);
    const activityType = stringOrNull(body?.activityType);
    const startTime = stringOrNull(body?.startTime);
    const endTime = stringOrNull(body?.endTime);

    if (
      !tenantId ||
      !driverId ||
      !activityKind ||
      !startTime ||
      !endTime
    ) {
      return NextResponse.json(
        { error: "Missing required activity fields." },
        { status: 400 }
      );
    }

    try {
      await requireTachographTenantAdmin(
        operator.userId,
        tenantId
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "TACHOGRAPH_FORBIDDEN"
      ) {
        return NextResponse.json(
          {
            error:
              "Only a tenant administrator can manage driver activity.",
          },
          { status: 403 }
        );
      }

      throw error;
    }

    const { data, error } = await client.rpc(
      "upsert_manual_driver_activity",
      {
        p_tenant_id: tenantId,
        p_driver_id: driverId,
        p_activity_id: activityId,
        p_activity_kind: activityKind,
        p_activity_type:
          activityType ?? activityKind,
        p_start_time: startTime,
        p_end_time: endTime,
      }
    );

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      id: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save driver activity.",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const client = await authClient();
    const operator = await requireOperator(client);

    if (!operator) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    if (!operator.companyId) {
      return NextResponse.json(
        { error: "You do not have console access." },
        { status: 403 }
      );
    }

    const body =
      (await request.json().catch(() => null)) as
        | ActivityBody
        | null;

    const tenantId = stringOrNull(body?.tenantId);
    const activityId = stringOrNull(body?.activityId);

    if (!tenantId || !activityId) {
      return NextResponse.json(
        { error: "Missing activity id." },
        { status: 400 }
      );
    }

    try {
      await requireTachographTenantAdmin(
        operator.userId,
        tenantId
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "TACHOGRAPH_FORBIDDEN"
      ) {
        return NextResponse.json(
          {
            error:
              "Only a tenant administrator can manage driver activity.",
          },
          { status: 403 }
        );
      }

      throw error;
    }

    const { error } = await client.rpc(
      "delete_manual_driver_activity",
      {
        p_tenant_id: tenantId,
        p_activity_id: activityId,
      }
    );

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to delete driver activity.",
      },
      { status: 500 }
    );
  }
}
