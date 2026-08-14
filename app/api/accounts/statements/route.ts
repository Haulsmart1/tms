import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenantAccess } from "../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId);
    const { data, error } = await admin
      .from("customer_statements")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("statement_date", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ statements: data ?? [] });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenantId = String(body.tenantId ?? "").trim();
    const customerId = String(body.customerId ?? "").trim();

    if (!tenantId || !customerId) {
      return NextResponse.json(
        { error: "tenantId and customerId are required." },
        { status: 400 }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const { data: debt, error: debtError } = await admin
      .from("customer_aged_debt")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("customer_id", customerId)
      .maybeSingle();

    if (debtError) throw new Error(debtError.message);

    const { data: statement, error } = await admin
      .from("customer_statements")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        statement_number:
          body.statementNumber ||
          `STM-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`,
        statement_date: body.statementDate || new Date().toISOString().slice(0, 10),
        period_start: body.periodStart || null,
        period_end: body.periodEnd || null,
        opening_balance: 0,
        invoice_total: Number(debt?.total_outstanding ?? 0),
        closing_balance: Number(debt?.total_outstanding ?? 0),
        current_balance: Number(debt?.current_balance ?? 0),
        days_1_30: Number(debt?.days_1_30 ?? 0),
        days_31_60: Number(debt?.days_31_60 ?? 0),
        days_61_90: Number(debt?.days_61_90 ?? 0),
        days_90_plus: Number(debt?.days_90_plus ?? 0),
        status: "draft",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, statementId: statement.id }, { status: 201 });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
