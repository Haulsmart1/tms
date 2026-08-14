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
      .from("customer_payments")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("payment_date", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ payments: data ?? [] });
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
    const amount = Number(body.amount ?? 0);

    if (!tenantId || !customerId || amount <= 0) {
      return NextResponse.json(
        { error: "tenantId, customerId and a positive amount are required." },
        { status: 400 }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const { data: payment, error } = await admin
      .from("customer_payments")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        payment_date: body.paymentDate || new Date().toISOString().slice(0, 10),
        amount,
        currency: body.currency || "GBP",
        payment_method: body.paymentMethod || null,
        payment_reference: body.paymentReference || null,
        bank_reference: body.bankReference || null,
        notes: body.notes || null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    if (body.invoiceId && Number(body.allocateAmount ?? amount) > 0) {
      const { error: allocationError } = await admin
        .from("payment_allocations")
        .insert({
          tenant_id: tenantId,
          payment_id: payment.id,
          invoice_id: body.invoiceId,
          amount: Number(body.allocateAmount ?? amount),
          allocated_by: user.id,
        });

      if (allocationError) throw new Error(allocationError.message);
    }

    return NextResponse.json({ ok: true, paymentId: payment.id }, { status: 201 });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
