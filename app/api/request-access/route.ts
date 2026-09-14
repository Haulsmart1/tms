import { NextResponse } from "next/server";
import { Resend } from "resend";
import { RequestAccessValidation } from "../../../lib/validation/requestAccess";
import { createAdminClient } from "../../../lib/supabase/admin";
import { RATE_LIMITS, checkRateLimit, clientIp } from "../../../lib/rateLimit";
import {
  REQUEST_ACCESS_DEDUPE_HOURS,
  REQUEST_ACCESS_PER_EMAIL,
  escapeLikePattern,
  leadClientKey,
  normalizeLeadEmail,
  vehicleCountError,
} from "../../../lib/auth/leadIntake";

/* ABUSE PROTECTION (AUTH-8).
   This endpoint is public and unauthenticated, and sends a Teams card and an
   email on every accepted POST, so it is a target for lead spam and Resend
   quota burn.

   1. Honeypot: a field real users never see and never fill. If it arrives
      non-empty we return 200 WITHOUT sending, so a bot cannot tell it was
      rejected and will not simply retry with the field removed.
   2. Durable rate limits (lib/rateLimit.ts, docs/sql/prodfix_01): per client
      IP, and per lowercased email. The old limiter was an in-memory Map, per
      serverless instance and reset on every cold start.
   3. Dedupe: the same email inside REQUEST_ACCESS_DEDUPE_HOURS is answered ok
      without storing or notifying again.
   4. A ceiling on the vehicle count, which otherwise 500s at the int column.

   Turnstile in front of the form is still the stronger control if a
   distributed bot appears; it needs a site key (manual step). */
const HONEYPOT_FIELD = "companyWebsite";

