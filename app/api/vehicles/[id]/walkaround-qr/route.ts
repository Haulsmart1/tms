import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../../../lib/api/server";
import { authorizeVehicleTenant, isUuid, TenantAccessError } from "../../../../../lib/auth/serverTenantAccess";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { encodeQrPayload } from "../../../../../lib/walkaround/qrToken";
import { generateQrToken, hashQrToken } from "../../../../../lib/walkaround/qrTokenServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/*
  Issue a new cab QR sticker for a vehicle. The token is shown once here;
  printing again means calling this route again, which overwrites the stored
  hash and invalidates the old sticker.
*/
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
    }

    const userClient = await createApiSupabase();
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: vehicle, error: vehicleError } = await admin
      .from("vehicles")
      .select("id,tenant_id,registration")
      .eq("id", id)
      .maybeSingle();
    if (vehicleError) throw new Error(vehicleError.message);
    if (!vehicle) {
      return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });
    }

    try {
      // Some legacy vehicles carry a COMPANY id in tenant_id, not a real
      // tenant id (CLAUDE.md); authorizeVehicleTenant handles both shapes the
      // same way DELETE /api/vehicles/[id] does.
      await authorizeVehicleTenant(admin, user.id, String(vehicle.tenant_id));
    } catch (error) {
      if (error instanceof TenantAccessError) {
        if (error.status === 401) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
        if (error.status === 403) {
          return NextResponse.json({ error: "You do not have access to this vehicle." }, { status: 403 });
        }
        return NextResponse.json({ error: "Unable to verify tenant access." }, { status: 500 });
      }
      throw error;
    }

    const token = generateQrToken();
    const { error: updateError } = await admin
      .from("vehicles")
      .update({ walkaround_qr_token_hash: hashQrToken(token) })
      .eq("id", id);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json(
      { payload: encodeQrPayload(token), registration: vehicle.registration ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[vehicles] walkaround qr issue failed", error);
    return NextResponse.json({ error: "Unable to issue a QR code." }, { status: 500 });
  }
}
