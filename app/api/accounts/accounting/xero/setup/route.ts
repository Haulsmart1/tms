import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";
import {
  getValidXeroAccessToken,
} from "../../../../../../lib/accounts/providers/xero";

export const dynamic = "force-dynamic";

const XERO_API = "https://api.xero.com/api.xro/2.0";

type XeroAccount = {
  AccountID?: string;
  Code?: string;
  Name?: string;
  Type?: string;
  Status?: string;
  TaxType?: string;
  EnablePaymentsToAccount?: boolean;
};

type XeroTaxRate = {
  Name?: string;
  TaxType?: string;
  Status?: string;
  EffectiveRate?: number;
  DisplayTaxRate?: number;
};

function headers(
  accessToken: string,
  xeroTenantId: string
): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Xero-tenant-id": xeroTenantId,
    Accept: "application/json",
  };
}

function xeroError(
  payload: unknown,
  fallback: string
): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;

  const message = String(
    record.Message ??
      record.ErrorNumber ??
      ""
  ).trim();

  return message || fallback;
}

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
        {
          error: "tenantId is required.",
        },
        {
          status: 400,
        }
      );
    }

    const {
      admin,
    } = await requireTenantAccess(
      tenantId
    );

    const {
      data: integration,
      error: integrationError,
    } = await admin
      .from("accounting_integrations")
      .select(
        "id,provider,active,connection_status,external_tenant_id,external_tenant_name,default_sales_account_code,default_tax_code"
      )
      .eq("tenant_id", tenantId)
      .eq("provider", "xero")
      .eq("active", true)
      .eq(
        "connection_status",
        "connected"
      )
      .maybeSingle();

    if (integrationError) {
      throw new Error(
        integrationError.message
      );
    }

    if (
      !integration?.id ||
      !integration.external_tenant_id
    ) {
      return NextResponse.json(
        {
          error:
            "Xero is not connected for this tenant.",
        },
        {
          status: 409,
        }
      );
    }

    const accessToken =
      await getValidXeroAccessToken(
        integration.id
      );

    const requestHeaders =
      headers(
        accessToken,
        integration.external_tenant_id
      );

    const [
      accountsResponse,
      taxRatesResponse,
    ] = await Promise.all([
      fetch(
        `${XERO_API}/Accounts`,
        {
          headers: requestHeaders,
          cache: "no-store",
        }
      ),

      fetch(
        `${XERO_API}/TaxRates`,
        {
          headers: requestHeaders,
          cache: "no-store",
        }
      ),
    ]);

    const [
      accountsPayload,
      taxRatesPayload,
    ] = await Promise.all([
      accountsResponse.json(),
      taxRatesResponse.json(),
    ]);

    if (!accountsResponse.ok) {
      throw new Error(
        xeroError(
          accountsPayload,
          `Unable to retrieve Xero accounts (${accountsResponse.status}).`
        )
      );
    }

    if (!taxRatesResponse.ok) {
      throw new Error(
        xeroError(
          taxRatesPayload,
          `Unable to retrieve Xero tax rates (${taxRatesResponse.status}).`
        )
      );
    }

    const accounts: XeroAccount[] =
      Array.isArray(
        accountsPayload?.Accounts
      )
        ? accountsPayload.Accounts
        : [];

    const taxRates: XeroTaxRate[] =
      Array.isArray(
        taxRatesPayload?.TaxRates
      )
        ? taxRatesPayload.TaxRates
        : [];

    const revenueTypes = new Set([
      "REVENUE",
      "SALES",
      "OTHERINCOME",
    ]);

    const salesAccounts =
      accounts
        .filter((account) => {
          const status = String(
            account.Status ?? ""
          ).toUpperCase();

          const type = String(
            account.Type ?? ""
          ).toUpperCase();

          return (
            status === "ACTIVE" &&
            revenueTypes.has(type)
          );
        })
        .map((account) => ({
          accountId:
            account.AccountID ?? null,
          code:
            account.Code ?? null,
          name:
            account.Name ?? null,
          type:
            account.Type ?? null,
          taxType:
            account.TaxType ?? null,
        }))
        .sort((a, b) => {
          const codeCompare =
            String(a.code ?? "")
              .localeCompare(
                String(b.code ?? ""),
                undefined,
                {
                  numeric: true,
                }
              );

          if (codeCompare !== 0) {
            return codeCompare;
          }

          return String(
            a.name ?? ""
          ).localeCompare(
            String(b.name ?? "")
          );
        });

    const activeTaxRates =
      taxRates
        .filter((taxRate) => {
          const status = String(
            taxRate.Status ?? ""
          ).toUpperCase();

          return status === "ACTIVE";
        })
        .map((taxRate) => ({
          name:
            taxRate.Name ?? null,
          taxType:
            taxRate.TaxType ?? null,
          effectiveRate:
            taxRate.EffectiveRate ??
            null,
          displayTaxRate:
            taxRate.DisplayTaxRate ??
            null,
        }))
        .sort((a, b) =>
          String(
            a.name ?? ""
          ).localeCompare(
            String(b.name ?? "")
          )
        );

    return NextResponse.json({
      ok: true,

      organisation: {
        tenantId:
          integration.external_tenant_id,
        name:
          integration.external_tenant_name ??
          null,
      },

      configured: {
        salesAccountCode:
          integration.default_sales_account_code ??
          null,

        taxCode:
          integration.default_tax_code ??
          null,
      },

      salesAccounts,

      taxRates:
        activeTaxRates,
    });
  } catch (error) {
    const result =
      errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status:
          result.status,
      }
    );
  }
}