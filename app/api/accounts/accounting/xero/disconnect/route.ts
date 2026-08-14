import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";
import {
  revokeXeroConnection,
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

    const { data, error } = await admin
      .from("accounting_integrations")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("provider", "xero")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return NextResponse.json({
        ok: true,
      });
    }

    await revokeXeroConnection(
      data.id
    );

    const { error: updateError } =
      await admin
        .from("accounting_integrations")
        .update({
          active: false,
          connection_status:
            "not_connected",
          external_tenant_id: null,
          external_tenant_name: null,
          connected_at: null,
          updated_at:
            new Date().toISOString(),
        })
        .eq("id", data.id);

    if (updateError) {
      throw new Error(
        updateError.message
      );
    }

    await admin
      .from("accounting_sync_log")
      .insert({
        tenant_id: tenantId,
        integration_id: data.id,
        entity_type: "connection",
        direction: "outbound",
        action: "disconnect",
        status: "success",
        initiated_by: user.id,
      });

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      { status: result.status }
    );
  }
}
