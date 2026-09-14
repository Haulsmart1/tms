import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../../../lib/api/server";
import { isUuid } from "../../../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../../../lib/jobs/officeAccess";
import { PodShareUnavailableError, revokePodShareLinks } from "../../../../../lib/pod/shareStore";
import { createAdminClient } from "../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Withdraw every live share link for one job (review POD-9). */
export async function POST(request: NextRequest) {
  try {
    let body: { jobId?: unknown; tenantId?: unknown };

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";

    if (!isUuid(jobId) || !isUuid(tenantId)) {
      return NextResponse.json({ error: "jobId and tenantId are required." }, { status: 400 });
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

    const revoked = await revokePodShareLinks(admin, { tenantId, jobId, revokedBy: user.id });

    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });

    if (error instanceof PodShareUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    console.error("Unable to revoke POD shares:", error);
    return NextResponse.json({ error: "Unable to revoke POD share links." }, { status: 500 });
  }
}
