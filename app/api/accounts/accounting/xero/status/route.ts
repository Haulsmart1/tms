import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";

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

    const { admin } =
      await requireTenantAccess(tenantId);

    const { data, error } = await admin
      .from("accounting_integrations")
      .select(
        "id,provider,display_name,active,connection_status,external_tenant_id,external_tenant_name,default_sales_account_code,default_purchase_account_code,default_tax_code,default_currency,connected_at,last_sync_at,updated_at"
      )
      .eq("tenant_id", tenantId)
      .eq("provider", "xero")
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      connected:
        data?.connection_status ===
          "connected" &&
        data?.active === true,
      integration: data ?? null,
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      { status: result.status }
    );
  }
}
