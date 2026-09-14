import { NextRequest, NextResponse } from "next/server";
import {
  ACCOUNTS_ADMIN_ROLES,
  createAdminClient,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";
import {
  exchangeXeroCode,
  getXeroConnections,
  saveXeroCredentials,
  xeroAuthEventId,
} from "../../../../../../lib/accounts/providers/xero";
import { publicAppOrigin } from "../../../../../../lib/accounts/appUrl";

export const dynamic = "force-dynamic";

function accountsUrl(
  request: NextRequest,
  params: Record<string, string>
) {
  const url = new URL("/invoices", publicAppOrigin(request.url));

  url.searchParams.set("accountsTab", "accounting");

  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  return url;
}

function redirectWithError(request: NextRequest, reason?: string) {
  const response = NextResponse.redirect(
    accountsUrl(request, reason ? { xero: "error", reason } : { xero: "error" })
  );
  response.cookies.delete("xero_oauth_state");
  response.cookies.delete("xero_oauth_tenant");
  return response;
}

export async function GET(
  request: NextRequest
) {
  const state = request.nextUrl.searchParams.get("state");

  const code = request.nextUrl.searchParams.get("code");

  const xeroError = request.nextUrl.searchParams.get("error");

  const expectedState = request.cookies.get("xero_oauth_state")?.value;

  const tenantId = request.cookies.get("xero_oauth_tenant")?.value;

  if (
    xeroError ||
    !state ||
    !code ||
    !expectedState ||
    !tenantId ||
    state !== expectedState
  ) {
    return redirectWithError(request);
  }

  try {
    const { user } = await requireTenantAccess(tenantId, ACCOUNTS_ADMIN_ROLES);

    const token = await exchangeXeroCode(code);

    const connections = await getXeroConnections(token.access_token);

    if (connections.length === 0) {
      return redirectWithError(request, "no_organisation");
    }

    // Review ACC-17: without an authentication event id, /connections lists
    // every organisation this app was ever authorised for, so the most
    // recently updated one is not necessarily the one just chosen.
    if (!xeroAuthEventId(token.access_token) && connections.length > 1) {
      return redirectWithError(request, "ambiguous_organisation");
    }

    const connection = [...connections].sort(
      (a, b) => new Date(b.updatedDateUtc).getTime() - new Date(a.updatedDateUtc).getTime()
    )[0];

    const admin = createAdminClient();

    // Review ACC-17: one Xero organisation may back only one TMS tenant, or
    // two tenants' invoices would land in one ledger.
    const { data: otherTenants, error: duplicateError } = await admin
      .from("accounting_integrations")
      .select("id")
      .eq("provider", "xero")
      .eq("active", true)
      .eq("external_tenant_id", connection.tenantId)
      .neq("tenant_id", tenantId)
      .limit(1);

    if (duplicateError) {
      throw new Error(duplicateError.message);
    }

    if ((otherTenants ?? []).length > 0) {
      return redirectWithError(request, "organisation_in_use");
    }

    const { data: existingIntegration, error: integrationReadError } = await admin
      .from("accounting_integrations")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("provider", "xero")
      .maybeSingle();

    if (integrationReadError) {
      throw new Error(integrationReadError.message);
    }

    let integrationId: string;

    const integrationPayload = {
      tenant_id: tenantId,
      provider: "xero",
      display_name: "Xero",
      active: true,
      connection_status: "connected",
      external_tenant_id: connection.tenantId,
      external_tenant_name: connection.tenantName,
      connected_by: user.id,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existingIntegration) {
      integrationId = existingIntegration.id;

      const { error } = await admin
        .from("accounting_integrations")
        .update(integrationPayload)
        .eq("id", integrationId);

      if (error) {
        throw new Error(error.message);
      }
    } else {
      const { data, error } = await admin
        .from("accounting_integrations")
        .insert(integrationPayload)
        .select("id")
        .single();

      if (error) {
        throw new Error(error.message);
      }

      integrationId = data.id;
    }

    await saveXeroCredentials({
      tenantId,
      integrationId,
      token,
    });

    await admin.from("accounting_sync_log").insert({
      tenant_id: tenantId,
      integration_id: integrationId,
      entity_type: "connection",
      entity_id: null,
      direction: "outbound",
      action: "connect",
      status: "success",
      external_id: connection.tenantId,
      response_payload: {
        tenantName: connection.tenantName,
        tenantType: connection.tenantType,
      },
      initiated_by: user.id,
    });

    const response = NextResponse.redirect(
      accountsUrl(request, {
        xero: "connected",
      })
    );

    response.cookies.delete("xero_oauth_state");

    response.cookies.delete("xero_oauth_tenant");

    return response;
  } catch (error) {
    console.error("Xero OAuth callback failed:", error);

    return redirectWithError(request);
  }
}
