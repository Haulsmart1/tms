import { NextRequest, NextResponse } from "next/server";
import { ACCOUNTS_ADMIN_ROLES, errorResponse, requireTenantAccess } from "../../../../lib/accounts/server";
import { AccountsHttpError, readJsonObject } from "../../../../lib/accounts/errors";
import { parseTaxTypeMap } from "../../../../lib/accounts/xeroTax";

export const dynamic = "force-dynamic";

const PROVIDERS = new Set([
  "xero",
  "quickbooks",
  "sage",
  "freeagent",
  "csv",
  "manual",
]);

function code(value: unknown, max = 40): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new AccountsHttpError(400, "Account and tax codes must be text.", "invalid_code");
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new AccountsHttpError(400, "Account or tax code is too long.", "invalid_code");
  }
  return trimmed || null;
}

function currency(value: unknown): string {
  if (value === null || value === undefined || value === "") return "GBP";
  const text = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(text)) {
    throw new AccountsHttpError(400, "Currency must be a three-letter code.", "invalid_currency");
  }
  return text;
}

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

/*
  Review ACC-16: this route saves provider CONFIGURATION only. A connection
  (connection_status "connected", external organisation id, connected_at) is
  written exclusively by the provider's OAuth callback, so it can no longer be
  faked here, and saving account codes no longer wipes an existing connection.
*/
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const tenantId = String(body.tenantId ?? "").trim();
    const provider = String(body.provider ?? "").trim().toLowerCase();

    if (!tenantId || !PROVIDERS.has(provider)) {
      return NextResponse.json(
        { error: "Choose a supported accounting provider." },
        { status: 400 }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId, ACCOUNTS_ADMIN_ROLES);

    if (body.connectionStatus === "connected") {
      throw new AccountsHttpError(
        400,
        "Connect an accounting provider through its sign-in flow, not by saving settings.",
        "connection_not_allowed"
      );
    }

    const { data: existing, error: existingError } = await admin
      .from("accounting_integrations")
      .select("id,settings")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);

    const displayName =
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim().slice(0, 100)
        : provider;

    const config: Record<string, unknown> = {
      display_name: displayName,
      default_sales_account_code: code(body.defaultSalesAccountCode),
      default_purchase_account_code: code(body.defaultPurchaseAccountCode),
      default_tax_code: code(body.defaultTaxCode),
      default_currency: currency(body.defaultCurrency),
      updated_at: new Date().toISOString(),
    };

    const existingSettings =
      existing?.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
        ? (existing.settings as Record<string, unknown>)
        : {};

    const requestedSettings =
      body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
        ? (body.settings as Record<string, unknown>)
        : null;

    if (requestedSettings) {
      if (provider === "xero") {
        // Only the per-rate tax mapping is configurable for Xero (review ACC-6).
        config.settings = {
          ...existingSettings,
          xeroTaxTypes: parseTaxTypeMap(requestedSettings),
        };
      } else {
        config.settings = requestedSettings;
      }
    }

    if (existing) {
      const { error } = await admin
        .from("accounting_integrations")
        .update(config)
        .eq("id", existing.id)
        .eq("tenant_id", tenantId);

      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("accounting_integrations").insert({
        ...config,
        tenant_id: tenantId,
        provider,
        active: true,
        connection_status:
          provider === "csv" || provider === "manual" ? "available" : "not_connected",
        external_tenant_id: null,
        external_tenant_name: null,
        settings: config.settings ?? {},
        connected_by: user.id,
        connected_at: null,
      });

      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
