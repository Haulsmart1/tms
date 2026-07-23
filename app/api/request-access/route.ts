import { NextResponse } from "next/server";
import { Resend } from "resend";
import { RequestAccessValidation } from "../../../lib/validation/requestAccess";

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

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const to = process.env.LEAD_INBOX;
  if (!apiKey || !from || !to) {
    // Deliberately vague to the client, specific in the log: the response is
    // public and must not disclose which piece of config is missing.
    console.error("request-access: missing RESEND_API_KEY / MAIL_FROM / LEAD_INBOX");
    return NextResponse.json(
      { ok: false, error: "Server is not configured to receive requests." },
      { status: 500 },
    );
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
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
    ].join("\n"),
  });

  if (error) {
    console.error("request-access: Resend send failed", error);
    return NextResponse.json(
      { ok: false, error: "Could not send your request. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
