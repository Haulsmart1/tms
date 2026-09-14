import { NextRequest, NextResponse } from "next/server";
import {
  ACCOUNTS_ADMIN_ROLES,
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";
import { readJsonObject } from "../../../../../../lib/accounts/errors";
import { getValidXeroAccessToken } from "../../../../../../lib/accounts/providers/xero";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);

    const tenantId = String(body.tenantId ?? "").trim();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin, user } = await requireTenantAccess(tenantId, ACCOUNTS_ADMIN_ROLES);

    const { data: integration, error } = await admin
      .from("accounting_integrations")
      .select("id,external_tenant_id")
      .eq("tenant_id", tenantId)
      .eq("provider", "xero")
      .eq("connection_status", "connected")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!integration?.external_tenant_id) {
      return NextResponse.json({ error: "Xero is not connected." }, { status: 409 });
    }

    const accessToken = await getValidXeroAccessToken(integration.id);

    const response = await fetch("https://api.xero.com/api.xro/2.0/Organisation", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": integration.external_tenant_id,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);

    // The full Xero response stays in the sync log for admins with database
    // access; the client only gets a status (review ACC-15).
    await admin.from("accounting_sync_log").insert({
      tenant_id: tenantId,
      integration_id: integration.id,
      entity_type: "connection",
      direction: "outbound",
      action: "test",
      status: response.ok ? "success" : "error",
      response_payload: payload,
      error_message: response.ok ? null : `Xero test failed (${response.status}).`,
      initiated_by: user.id,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `The Xero connection test failed (${response.status}). Reconnect Xero if this persists.`, code: "xero_test_failed" },
        { status: 502 }
      );
    }

    const organisation = payload?.Organisations?.[0] ?? null;

    return NextResponse.json({
      ok: true,
      organisation: organisation
        ? {
            Name: organisation.Name ?? null,
            LegalName: organisation.LegalName ?? null,
            BaseCurrency: organisation.BaseCurrency ?? null,
            CountryCode: organisation.CountryCode ?? null,
            OrganisationID: organisation.OrganisationID ?? null,
          }
        : null,
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(result.body, { status: result.status });
  }
}
