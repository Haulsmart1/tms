import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";
import {
  getValidXeroAccessToken,
} from "../../../../../../lib/accounts/providers/xero";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest
) {
  try {
    const body = await request.json();

    const tenantId =
      String(
        body.tenantId ?? ""
      ).trim();

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId is required." },
        { status: 400 }
      );
    }

    const { admin, user } =
      await requireTenantAccess(tenantId);

    const { data: integration, error } =
      await admin
        .from("accounting_integrations")
        .select(
          "id,external_tenant_id"
        )
        .eq("tenant_id", tenantId)
        .eq("provider", "xero")
        .eq(
          "connection_status",
          "connected"
        )
        .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (
      !integration?.external_tenant_id
    ) {
      return NextResponse.json(
        { error: "Xero is not connected." },
        { status: 409 }
      );
    }

    const accessToken =
      await getValidXeroAccessToken(
        integration.id
      );

    const response = await fetch(
      "https://api.xero.com/api.xro/2.0/Organisation",
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          "Xero-tenant-id":
            integration.external_tenant_id,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    const payload =
      await response.json();

    await admin
      .from("accounting_sync_log")
      .insert({
        tenant_id: tenantId,
        integration_id:
          integration.id,
        entity_type: "connection",
        direction: "outbound",
        action: "test",
        status: response.ok
          ? "success"
          : "error",
        response_payload: payload,
        error_message: response.ok
          ? null
          : `Xero test failed (${response.status}).`,
        initiated_by: user.id,
      });

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            `Xero test failed (${response.status}).`,
          payload,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      organisation:
        payload?.Organisations?.[0] ??
        null,
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      { status: result.status }
    );
  }
}
