import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireTenantAccess,
} from "../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId is required." },
        { status: 400 }
      );
    }

    const { admin } = await requireTenantAccess(tenantId);

    const [
      customersResult,
      invoicesResult,
      subcontractorsResult,
    ] = await Promise.all([
      admin
        .from("customers")
        .select(
          "id,name,accounts_email,account_code,currency_code,payment_terms_days,requires_po,pod_required,invoice_pod_attachment_required,vat_rate,credit_status,credit_hold"
        )
        .eq("tenant_id", tenantId)
        .order("name"),

      admin
        .from("invoices")
        .select(
          "id,customer_id,invoice_number,status,issue_date,due_date,total,balance_due,currency"
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),

      admin
        .from("subcontractors")
        .select("id,name,active")
        .eq("tenant_id", tenantId)
        .eq("active", true)
        .order("name"),
    ]);

    const firstError =
      customersResult.error ||
      invoicesResult.error ||
      subcontractorsResult.error;

    if (firstError) {
      throw new Error(firstError.message);
    }

    return NextResponse.json({
      customers: customersResult.data ?? [],
      invoices: invoicesResult.data ?? [],
      subcontractors: subcontractorsResult.data ?? [],
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      { status: result.status }
    );
  }
}
