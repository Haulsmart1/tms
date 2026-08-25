import { NextRequest, NextResponse } from "next/server";
import { ACCOUNTS_ADMIN_ROLES, errorResponse, requireTenantAccess } from "../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

const PROVIDERS = new Set([
  "xero",
  "quickbooks",
  "sage",
  "freeagent",
  "csv",
  "manual",
]);

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId);

    const { data, error } = await admin
      .from("accounting_integrations")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("provider");

    if (error) throw new Error(error.message);

    return NextResponse.json({ integrations: data ?? [] });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenantId = String(body.tenantId ?? "").trim();
    const provider = String(body.provider ?? "").trim().toLowerCase();

    if (!tenantId || !PROVIDERS.has(provider)) {
      return NextResponse.json(
        { error: "Choose a supported accounting provider." },
        { status: 400 }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId, ACCOUNTS_ADMIN_ROLES);

    const payload = {
      tenant_id: tenantId,
      provider,
      display_name: body.displayName || provider,
      active: body.active !== false,
      connection_status:
        provider === "csv" || provider === "manual"
          ? "available"
          : body.connectionStatus || "not_connected",
      external_tenant_id: body.externalTenantId || null,
      external_tenant_name: body.externalTenantName || null,
      default_sales_account_code: body.defaultSalesAccountCode || null,
      default_purchase_account_code: body.defaultPurchaseAccountCode || null,
      default_tax_code: body.defaultTaxCode || null,
      default_currency: body.defaultCurrency || "GBP",
      settings: body.settings || {},
      connected_by: user.id,
      connected_at:
        body.connectionStatus === "connected" ? new Date().toISOString() : null,
    };

    const { data: existing, error: existingError } = await admin
      .from("accounting_integrations")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);

    if (existing) {
      const { error } = await admin
        .from("accounting_integrations")
        .update(payload)
        .eq("id", existing.id);

      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("accounting_integrations").insert(payload);
      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
