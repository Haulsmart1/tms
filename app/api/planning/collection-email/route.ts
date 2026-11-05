import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../../lib/api/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../../lib/jobs/officeAccess";
import { collectionEmailOptionsError, type CollectionEmailOptions } from "../../../../lib/planning/collectionEmail";
import { loadCollectionEmails, sendCollectionEmail } from "../../../../lib/planning/collectionEmailServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !isUuid(body.tenantId) || !Array.isArray(body.jobIds) || !body.jobIds.length || body.jobIds.length > 250 || !body.jobIds.every((id: unknown) => typeof id === "string" && isUuid(id)) || !["preview", "send"].includes(body.action)) {
      return NextResponse.json({ error: "Choose jobs in one workspace." }, { status: 400 });
    }
    const ids = [...new Set<string>(body.jobIds)];
    if (body.action === "send" && ids.length !== 1) return NextResponse.json({ error: "Send one contact per request." }, { status: 400 });
    const options = body.options as CollectionEmailOptions | undefined;
    const invalid = options ? collectionEmailOptionsError(options) : "Choose the email details.";
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    const client = await createApiSupabase();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const admin = createAdminClient();
    await authorizeOfficeTenant(admin, user.id, body.tenantId);
    const messages = await loadCollectionEmails(admin, body.tenantId, ids, options!);
    if (body.action === "preview") return NextResponse.json({ rows: messages.map((m) => m.preview) });
    if (options!.kind === "collection_receipt" && body.confirmCollected !== true) return NextResponse.json({ error: "Confirm that the goods have actually been collected before sending a receipt." }, { status: 409 });
    const message = messages[0];
    if (body.fingerprint !== message.preview.fingerprint) return NextResponse.json({ error: "The appointment or contact details have changed. Preview the email again." }, { status: 409 });
    // The email uses canonical stored contacts and the explicitly reviewed
    // date/window. It never publishes a draft plan or completes a job.
    return NextResponse.json(await sendCollectionEmail(admin, user.id, message, options!));
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });
    console.error("[collection-email] request failed", error instanceof Error ? error.name : "Error");
    return NextResponse.json({ error: "Unable to prepare or send the email. Refresh and check the job contacts." }, { status: 500 });
  }
}
