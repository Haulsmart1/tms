import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../../../../lib/api/server";
import { isUuid } from "../../../../../../lib/auth/serverTenantAccess";
import { authorizeOfficeTenant, officeAccessErrorResponse } from "../../../../../../lib/jobs/officeAccess";
import { createAdminClient } from "../../../../../../lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
const SIGNED_URL_SECONDS = 300;

/* Short-lived signed URLs for a check's defect photos, for the office. */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Check not found." }, { status: 404 });
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
    const { data: check, error: checkError } = await admin
      .from("walkaround_checks")
      .select("id,tenant_id")
      .eq("id", id)
      .maybeSingle();
    if (checkError) throw new Error(checkError.message);
    if (!check) {
      return NextResponse.json({ error: "Check not found." }, { status: 404 });
    }

    await authorizeOfficeTenant(admin, user.id, String(check.tenant_id));

    const { data: defects, error: defectsError } = await admin
      .from("walkaround_defects")
      .select("id,client_id,photo_paths")
      .eq("check_id", id);
    if (defectsError) throw new Error(defectsError.message);

    const photos: { defectClientId: string; url: string }[] = [];
    for (const defect of defects ?? []) {
      const paths = (defect.photo_paths as string[] | null) ?? [];
      for (const path of paths) {
        const { data: signed, error: signError } = await admin.storage
          .from("walkaround-photos")
          .createSignedUrl(path, SIGNED_URL_SECONDS);
        if (signError || !signed?.signedUrl) {
          console.error("[walkaround] failed to sign defect photo", path, signError?.message);
          continue;
        }
        photos.push({ defectClientId: String(defect.client_id), url: signed.signedUrl });
      }
    }

    return NextResponse.json({ photos });
  } catch (error) {
    const access = officeAccessErrorResponse(error);
    if (access) return NextResponse.json({ error: access.message }, { status: access.status });

    console.error("[walkaround] load check photos failed", error);
    return NextResponse.json({ error: "Unable to load photos." }, { status: 500 });
  }
}
