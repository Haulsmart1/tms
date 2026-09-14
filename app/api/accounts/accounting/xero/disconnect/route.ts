import { NextRequest, NextResponse } from "next/server";
import {
  ACCOUNTS_ADMIN_ROLES,
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";
import { readJsonObject } from "../../../../../../lib/accounts/errors";
import { revokeXeroConnection } from "../../../../../../lib/accounts/providers/xero";

export const dynamic = "force-dynamic";

/*
  Review ACC-16: disconnect always deactivates the local integration. Revoking
  the token at Xero is best effort: a missing credential row or a token Xero has
  already revoked must not leave the integration stuck as "connected".
*/
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);

    const tenantId = String(body.tenantId ?? "").trim();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin, user } = await requireTenantAccess(tenantId, ACCOUNTS_ADMIN_ROLES);

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
      return NextResponse.json({ ok: true });
    }

    const { error: updateError } = await admin
      .from("accounting_integrations")
      .update({
        active: false,
        connection_status: "not_connected",
        external_tenant_id: null,
        external_tenant_name: null,
        connected_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("tenant_id", tenantId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    const revocation = await revokeXeroConnection(data.id);

    await admin.from("accounting_sync_log").insert({
      tenant_id: tenantId,
      integration_id: data.id,
      entity_type: "connection",
      direction: "outbound",
      action: "disconnect",
      status: "success",
      error_message: revocation.revokedAtXero
        ? null
        : "Disconnected locally; the token could not be revoked at Xero.",
      initiated_by: user.id,
    });

    return NextResponse.json({ ok: true, revokedAtXero: revocation.revokedAtXero });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(result.body, { status: result.status });
  }
}
