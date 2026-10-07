import { NextResponse } from "next/server";
import { RATE_LIMITS, checkRateLimit, clientIp } from "../../../../../lib/rateLimit";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { resolveTrackingToken } from "../../../../../lib/tracking/linkStore";
import { loadTrackingView } from "../../../../../lib/tracking/trackingServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Public, token-gated tracking data, polled by /track/[token] every 60 seconds.
  Rate limited per IP. Unknown, malformed, expired, revoked and ended links all
  get the same answer. The payload comes only from buildTrackingPayload
  (lib/tracking/publicPayload.ts), which decides what may leave the server.
*/
const ENDED = "This tracking link has ended.";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const admin = createAdminClient();

  const limit = await checkRateLimit(admin, RATE_LIMITS.trackingViewPerIp, clientIp(request.headers));
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429, headers: NO_STORE });
  }

  const { token } = await context.params;
  let rawToken: string;
  try {
    rawToken = decodeURIComponent(token);
  } catch {
    return NextResponse.json({ error: ENDED }, { status: 404, headers: NO_STORE });
  }

  try {
    const link = await resolveTrackingToken(admin, rawToken);
    if (!link) return NextResponse.json({ error: ENDED }, { status: 404, headers: NO_STORE });

    const payload = await loadTrackingView(admin, link);
    if (!payload) return NextResponse.json({ error: ENDED }, { status: 404, headers: NO_STORE });

    return NextResponse.json(payload, { headers: NO_STORE });
  } catch (error) {
    console.error("[tracking] public view failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Tracking is unavailable right now. Try again shortly." }, { status: 500, headers: NO_STORE });
  }
}
