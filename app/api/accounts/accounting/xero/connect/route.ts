import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ACCOUNTS_ADMIN_ROLES,
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";
import {
  createXeroAuthorizationUrl,
} from "../../../../../../lib/accounts/providers/xero";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest
) {
  try {
    const tenantId =
      request.nextUrl.searchParams
        .get("tenantId")
        ?.trim();

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId is required." },
        { status: 400 }
      );
    }

    await requireTenantAccess(tenantId, ACCOUNTS_ADMIN_ROLES);

    const state =
      crypto.randomBytes(32).toString("hex");

    const response = NextResponse.redirect(
      createXeroAuthorizationUrl(state)
    );

    response.cookies.set(
      "xero_oauth_state",
      state,
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 10 * 60,
      }
    );

    response.cookies.set(
      "xero_oauth_tenant",
      tenantId,
      {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 10 * 60,
      }
    );

    return response;
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      { status: result.status }
    );
  }
}
