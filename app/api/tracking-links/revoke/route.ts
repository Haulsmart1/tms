import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../../lib/api/server";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../../lib/jobs/officeAccess";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { TrackingUnavailableError, revokeTrackingLinks } from "../../../../lib/tracking/linkStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Withdraw every live tracking link for one stop. Office callers only; the
   update is filtered by the authorized tenant, so a stop id from another
   tenant revokes nothing. */
export async function POST(request: NextRequest) {
  try {
    let body: { tenantId?: unknown; stopId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
    const stopId = typeof body?.stopId === "string" ? body.stopId.trim() : "";
    if (!isUuid(tenantId) || !isUuid(stopId)) {
      return NextResponse.json({ error: "tenantId and stopId are required." }, { status: 400 });
    }

    const userClient = await createApiSupabase();
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const admin = createAdminClient();
    await authorizeOfficeTenant(admin, user.id, tenantId);

    const revoked = await revokeTrackingLinks(admin, { tenantId, stopId, revokedBy: user.id });
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });
    if (error instanceof TrackingUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("Unable to revoke tracking links:", error);
    return NextResponse.json({ error: "Unable to revoke tracking links." }, { status: 500 });
  }
}
