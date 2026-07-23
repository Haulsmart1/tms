import { NextResponse } from "next/server";
import { Resend } from "resend";
import { RequestAccessValidation } from "../../../lib/validation/requestAccess";
import { createAdminClient } from "../../../lib/supabase/admin";

/* ABUSE PROTECTION.
   This endpoint is public and unauthenticated, and sends an email on every
   valid POST, so it is a target for inbox spam and Resend quota burn.

   1. Honeypot: a field real users never see and never fill. If it arrives
      non-empty we return 200 WITHOUT sending, so a bot cannot tell it was
      rejected and will not simply retry with the field removed.
   2. Rate limit: per client IP, held in memory. Know the limits of this. The
      map is per server instance and resets on redeploy, so on serverless it is
      a speed bump against trivial loops rather than a real limiter. If abuse
      actually materialises, move to a shared store (Redis/Upstash) or put
      Turnstile in front of the form. */
const HONEYPOT_FIELD = "companyWebsite";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const recentHits = new Map<string, number[]>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (
    forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown"
  );
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  // Prune while we are here so the map cannot grow without bound.
  for (const [k, times] of recentHits) {
    const kept = times.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (kept.length === 0) recentHits.delete(k);
    else recentHits.set(k, kept);
  }
  const mine = recentHits.get(key) ?? [];
  mine.push(now);
  recentHits.set(key, mine);
  return mine.length > RATE_LIMIT_MAX;
}

export async function POST(request: Request) {
  // Cheapest check first, before any parsing work.
  if (isRateLimited(clientKey(request))) {
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

  const { companyName, contactName, email, phone, vehicles, notes } = parsed.data;

  /* The database is the system of record, not the email. Store the lead first
     and only then try to notify. If we emailed first and the send failed, the
     lead would be gone forever and nobody would know someone had tried.

     `status` is deliberately omitted so the column default applies.
     No `.select()` is chained: that would ask PostgREST to read the row back,
     which is a different permission from writing it. */
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

  /* Notification is BEST EFFORT from here on. The lead is safely stored, so a
     mail failure must not fail the request or the visitor would resubmit and
     create duplicates. Resend cannot deliver until a sending domain is verified
     for the MAIL_FROM address, so this is expected to fail until that is done. */
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const to = process.env.LEAD_INBOX;

  if (!apiKey || !from || !to) {
    console.warn("request-access: stored, but email not configured (RESEND_API_KEY / MAIL_FROM / LEAD_INBOX)");
    return NextResponse.json({ ok: true });
  }

  try {
    const resend = new Resend(apiKey);
    const { error: sendError } = await resend.emails.send({
      from,
      to,
      replyTo: email,
      subject: `New access request: ${companyName}`,
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
      console.error("request-access: stored, but notification email failed", sendError);
    }
  } catch (err) {
    console.error("request-access: stored, but notification email threw", err);
  }

  return NextResponse.json({ ok: true });
}
