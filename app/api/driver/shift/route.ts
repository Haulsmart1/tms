import { NextResponse } from "next/server";
import { driverErrorResponse } from "../../../../lib/driver/server";
import { createAdminClient } from "../../../../lib/supabase/admin";
import { loadDriverShiftState, requireDirectDriver } from "../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* The driver's shift, current vehicle, checklist and any VOR that is stopping them. */
export async function GET() {
  try {
    const session = await requireDirectDriver();
    const state = await loadDriverShiftState(createAdminClient(), session);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const { status, message } = driverErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
