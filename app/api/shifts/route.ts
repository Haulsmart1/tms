import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../lib/api/server";
import { isUuid } from "../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../lib/jobs/officeAccess";
import { MAX_FUTURE_SKEW_MS } from "../../../lib/shifts/syncRules";
import { createAdminClient } from "../../../lib/supabase/admin";
import { rpcErrorResponse } from "../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OfficeStartBody = { tenantId?: unknown; driverId?: unknown; startedAt?: unknown; reason?: unknown };

/*
  The office starts a shift for a driver whose phone is unavailable. Hours
  only: shift_office_start opens no vehicle period, so the job gate still
  blocks stop completion until the driver later runs a walkaround check.
*/
export async function POST(request: NextRequest) {
  try {
    let body: OfficeStartBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
    const driverId = typeof body.driverId === "string" ? body.driverId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const startedAtRaw = typeof body.startedAt === "string" ? body.startedAt : "";

    if (!isUuid(tenantId) || !isUuid(driverId)) {
      return NextResponse.json({ error: "tenantId and driverId must be valid ids." }, { status: 400 });
    }
    if (reason.length < 3) {
      return NextResponse.json({ error: "Give a reason of at least 3 characters." }, { status: 400 });
    }

    const startedAtMs = Date.parse(startedAtRaw);
    if (!Number.isFinite(startedAtMs)) {
      return NextResponse.json({ error: "startedAt is not a valid date." }, { status: 400 });
    }
    if (startedAtMs > Date.now() + MAX_FUTURE_SKEW_MS) {
      return NextResponse.json({ error: "The start time is in the future." }, { status: 400 });
    }

    const userClient = await createApiSupabase();
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const admin = createAdminClient();
    await authorizeOfficeTenant(admin, user.id, tenantId);

    const { data: driver, error: driverError } = await admin
      .from("drivers")
      .select("id")
      .eq("id", driverId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (driverError) throw new Error(driverError.message);
    if (!driver) {
      return NextResponse.json({ error: "Driver not found." }, { status: 404 });
    }

    const startedAtIso = new Date(startedAtMs).toISOString();
    const { data, error } = await admin.rpc("shift_office_start", {
      p: {
        tenant_id: tenantId,
        driver_id: driverId,
        user_id: user.id,
        started_at: startedAtIso,
        reason,
      },
    });
    if (error) return rpcErrorResponse(error);

    return NextResponse.json({ shiftId: (data as { shift_id?: string } | null)?.shift_id ?? null });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });

    console.error("[shifts] office start failed", error);
    return NextResponse.json({ error: "Unable to start the shift." }, { status: 500 });
  }
}
