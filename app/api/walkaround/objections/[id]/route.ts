import { NextRequest, NextResponse } from "next/server";
import { createApiSupabase } from "../../../../../lib/api/server";
import { authorizeTenant, isUuid, TenantAccessError } from "../../../../../lib/auth/serverTenantAccess";
import { createAdminClient } from "../../../../../lib/supabase/admin";
import { LIABILITY_NOTICE_VERSION } from "../../../../../lib/walkaround/liability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };
type ObjectionBody = { decision?: unknown; note?: unknown; liabilityAccepted?: unknown; liabilityVersion?: unknown };

/*
  An admin decides a driver's objection to a walkaround VOR. Approval does NOT
  return the vehicle to service: the admin still does that on /maintenance,
  where WLK01 now lets it through. Only an admin (manage) may decide, and the
  update is guarded on status = 'pending' so two admins cannot both decide.
*/
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Objection not found." }, { status: 404 });
    }

    let body: ObjectionBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
    if (!decision) {
      return NextResponse.json({ error: "decision must be approve or reject." }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note.trim() || null : null;

    if (decision === "approve") {
      if (body.liabilityAccepted !== true || body.liabilityVersion !== LIABILITY_NOTICE_VERSION) {
        return NextResponse.json({ error: "Accept the notice to approve." }, { status: 400 });
      }
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
    const { data: objection, error: objectionError } = await admin
      .from("defect_objections")
      .select("id,tenant_id,status")
      .eq("id", id)
      .maybeSingle();
    if (objectionError) throw new Error(objectionError.message);
    if (!objection) {
      return NextResponse.json({ error: "Objection not found." }, { status: 404 });
    }

    try {
      await authorizeTenant(admin, user.id, String(objection.tenant_id), "manage");
    } catch (error) {
      if (error instanceof TenantAccessError) {
        if (error.status === 401) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
        if (error.status === 403) {
          return NextResponse.json({ error: "Only an admin can decide an objection." }, { status: 403 });
        }
        return NextResponse.json({ error: "Unable to verify tenant access." }, { status: 500 });
      }
      throw error;
    }

    const { data, error } = await admin
      .from("defect_objections")
      .update({
        status: decision === "approve" ? "approved" : "rejected",
        decided_by_user_id: user.id,
        decided_at: new Date().toISOString(),
        decision_note: note,
        liability_notice_version: decision === "approve" ? LIABILITY_NOTICE_VERSION : null,
        liability_accepted: decision === "approve",
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Someone else has already decided this objection." }, { status: 409 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[walkaround] objection decision failed", error);
    return NextResponse.json({ error: "Unable to save the decision." }, { status: 500 });
  }
}
