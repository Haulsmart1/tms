import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../../lib/api/server";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../../lib/jobs/officeAccess";
import { POD_SHARE_LIFETIME_SECONDS } from "../../../../lib/pod/shareLinks";
import { issuePodShareLink, PodShareUnavailableError } from "../../../../lib/pod/shareStore";
import { createAdminClient } from "../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Mint a POD share link for a completed job. Office callers only (review
  POD-18): tenant access decided from profiles, drivers refused. The link is an
  opaque stored token (lib/pod/shareStore.ts) that can be revoked through
  /api/pod/share/revoke.
*/
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

    const { data: job, error: jobError } = await admin
      .from("jobs")
      .select("id,status,reference,customer_id,external_reference")
      .eq("id", jobId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (jobError) throw new Error(jobError.message);

    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    if (job.status !== "completed") {
      return NextResponse.json(
        { error: "POD sharing is available after the job is completed." },
        { status: 409 },
      );
    }

    let customer: {
      name: string | null;
      contact_name: string | null;
      email: string | null;
      operations_email: string | null;
      phone: string | null;
      mobile: string | null;
    } | null = null;

    if (job.customer_id) {
      const { data, error } = await admin
        .from("customers")
        .select("name,contact_name,email,operations_email,phone,mobile")
        .eq("id", job.customer_id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      customer = data;
    }

    const { token, expiresAt } = await issuePodShareLink(admin, {
      tenantId,
      jobId,
      createdBy: user.id,
    });

    const origin = new URL(request.url).origin;
    const encodedToken = encodeURIComponent(token);

    return NextResponse.json({
      ok: true,
      shareUrl: `${origin}/pod/share/${encodedToken}`,
      pdfUrl: `${origin}/api/pod/share/${encodedToken}/pdf`,
      expiresAt,
      expiresInSeconds: POD_SHARE_LIFETIME_SECONDS,
      reference: job.reference ?? null,
      isCambridge: Boolean(job.external_reference?.startsWith("CAMBRIDGE-RMA-")),
      contactName: customer?.contact_name ?? customer?.name ?? null,
      contactEmail: customer?.operations_email ?? customer?.email ?? null,
      contactPhone: customer?.mobile ?? customer?.phone ?? null,
    });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });

    if (error instanceof PodShareUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    console.error("Unable to create POD share:", error);
    return NextResponse.json({ error: "Unable to create POD share." }, { status: 500 });
  }
}
