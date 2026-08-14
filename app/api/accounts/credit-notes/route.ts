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
      .from("credit_notes")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ creditNotes: data ?? [] });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenantId = String(body.tenantId ?? "").trim();
    const invoiceId = String(body.invoiceId ?? "").trim();
    const amount = Number(body.amount ?? 0);

    if (!tenantId || !invoiceId || amount <= 0) {
      return NextResponse.json(
        { error: "tenantId, invoiceId and positive amount are required." },
        { status: 400 }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("id,customer_id,currency")
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (invoiceError) throw new Error(invoiceError.message);
    if (!invoice?.customer_id) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    const creditNumber =
      body.creditNoteNumber ||
      `CN-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;

    const { data: credit, error } = await admin
      .from("credit_notes")
      .insert({
        tenant_id: tenantId,
        customer_id: invoice.customer_id,
        original_invoice_id: invoiceId,
        credit_note_number: creditNumber,
        status: "draft",
        issue_date: body.issueDate || new Date().toISOString().slice(0, 10),
        reason: body.reason || null,
        subtotal: amount,
        vat_total: 0,
        total: amount,
        currency: invoice.currency || "GBP",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    const { error: allocationError } = await admin
      .from("credit_note_allocations")
      .insert({
        tenant_id: tenantId,
        credit_note_id: credit.id,
        invoice_id: invoiceId,
        amount,
        allocated_by: user.id,
      });

    if (allocationError) throw new Error(allocationError.message);

    return NextResponse.json({ ok: true, creditNoteId: credit.id }, { status: 201 });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
