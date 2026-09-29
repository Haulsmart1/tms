import { NextResponse } from "next/server";
import { driverErrorResponse } from "../../../../../lib/driver/server";
import { checkRateLimit, RATE_LIMITS } from "../../../../../lib/rateLimit";
import { parseDriverEvent } from "../../../../../lib/shifts/events";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { processDriverEvent } from "../../../../../lib/walkaround/processEvent";
import { requireDirectDriver } from "../../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  One queued driver event per request, in the order the phone recorded them.
  Idempotent: a repeated clientId answers 200 with duplicate: true.
*/
export async function POST(request: Request) {
  try {
    const session = await requireDirectDriver();

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const parsed = parseDriverEvent(raw);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const admin = createAdminClient();
    const limit = await checkRateLimit(admin, RATE_LIMITS.driverShiftEvent, session.userId);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many events. Try again shortly." }, { status: 429 });
    }

    const result = await processDriverEvent(admin, session, parsed.event, new Date());
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const { status, message } = driverErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
