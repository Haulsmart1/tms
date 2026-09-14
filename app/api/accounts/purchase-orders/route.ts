import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenantAccess } from "../../../../lib/accounts/server";
import { AccountsHttpError, readJsonObject } from "../../../../lib/accounts/errors";
import { assertTenantRow } from "../../../../lib/accounts/ownership";
import { isIsoDate } from "../../../../lib/accounts/payments";

export const dynamic = "force-dynamic";

function optionalDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!isIsoDate(text)) {
    throw new AccountsHttpError(400, `${label} must be a valid date.`, "invalid_date");
  }
  return text;
}

function optionalMoney(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AccountsHttpError(400, `${label} must be a number of zero or more.`, "invalid_amount");
  }
  return Math.round(parsed * 100) / 100;
}

function currencyCode(value: unknown): string {
  if (value === null || value === undefined || value === "") return "GBP";
  const code = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new AccountsHttpError(400, "Currency must be a three-letter code.", "invalid_currency");
  }
  return code;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

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
    const body = await readJsonObject(request);
    const tenantId = String(body.tenantId ?? "").trim();
    const type = body.type === "supplier" ? "supplier" : "customer";
    const poNumber = boundedText(body.poNumber, 100);

    if (!tenantId || !poNumber) {
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

      // Review ACC-14: the customer must belong to this tenant.
      const customerId = await assertTenantRow(admin, "customers", body.customerId, tenantId, "Customer");

      const { data, error } = await admin
        .from("customer_purchase_orders")
        .insert({
          tenant_id: tenantId,
          customer_id: customerId,
          po_number: poNumber,
          issue_date: optionalDate(body.issueDate, "Issue date"),
          expiry_date: optionalDate(body.expiryDate, "Expiry date"),
          description: boundedText(body.description, 2000),
          authorised_value: optionalMoney(body.authorisedValue, "Authorised value"),
          currency: currencyCode(body.currency),
          status: boundedText(body.status, 30) || "open",
          created_by: user.id,
        })
        .select("id")
        .single();

      if (error) throw new Error(error.message);

      return NextResponse.json({ ok: true, purchaseOrderId: data.id }, { status: 201 });
    }

    // Review ACC-14: an optional subcontractor must belong to this tenant.
    const subcontractorId = body.subcontractorId
      ? await assertTenantRow(admin, "subcontractors", body.subcontractorId, tenantId, "Subcontractor")
      : null;

    const { data, error } = await admin
      .from("supplier_purchase_orders")
      .insert({
        tenant_id: tenantId,
        subcontractor_id: subcontractorId,
        po_number: poNumber,
        status: boundedText(body.status, 30) || "draft",
        issue_date: optionalDate(body.issueDate, "Issue date") ?? new Date().toISOString().slice(0, 10),
        required_date: optionalDate(body.requiredDate, "Required date"),
        description: boundedText(body.description, 2000),
        subtotal: optionalMoney(body.subtotal, "Subtotal") ?? 0,
        vat_total: optionalMoney(body.vatTotal, "VAT total") ?? 0,
        total: optionalMoney(body.total, "Total") ?? 0,
        currency: currencyCode(body.currency),
        notes: boundedText(body.notes, 4000),
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
