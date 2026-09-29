import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../../../lib/api/server";
import { isUuid } from "../../../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../../../lib/jobs/officeAccess";
import { MAX_FUTURE_SKEW_MS } from "../../../../../lib/shifts/syncRules";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { rpcErrorResponse } from "../../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type CorrectionBody = { field?: unknown; value?: unknown; reason?: unknown };
const CORRECTABLE_FIELDS = new Set(["started_at", "ended_at"]);

/*
  An office correction to a shift's recorded start or end, with a
  shift_corrections audit row. The route validates before the rpc runs so a
  bad request is a 400, not a database refusal; shift_apply_correction still
  re-checks under the driver's advisory lock (review SHF-6).
*/
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    let body: CorrectionBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const field = typeof body.field === "string" ? body.field : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const valueRaw = typeof body.value === "string" ? body.value : "";

    if (!CORRECTABLE_FIELDS.has(field)) {
      return NextResponse.json({ error: "Only the start or end of a shift can be corrected." }, { status: 400 });
    }
    if (reason.length < 3) {
      return NextResponse.json({ error: "Give a reason of at least 3 characters." }, { status: 400 });
    }

    const valueMs = Date.parse(valueRaw);
    if (!Number.isFinite(valueMs)) {
      return NextResponse.json({ error: "value is not a valid date." }, { status: 400 });
    }
    if (valueMs > Date.now() + MAX_FUTURE_SKEW_MS) {
      return NextResponse.json({ error: "The corrected time is in the future." }, { status: 400 });
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
    const { data: shift, error: shiftError } = await admin
      .from("driver_shifts")
      .select("id,tenant_id,started_at,ended_at")
      .eq("id", id)
      .maybeSingle();
    if (shiftError) throw new Error(shiftError.message);
    if (!shift) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    await authorizeOfficeTenant(admin, user.id, String(shift.tenant_id));

    const startedAtMs = Date.parse(String(shift.started_at));
    const endedAtMs = shift.ended_at ? Date.parse(String(shift.ended_at)) : null;

    if (field === "started_at") {
      if (endedAtMs !== null && valueMs > endedAtMs) {
        return NextResponse.json({ error: "The start cannot be after the end of the shift." }, { status: 400 });
      }
    } else {
      if (valueMs < startedAtMs) {
        return NextResponse.json({ error: "The end cannot be before the start of the shift." }, { status: 400 });
      }
    }

    const { error } = await admin.rpc("shift_apply_correction", {
      p: {
        tenant_id: shift.tenant_id,
        shift_id: shift.id,
        user_id: user.id,
        field,
        value: new Date(valueMs).toISOString(),
        reason,
      },
    });
    if (error) return rpcErrorResponse(error);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });

    console.error("[shifts] correction failed", error);
    return NextResponse.json({ error: "Unable to save the correction." }, { status: 500 });
  }
}
