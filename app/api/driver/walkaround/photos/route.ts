import { NextResponse } from "next/server";
import { isUuid } from "../../../../../lib/auth/serverTenantAccess";
import { driverErrorResponse } from "../../../../../lib/driver/server";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { requireDirectDriver } from "../../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Step 2 of a walkaround defect photo upload: the photo is already in storage
  via the signed upload URL. Re-authorize, confirm the path this driver's
  defect owns, confirm the object exists, then record it on the defect.
  Idempotent on a repeated path.
*/
export async function POST(request: Request) {
  try {
    const session = await requireDirectDriver();

    let body: { defectClientId?: unknown; path?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const defectClientId = typeof body.defectClientId === "string" ? body.defectClientId : "";
    if (!isUuid(defectClientId)) {
      return NextResponse.json({ error: "That defect has not synced yet." }, { status: 404 });
    }

    const admin = createAdminClient();
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

    const path = typeof body.path === "string" ? body.path : "";
    const prefix = `${session.tenantId}/${defect.check_id}/${defectClientId}/`;
    if (!path.startsWith(prefix) || path.includes("..")) {
      return NextResponse.json({ error: "Invalid upload reference." }, { status: 400 });
    }

    const photoPaths = (defect.photo_paths as string[] | null) ?? [];
    if (photoPaths.includes(path)) {
      return NextResponse.json({ ok: true });
    }

    const filename = path.slice(prefix.length);
    const folder = path.slice(0, path.length - filename.length - 1);
    const { data: listed, error: listError } = await admin.storage.from("walkaround-photos").list(folder, { search: filename });
    if (listError) throw new Error(listError.message);
    if (!listed?.some((f) => f.name === filename)) {
      return NextResponse.json({ error: "The photo did not finish uploading." }, { status: 409 });
    }

    const { error: updateError } = await admin
      .from("walkaround_defects")
      .update({ photo_paths: [...photoPaths, path] })
      .eq("id", defect.id)
      .eq("tenant_id", session.tenantId);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, message } = driverErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
