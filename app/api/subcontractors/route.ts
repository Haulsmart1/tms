import { NextRequest, NextResponse } from "next/server";
import { createUserClient, createAdminClient } from "../../../lib/accounts/server";
import { authorizeTenant, TenantAccessError } from "../../../lib/auth/serverTenantAccess";
import { subcontractorColumnsFor } from "../../../lib/accounts/portalScope";
import { GENERIC_ERROR_MESSAGE } from "../../../lib/accounts/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Review ACC-10 (audit M3) and ACC-2: authorization comes from profiles, the
  same rule RLS uses, and the columns returned depend on the caller's role.
  Drivers are refused; staff get operational columns; admins also get
  commercial terms.
*/
export async function GET(request: NextRequest) {
  try {
    const userClient = await createUserClient();

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();

    if (!tenantId) {
      return NextResponse.json({ error: "A tenant must be selected." }, { status: 400 });
    }

    const admin = createAdminClient();

    let authorized;
    try {
      authorized = await authorizeTenant(admin, user.id, tenantId, "access");
    } catch (error) {
      if (error instanceof TenantAccessError && error.status === 403) {
        return NextResponse.json({ error: "You do not belong to the selected tenant." }, { status: 403 });
      }
      throw error;
    }

    const columns = subcontractorColumnsFor(authorized.tier, authorized.caller.roleName);

    if (!columns) {
      return NextResponse.json({ error: "Your role cannot view subcontractors." }, { status: 403 });
    }

    const { data, error } = await admin
      .from("subcontractors")
      .select(columns)
      .eq("tenant_id", tenantId)
      .order("name");

    if (error) {
      throw new Error(`subcontractors select failed: ${error.code ?? ""}`);
    }

    return NextResponse.json({
      subcontractors: data ?? [],
    });
  } catch (error) {
    console.error("Subcontractors API failed:", error);

    return NextResponse.json({ error: GENERIC_ERROR_MESSAGE, code: "internal_error" }, { status: 500 });
  }
}
