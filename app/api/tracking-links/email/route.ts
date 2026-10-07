import { NextRequest, NextResponse } from "next/server";
import { publicAppOrigin } from "../../../../lib/accounts/appUrl";
import { createApiSupabase } from "../../../../lib/api/server";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { sendLoggedDocumentEmail } from "../../../../lib/documents/delivery";
import { buildDocumentEmailHtml } from "../../../../lib/documents/emailTemplate";
import { trackingShareReference } from "../../../../lib/documents/shareReference";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../../lib/jobs/officeAccess";
import { loadPodBranding } from "../../../../lib/pod/brandingServer";
import { checkPodRecipient, normalizeEmail } from "../../../../lib/pod/emailRecipients";
import { RATE_LIMITS, checkRateLimit } from "../../../../lib/rateLimit";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { TrackableStopError, TrackingUnavailableError, issueTrackingLink, loadTrackableStop, recordTrackingLinkSent } from "../../../../lib/tracking/linkStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Email a tracking link. Same guards as POD email: office callers only,
  recipient limited to the stop's delivery contact, an address stored on the
  job's customer, or the caller's own address; rate limited per user and per
  tenant; branded with the tenant's own name. The delivery log stores an
  opaque reference to the link row, never the URL.
*/

/* checkPodRecipient words its refusals for a POD; the rule is the same here. */
const RECIPIENT_MESSAGES = {
  400: "A valid email recipient is required.",
  403: "A tracking link can only be emailed to the stop's delivery contact, an address saved on this job's customer, or your own email address.",
} as const;

export async function POST(request: NextRequest) {
  try {
    let body: { tenantId?: unknown; stopId?: unknown; to?: unknown };
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

    let customer: { email: string | null; operations_email: string | null; accounts_email: string | null } | null = null;
    if (stop.customerId) {
      const { data, error } = await admin
        .from("customers")
        .select("email,operations_email,accounts_email")
        .eq("id", stop.customerId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      customer = data;
    }

    const recipientCheck = checkPodRecipient({
      requested: body.to,
      customerEmailFields: [stop.contactEmail, customer?.email, customer?.operations_email, customer?.accounts_email],
      callerEmail: user.email,
    });
    if (!recipientCheck.ok) {
      return NextResponse.json({ error: RECIPIENT_MESSAGES[recipientCheck.status] }, { status: recipientCheck.status });
    }

    const [perUser, perTenant] = await Promise.all([
      checkRateLimit(admin, RATE_LIMITS.documentEmailPerUser, user.id),
      checkRateLimit(admin, RATE_LIMITS.documentEmailPerTenant, tenantId),
    ]);
    if (!perUser.allowed || !perTenant.allowed) {
      return NextResponse.json({ error: "Too many document emails have been sent recently. Try again later." }, { status: 429 });
    }

    const recipient = recipientCheck.recipient;
    const { token, tokenHash } = await issueTrackingLink(admin, { stop, createdBy: user.id });
    const url = `${publicAppOrigin(request.url)}/track/${encodeURIComponent(token)}`;

    const branding = await loadPodBranding(admin, tenantId);
    const carrierName = branding.carrierName;
    const subject = `Track your delivery from ${carrierName}`.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 180);

    /* The stop's contact name only when the email goes to that contact; a
       copy to the customer's accounts address or the caller says "Hi there". */
    const greetingName = stop.contactName && normalizeEmail(stop.contactEmail) === recipient ? stop.contactName : null;

    const text = [
      `Hi ${greetingName ?? "there"},`,
      "",
      `${carrierName} is delivering to you. You can follow your delivery here:`,
      "",
      url,
      "",
      "The page shows an estimated arrival time and, when available, a live map once the driver is on the way to you.",
      "",
      "Regards,",
      carrierName,
    ].join("\n");

    const html = buildDocumentEmailHtml({
      companyName: carrierName,
      recipientName: greetingName,
      title: "Track your delivery",
      intro: `${carrierName} is delivering to you. Follow it with the link below: it shows an estimated arrival time and, when available, a live map once the driver is on the way to you.`,
      actionLabel: "Track delivery",
      actionUrl: url,
      footerText: branding.footerText ?? `Thank you for choosing ${carrierName}.`,
    });

    /* Minted before sending so the log can point at it. If the send fails the
       link stays live but unsent: its token never left the server, which is
       better than revoking a link that may have reached the inbox. The
       recipient is recorded on the row only after the send succeeds. */
    const delivery = await sendLoggedDocumentEmail({
      admin,
      tenantId,
      documentType: "tracking_link",
      documentId: stop.stopId,
      recipient,
      subject,
      text,
      html,
      shareReference: trackingShareReference(tokenHash),
      initiatedBy: user.id,
      metadata: { jobId: stop.jobId, stopId: stop.stopId },
    });

    await recordTrackingLinkSent(admin, { tenantId, tokenHash, sentToEmail: recipient });

    return NextResponse.json({ ok: true, recipient, deliveryLogId: delivery.deliveryLogId });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });
    if (error instanceof TrackableStopError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof TrackingUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error("Unable to email tracking link:", error);
    return NextResponse.json({ error: "Unable to email tracking link." }, { status: 500 });
  }
}