export async function POST(request: Request) {
  /* The admin client is needed first now, because the limiter lives in the
     database. createAdminClient() throws when the service key is missing. */
  let supabase;
  try {
    supabase = createAdminClient();
  } catch (err) {
    console.error("request-access: Supabase admin client unavailable", err);
    return NextResponse.json(
      { ok: false, error: "Server is not configured to receive requests." },
      { status: 500 },
    );
  }

  // Cheapest abuse check first, before any parsing work.
  const ipLimit = await checkRateLimit(
    supabase,
    RATE_LIMITS.requestAccessPerIp,
    leadClientKey(request.headers, clientIp),
  );
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const honeypot = (body as Record<string, unknown> | null)?.[HONEYPOT_FIELD];
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    console.warn("request-access: honeypot triggered, dropping silently");
    return NextResponse.json({ ok: true });
  }

  const parsed = RequestAccessValidation.safeParse(body);
  if (!parsed.success) {
    // Field-keyed so the client can render each message under its own input.
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return NextResponse.json({ ok: false, fieldErrors }, { status: 400 });
  }

  const { companyName, contactName, phone, vehicles, notes } = parsed.data;
  /* Stored lowercased, so dedupe and the per-email limit cannot be dodged by
     changing case, and the super-admin list does not show one lead twice. */
  const email = normalizeLeadEmail(parsed.data.email);

  const vehiclesError = vehicleCountError(vehicles);
  if (vehiclesError) {
    return NextResponse.json({ ok: false, fieldErrors: { vehicles: [vehiclesError] } }, { status: 400 });
  }

  const emailLimit = await checkRateLimit(supabase, REQUEST_ACCESS_PER_EMAIL, email);
  if (!emailLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Please try again shortly." },
      { status: 429 },
    );
  }

  /* Case-insensitive, because rows stored before this change kept the email
     as typed. A lookup failure does not block the lead: losing a real prospect
     is worse than one duplicate notification, and the rate limits above still
     bound the damage. */
  const since = new Date(Date.now() - REQUEST_ACCESS_DEDUPE_HOURS * 3600 * 1000).toISOString();
  const { data: recent, error: dedupeError } = await supabase
    .from("registration_requests")
    .select("id")
    .ilike("email", escapeLikePattern(email))
    .gte("created_at", since)
    .limit(1);

  if (dedupeError) {
    console.error("request-access: duplicate check failed; storing anyway", dedupeError.code);
  } else if ((recent ?? []).length > 0) {
    // Same shape as a real success, so a resubmission looks identical to the
    // visitor, and nobody is notified twice for one prospect.
    return NextResponse.json({ ok: true, notified: true });
  }

  /* The database is the system of record, not the email. Store the lead first
     and only then try to notify. If we emailed first and the send failed, the
     lead would be gone forever and nobody would know someone had tried.

     `status` is deliberately omitted so the column default applies.
     No `.select()` is chained: that would ask PostgREST to read the row back,
     which is a different permission from writing it. */
  const { error: insertError } = await supabase.from("registration_requests").insert({
    company_name: companyName,
    contact_name: contactName,
    email,
    phone: phone ?? null,
    vehicle_count: vehicles,
    notes: notes ?? null,
  });

  if (insertError) {
    console.error("request-access: could not store the request", insertError);
    return NextResponse.json(
      { ok: false, error: "Could not save your request. Please try again." },
      { status: 500 },
    );
  }

  /* Notification is BEST EFFORT from here on, across BOTH channels. The lead is
     safely stored, so a notification failure must never fail the request or the
     visitor would resubmit and create duplicates. `notified` tracks whether
     ANY channel got through, so a stored-but-silent lead stays visible. */
  let notified = false;

  /* Microsoft Teams notification, via a Power Automate ("Workflows") flow whose
     trigger URL we POST to. That URL is a capability secret: possession alone
     authorises the post, exactly like a Slack webhook, so it lives in an env var
     and must never reach the client bundle (no NEXT_PUBLIC_ prefix).

     Awaited with a short timeout rather than left dangling: an un-awaited promise
     can be killed when the serverless response returns, and an un-timed-out one
     could hang the visitor's request behind a slow upstream.

     The flow's "post card" action parses the request body DIRECTLY as an Adaptive
     Card (AdaptiveCard.FromJson), so the body must BE a card object whose top
     `type` is "AdaptiveCard"; flat JSON makes the flow throw. Field values sit in
     a FactSet as plain text, and JSON.stringify escapes quotes and newlines, so a
     prospect's input cannot break out of the card structure. The trigger answers
     202 Accepted, which res.ok covers. */
  const teamsUrl = process.env.TEAMS_WEBHOOK_URL;
  if (teamsUrl) {
    try {
      const card = {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          {
            type: "TextBlock",
            text: "New access request",
            weight: "Bolder",
            size: "Large",
            wrap: true,
          },
          {
            type: "FactSet",
            facts: [
              { title: "Company", value: companyName },
              { title: "Contact", value: contactName },
              { title: "Email", value: email },
              { title: "Phone", value: phone ?? "-" },
              { title: "Vehicles", value: String(vehicles) },
              { title: "Notes", value: notes ?? "-" },
            ],
          },
          {
            type: "TextBlock",
            text: "Stored in registration_requests.",
            size: "Small",
            isSubtle: true,
            wrap: true,
          },
        ],
      };
      const res = await fetch(teamsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) notified = true;
      else console.error("request-access: Teams webhook returned", res.status);
    } catch (err) {
      console.error("request-access: Teams webhook failed or timed out", err);
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const to = process.env.LEAD_INBOX;

  /* `notified` is returned so the client can tell the visitor the truth. A
     stored-but-unnotified lead is invisible until somebody opens
     /super-admin/requests, so it must not be reported as a plain success. */
  if (!apiKey || !from || !to) {
    if (!notified) {
      console.warn(
        "request-access: LEAD STORED BUT NOBODY NOTIFIED. No Teams webhook succeeded and email is not configured (RESEND_API_KEY / MAIL_FROM / LEAD_INBOX). Check /super-admin/requests.",
      );
    }
    return NextResponse.json({ ok: true, notified });
  }

  try {
    const resend = new Resend(apiKey);
    const { error: sendError } = await resend.emails.send({
      from,
      to,
      replyTo: email,
      // Strip CR/LF: a subject line is a mail header, and newlines in
      // user-controlled header content are a header-injection vector. The
      // schema also caps the length, this is the second layer.
      subject: `New access request: ${companyName.replace(/[\r\n]+/g, " ").slice(0, 200)}`,
      text: [
        `Company: ${companyName}`,
        `Contact: ${contactName}`,
        `Email: ${email}`,
        `Phone: ${phone ?? "-"}`,
        `Vehicles: ${vehicles}`,
        `Notes: ${notes ?? "-"}`,
        "",
        "Stored in registration_requests.",
      ].join("\n"),
    });
    if (sendError) {
      console.error(
        notified
          ? "request-access: notified via Teams, but the Resend email failed (a sending domain must be verified for MAIL_FROM)."
          : "request-access: LEAD STORED BUT NOBODY NOTIFIED. Resend rejected the send and no Teams webhook succeeded. Check /super-admin/requests.",
        sendError,
      );
      return NextResponse.json({ ok: true, notified });
    }
    notified = true;
  } catch (err) {
    console.error(
      notified
        ? "request-access: notified via Teams, but the email send threw."
        : "request-access: LEAD STORED BUT NOBODY NOTIFIED. Send threw and no Teams webhook succeeded.",
      err,
    );
    return NextResponse.json({ ok: true, notified });
  }

  return NextResponse.json({ ok: true, notified });
}
