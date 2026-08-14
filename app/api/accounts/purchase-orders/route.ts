import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenantAccess } from "../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();
    const type = request.nextUrl.searchParams.get("type") || "customer";

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId);

    const table =
      type === "supplier"
        ? "supplier_purchase_orders"
        : "customer_purchase_orders";

    const { data, error } = await admin
      .from(table)
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({ purchaseOrders: data ?? [] });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenantId = String(body.tenantId ?? "").trim();
    const type = body.type === "supplier" ? "supplier" : "customer";

    if (!tenantId || !body.poNumber) {
      return NextResponse.json(
        { error: "tenantId and poNumber are required." },
        { status: 400 }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    if (type === "customer") {
      if (!body.customerId) {
        return NextResponse.json(
          { error: "customerId is required for customer POs." },
          { status: 400 }
        );
      }

      const { data, error } = await admin
        .from("customer_purchase_orders")
        .insert({
          tenant_id: tenantId,
          customer_id: body.customerId,
          po_number: body.poNumber,
          issue_date: body.issueDate || null,
          expiry_date: body.expiryDate || null,
          description: body.description || null,
          authorised_value:
            body.authorisedValue === "" || body.authorisedValue == null
              ? null
              : Number(body.authorisedValue),
          currency: body.currency || "GBP",
          status: body.status || "open",
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw new Error(error.message);

      return NextResponse.json({ ok: true, purchaseOrderId: data.id }, { status: 201 });
    }

    const { data, error } = await admin
      .from("supplier_purchase_orders")
      .insert({
        tenant_id: tenantId,
        subcontractor_id: body.subcontractorId || null,
        po_number: body.poNumber,
        status: body.status || "draft",
        issue_date: body.issueDate || new Date().toISOString().slice(0, 10),
        required_date: body.requiredDate || null,
        description: body.description || null,
        subtotal: Number(body.subtotal ?? 0),
        vat_total: Number(body.vatTotal ?? 0),
        total: Number(body.total ?? 0),
        currency: body.currency || "GBP",
        notes: body.notes || null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, purchaseOrderId: data.id }, { status: 201 });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
