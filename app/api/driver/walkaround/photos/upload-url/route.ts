import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isUuid } from "../../../../../../lib/auth/serverTenantAccess";
import { driverErrorResponse } from "../../../../../../lib/driver/server";
import { checkRateLimit, RATE_LIMITS } from "../../../../../../lib/rateLimit";
import { createAdminClient } from "../../../../../../lib/supabase/admin";
import {
  MAX_PHOTOS_PER_DEFECT,
  MAX_WALKAROUND_PHOTO_BYTES,
  WALKAROUND_PHOTO_EXTENSIONS,
} from "../../../../../../lib/walkaround/photoPaths";
import { requireDirectDriver } from "../../../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Step 1 of a walkaround defect photo upload: authorize the driver, check the
  declared type and size, load the defect this photo belongs to (it must
  already have synced to the server) and hand back a signed upload token for
  a path the server chose. Mirrors the POD evidence upload-url route.
*/
export async function POST(request: Request) {
  try {
    const session = await requireDirectDriver();

    let body: { defectClientId?: unknown; mimeType?: unknown; size?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    const ext = WALKAROUND_PHOTO_EXTENSIONS[mimeType];
    if (!ext) {
      return NextResponse.json({ error: "Use a JPEG, PNG, WebP or HEIC photo." }, { status: 400 });
    }

    const size = typeof body.size === "number" ? body.size : NaN;
    if (!Number.isFinite(size) || size < 1 || size > MAX_WALKAROUND_PHOTO_BYTES) {
      return NextResponse.json({ error: "The photo size is invalid." }, { status: 400 });
    }

    const defectClientId = typeof body.defectClientId === "string" ? body.defectClientId : "";
    if (!isUuid(defectClientId)) {
      return NextResponse.json({ error: "That defect has not synced yet." }, { status: 404 });
    }

    const admin = createAdminClient();
    const limit = await checkRateLimit(admin, RATE_LIMITS.driverWalkaroundPhoto, session.userId);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many photos. Try again shortly." }, { status: 429 });
    }

    const { data: defect, error } = await admin
      .from("walkaround_defects")
      .select("id,check_id,photo_paths,walkaround_checks!inner(driver_id)")
      .eq("tenant_id", session.tenantId)
      .eq("client_id", defectClientId)
      .eq("walkaround_checks.driver_id", session.driverId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!defect) {
      return NextResponse.json({ error: "That defect has not synced yet." }, { status: 404 });
    }

    const photoPaths = (defect.photo_paths as string[] | null) ?? [];
    if (photoPaths.length >= MAX_PHOTOS_PER_DEFECT) {
      return NextResponse.json({ error: "A defect can have at most five photos." }, { status: 409 });
    }

    const path = `${session.tenantId}/${defect.check_id}/${defectClientId}/${randomUUID()}.${ext}`;
    const { data: signed, error: signError } = await admin.storage.from("walkaround-photos").createSignedUploadUrl(path);
    if (signError || !signed?.token) {
      throw new Error(`Unable to prepare upload: ${signError?.message ?? "no token"}`);
    }

    return NextResponse.json({ ok: true, path, token: signed.token });
  } catch (error) {
    const { status, message } = driverErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
