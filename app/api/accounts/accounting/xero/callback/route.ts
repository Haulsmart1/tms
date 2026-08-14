import { NextRequest, NextResponse } from "next/server";
import {
  createAdminClient,
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";
import {
  exchangeXeroCode,
  getXeroConnections,
  saveXeroCredentials,
} from "../../../../../../lib/accounts/providers/xero";

export const dynamic = "force-dynamic";

function accountsUrl(
  request: NextRequest,
  params: Record<string, string>
) {
  const url = new URL(
    "/invoices",
    request.url
  );

  url.searchParams.set(
    "accountsTab",
    "accounting"
  );

  Object.entries(params).forEach(
    ([key, value]) =>
      url.searchParams.set(key, value)
  );

  return url;
}

export async function GET(
  request: NextRequest
) {
  const state =
    request.nextUrl.searchParams.get("state");

  const code =
    request.nextUrl.searchParams.get("code");

  const xeroError =
    request.nextUrl.searchParams.get("error");

  const expectedState =
    request.cookies.get(
      "xero_oauth_state"
    )?.value;

  const tenantId =
    request.cookies.get(
      "xero_oauth_tenant"
    )?.value;

  if (
    xeroError ||
    !state ||
    !code ||
    !expectedState ||
    !tenantId ||
    state !== expectedState
  ) {
    return NextResponse.redirect(
      accountsUrl(request, {
        xero: "error",
      })
    );
  }

  try {
    const { user } =
      await requireTenantAccess(tenantId);

    const token =
      await exchangeXeroCode(code);

    const connections =
      await getXeroConnections(
        token.access_token
      );

    if (connections.length === 0) {
      throw new Error(
        "No Xero organisation was authorised."
      );
    }

    const connection =
      [...connections].sort(
        (a, b) =>
          new Date(
            b.updatedDateUtc
          ).getTime() -
          new Date(
            a.updatedDateUtc
          ).getTime()
      )[0];

    const admin = createAdminClient();

    const {
      data: existingIntegration,
      error: integrationReadError,
    } = await admin
      .from("accounting_integrations")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("provider", "xero")
      .maybeSingle();

    if (integrationReadError) {
      throw new Error(
        integrationReadError.message
      );
    }

    let integrationId: string;

    const integrationPayload = {
      tenant_id: tenantId,
      provider: "xero",
      display_name: "Xero",
      active: true,
      connection_status: "connected",
      external_tenant_id:
        connection.tenantId,
      external_tenant_name:
        connection.tenantName,
      connected_by: user.id,
      connected_at:
        new Date().toISOString(),
      updated_at:
        new Date().toISOString(),
    };

    if (existingIntegration) {
      integrationId =
        existingIntegration.id;

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

    await admin
      .from("accounting_sync_log")
      .insert({
        tenant_id: tenantId,
        integration_id: integrationId,
        entity_type: "connection",
        entity_id: null,
        direction: "outbound",
        action: "connect",
        status: "success",
        external_id:
          connection.tenantId,
        response_payload: {
          tenantName:
            connection.tenantName,
          tenantType:
            connection.tenantType,
        },
        initiated_by: user.id,
      });

    const response =
      NextResponse.redirect(
        accountsUrl(request, {
          xero: "connected",
        })
      );

    response.cookies.delete(
      "xero_oauth_state"
    );

    response.cookies.delete(
      "xero_oauth_tenant"
    );

    return response;
  } catch (error) {
    console.error(
      "Xero OAuth callback failed:",
      error
    );

    return NextResponse.redirect(
      accountsUrl(request, {
        xero: "error",
      })
    );
  }
}
