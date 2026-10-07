import { NextRequest, NextResponse } from "next/server";
import { publicAppOrigin } from "../../../lib/accounts/appUrl";
import { createApiSupabase } from "../../../lib/api/server";
import { isUuid } from "../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../lib/jobs/officeAccess";
import { createAdminClient } from "../../../lib/supabase/admin";
import { TrackableStopError, TrackingUnavailableError, issueTrackingLink, loadTrackableStop } from "../../../lib/tracking/linkStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Mint a customer tracking link for one delivery stop. Office callers only:
  tenant access decided from profiles, drivers refused. The link is an opaque
  stored token (lib/tracking/linkStore.ts) revocable through
  /api/tracking-links/revoke. Built on publicAppOrigin(), never the request host.
*/
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

    const stop = await loadTrackableStop(admin, tenantId, stopId);
    const { token, expiresAt } = await issueTrackingLink(admin, { stop, createdBy: user.id });

    return NextResponse.json({
      ok: true,
      url: `${publicAppOrigin(request.url)}/track/${encodeURIComponent(token)}`,
      expiresAt,
      reference: stop.reference,
      contactName: stop.contactName,
      contactEmail: stop.contactEmail,
      contactPhone: stop.contactPhone,
    });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });
    if (error instanceof TrackableStopError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrackingUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("Unable to create tracking link:", error);
    return NextResponse.json({ error: "Unable to create tracking link." }, { status: 500 });
  }
}
