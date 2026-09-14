import { NextRequest, NextResponse } from "next/server";
import { checkRemoval, checkRoleEdit, parseInvitableRole, userAdminErrorResponse } from "../../../../../lib/tenant/userAdmin";
import { json, loadCompanyTarget, requireUserAdmin } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ userId: string }> };

const NOT_FOUND = { error: "That user does not belong to this company." };

function cleanOptional(value: unknown, max: number): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, max) : null;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { userId } = await context.params;

  let body: { tenantId?: unknown; fullName?: unknown; phone?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const role = parseInvitableRole(body.role);
  if (!role) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const access = await requireUserAdmin(tenantId);
  if (!access.ok) return access.response;

  const { admin, user, tier, tenant } = access.ctx;

  try {
    const target = await loadCompanyTarget(admin, userId, tenant.companyId);
    if (!target) return NextResponse.json(NOT_FOUND, { status: 404 });

    const refusal = checkRoleEdit({
      callerId: user.id,
      callerTier: tier,
      target: { userId: target.id, roleName: target.roleName },
      newRole: role,
    });
    if (refusal) return json(refusal);

    // profiles.role_id is the source of truth, so a demotion is visible to RLS
    // on the very next query. The function also syncs memberships and holds
    // the last-admin guard under a lock.
    if (target.roleName !== role || target.roleId === null || target.companyId === null) {
      const { error } = await admin.rpc("set_company_user_role", {
        p_user_id: target.id,
        p_company_id: tenant.companyId,
        p_role: role,
        p_caller_is_super: tier === "super_admin",
      });
      if (error) {
        console.error("[settings/users] role change failed", error.code, error.message);
        return json(userAdminErrorResponse(error));
      }
    }

    // Name and phone are the person's own profile fields, edited only for a
    // user already proven to be in the caller's company (SET-8).
    const fullName = cleanOptional(body.fullName, 200);
    const phone = cleanOptional(body.phone, 50);
    const { error: detailsError } = await admin
      .from("profiles")
      .update({ full_name: fullName, phone })
      .eq("id", target.id);

    if (detailsError) {
      console.error("[settings/users] details update failed", detailsError.code);
      return NextResponse.json(
        { error: "The role was saved, but the name and phone could not be updated." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, userId: target.id, tenantId, fullName, phone, role });
  } catch (error) {
    console.error("[settings/users] update failed", error);
    return NextResponse.json({ error: "Unable to update the user." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { userId } = await context.params;
  const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim() ?? "";

  const access = await requireUserAdmin(tenantId);
  if (!access.ok) return access.response;

  const { admin, user, tier, tenant } = access.ctx;

  try {
    const target = await loadCompanyTarget(admin, userId, tenant.companyId);
    if (!target) return NextResponse.json(NOT_FOUND, { status: 404 });

    const refusal = checkRemoval({
      callerId: user.id,
      callerTier: tier,
      target: { userId: target.id, roleName: target.roleName },
    });
    if (refusal) return json(refusal);

    const { error } = await admin.rpc("remove_company_user", {
      p_user_id: target.id,
      p_company_id: tenant.companyId,
      p_caller_is_super: tier === "super_admin",
    });

    if (error) {
      console.error("[settings/users] removal failed", error.code, error.message);
      return json(userAdminErrorResponse(error));
    }

    return NextResponse.json({ ok: true, userId: target.id });
  } catch (error) {
    console.error("[settings/users] removal failed", error);
    return NextResponse.json({ error: "Unable to remove the user." }, { status: 500 });
  }
}
