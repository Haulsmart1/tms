import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withSuperAdmin } from "../../../../../../lib/superAdmin/guard";
import { createAdminClient } from "../../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Reason = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();

// Company admins cannot exempt their own fleet. The database records the
// verified platform actor, reason and timestamp atomically with the licence.
export const POST = withSuperAdmin(async (
  actorId: string, request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid vehicle." }, { status: 400 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Expected JSON." }, { status: 400 }); }
  const parsed = Reason.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "An authorisation reason is required." }, { status: 400 });
  }
  const { data, error } = await createAdminClient().rpc("grant_internal_vehicle_licence", {
    p_vehicle_id: id, p_authorised_by: actorId, p_reason: parsed.data.reason,
  });
  if (error) {
    console.error("Internal licence grant refused", error.code);
    return NextResponse.json({ error: "Internal licence could not be granted. Check the vehicle and existing licence history." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, licenceId: data, charged: false, billingMode: "internal" });
});
