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
const RATE_LIMIT_MAX_KEYS = 10_000;
const OVERFLOW_KEY = "__overflow__";
const recentHits = new Map<string, number[]>();
let lastPrune = 0;

/* Identify the caller from a header the CLIENT CANNOT FORGE.
   A raw x-forwarded-for is client-supplied on any proxy that appends rather
   than overwrites, so keying on its leftmost value makes the limiter trivially
   bypassable: a fresh spoofed value per request means every request looks like
   a new client. We therefore trust only platform-set headers and otherwise fall
   back to a single shared bucket, which fails CLOSED (everyone unidentifiable
   shares one allowance) rather than open. */
function clientKey(request: Request): string {
  const trusted =
    request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-real-ip");
  const value = trusted?.split(",")[0]?.trim();
  return value && value.length > 0 ? value : "unidentified";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();

  /* Prune at most once per window. The previous version walked the entire map
     on every request, which is O(n^2) under a flood and turns the limiter into
     its own denial-of-service vector. */
  if (now - lastPrune > RATE_LIMIT_WINDOW_MS) {
    lastPrune = now;
    for (const [k, times] of recentHits) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) recentHits.delete(k);
    }
  }

  /* Hard cap on distinct keys so a flood cannot exhaust memory. Once full, new
     keys share one overflow bucket, so the worst case is a global 429 rather
     than unbounded growth. */
  const effectiveKey =
    recentHits.has(key) || recentHits.size < RATE_LIMIT_MAX_KEYS ? key : OVERFLOW_KEY;

  const mine = (recentHits.get(effectiveKey) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  mine.push(now);
  recentHits.set(effectiveKey, mine);
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

  /* Notification is BEST EFFORT from here on, across BOTH channels. The lead is
     safely stored, so a notification failure must never fail the request or the
     visitor would resubmit and create duplicates. `notified` tracks whether
     ANY channel got through, so a stored-but-silent lead stays visible. */
  let notified = false;

  const lead = {
    company_name: companyName,
    contact_name: contactName,
    email,
    phone: phone ?? null,
    vehicle_count: vehicles,
    notes: notes ?? null,
  };

  /* n8n webhook. Self-hosted, so this is an internal hop rather than a third
     party. Awaited with a short timeout rather than left dangling: an
     un-awaited promise can be killed when the serverless response returns, and
     an un-timed-out one could hang the visitor's request behind a slow VPS. */
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (n8nUrl) {
    try {
      const n8nSecret = process.env.N8N_WEBHOOK_SECRET;
      const res = await fetch(n8nUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(n8nSecret ? { "x-webhook-secret": n8nSecret } : {}),
        },
        body: JSON.stringify({ type: "INSERT", table: "registration_requests", record: lead }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) notified = true;
      else console.error("request-access: n8n webhook returned", res.status);
    } catch (err) {
      console.error("request-access: n8n webhook failed or timed out", err);
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
        "request-access: LEAD STORED BUT NOBODY NOTIFIED. No n8n webhook and email is not configured (RESEND_API_KEY / MAIL_FROM / LEAD_INBOX). Check /super-admin/requests.",
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
          ? "request-access: notified via n8n, but the Resend email failed (a sending domain must be verified for MAIL_FROM)."
          : "request-access: LEAD STORED BUT NOBODY NOTIFIED. Resend rejected the send and no n8n webhook succeeded. Check /super-admin/requests.",
        sendError,
      );
      return NextResponse.json({ ok: true, notified });
    }
    notified = true;
  } catch (err) {
    console.error(
      notified
        ? "request-access: notified via n8n, but the email send threw."
        : "request-access: LEAD STORED BUT NOBODY NOTIFIED. Send threw and no n8n webhook succeeded.",
      err,
    );
    return NextResponse.json({ ok: true, notified });
  }

  return NextResponse.json({ ok: true, notified });
}
