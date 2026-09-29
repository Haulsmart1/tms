import { NextResponse } from "next/server";
import { isUuid } from "../../../../../lib/auth/serverTenantAccess";
import { driverErrorResponse } from "../../../../../lib/driver/server";
import { checkRateLimit, RATE_LIMITS } from "../../../../../lib/rateLimit";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { PHOTO_RACE_MESSAGE, photoAppendDecision, postgresTextArray } from "../../../../../lib/walkaround/photoPaths";
import { requireDirectDriver } from "../../../../../lib/walkaround/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Step 2 of a walkaround defect photo upload: the photo is already in storage
  via the signed upload URL. Re-authorize, confirm the path this driver's
  defect owns, confirm the object exists, then record it on the defect.
  Idempotent on a repeated path.

  The five-photo cap is checked again here: several upload URLs can be issued
  before any photo is recorded. The append is a guarded update that only
  applies while photo_paths is still what was read, so two photos recorded at
  once cannot overwrite each other; on a lost race it re-reads and tries once
  more, then answers 409 for the queue to retry.
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
    const limit = await checkRateLimit(admin, RATE_LIMITS.driverWalkaroundPhoto, session.userId);
    if (!limit.allowed) {
      return NextResponse.json({ error: "Too many photos. Try again shortly." }, { status: 429 });
    }

    const loadDefect = () =>
      admin
        .from("walkaround_defects")
        .select("id,check_id,photo_paths,walkaround_checks!inner(driver_id)")
        .eq("tenant_id", session.tenantId)
        .eq("client_id", defectClientId)
        .eq("walkaround_checks.driver_id", session.driverId)
        .maybeSingle();

    const { data: defect, error } = await loadDefect();
    if (error) throw new Error(error.message);
    if (!defect) {
      return NextResponse.json({ error: "That defect has not synced yet." }, { status: 404 });
    }

    const path = typeof body.path === "string" ? body.path : "";
    const prefix = `${session.tenantId}/${defect.check_id}/${defectClientId}/`;
    if (!path.startsWith(prefix) || path.includes("..")) {
      return NextResponse.json({ error: "Invalid upload reference." }, { status: 400 });
    }

    const firstDecision = photoAppendDecision((defect.photo_paths as string[] | null) ?? [], path);
    if (firstDecision === "already") return NextResponse.json({ ok: true });
    if (firstDecision === "full") {
      return NextResponse.json({ error: "A defect can have at most five photos." }, { status: 409 });
    }

    const filename = path.slice(prefix.length);
    const folder = path.slice(0, path.length - filename.length - 1);
    const { data: listed, error: listError } = await admin.storage.from("walkaround-photos").list(folder, { search: filename });
    if (listError) throw new Error(listError.message);
    if (!listed?.some((f) => f.name === filename)) {
      return NextResponse.json({ error: "The photo did not finish uploading." }, { status: 409 });
    }

    let current = (defect.photo_paths as string[] | null) ?? [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        const { data: reread, error: rereadError } = await loadDefect();
        if (rereadError) throw new Error(rereadError.message);
        if (!reread) return NextResponse.json({ error: "That defect has not synced yet." }, { status: 404 });
        current = (reread.photo_paths as string[] | null) ?? [];
        const decision = photoAppendDecision(current, path);
        if (decision === "already") return NextResponse.json({ ok: true });
        if (decision === "full") {
          return NextResponse.json({ error: "A defect can have at most five photos." }, { status: 409 });
        }
      }

      const { data: updated, error: updateError } = await admin
        .from("walkaround_defects")
        .update({ photo_paths: [...current, path] })
        .eq("id", defect.id)
        .eq("tenant_id", session.tenantId)
        .eq("photo_paths", postgresTextArray(current))
        .select("id");
      if (updateError) throw new Error(updateError.message);
      if (updated && updated.length > 0) return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: PHOTO_RACE_MESSAGE }, { status: 409 });
  } catch (error) {
    const { status, message } = driverErrorResponse(error);
    return NextResponse.json({ error: message }, { status });
  }
}
