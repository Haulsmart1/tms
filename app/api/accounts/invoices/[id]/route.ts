import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenantAccess } from "../../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();
    const { id } = await context.params;

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId);

    const [invoiceResult, linesResult, jobsResult, paymentsResult, creditsResult] =
      await Promise.all([
        admin
          .from("invoices")
          .select("*")
          .eq("id", id)
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        admin
          .from("invoice_lines")
          .select("*")
          .eq("invoice_id", id)
          .eq("tenant_id", tenantId)
          .order("line_number"),
        admin
          .from("invoice_jobs")
          .select("*")
          .eq("invoice_id", id)
          .eq("tenant_id", tenantId),
        admin
          .from("payment_allocations")
          .select("*")
          .eq("invoice_id", id)
          .eq("tenant_id", tenantId),
        admin
          .from("credit_note_allocations")
          .select("*")
          .eq("invoice_id", id)
          .eq("tenant_id", tenantId),
      ]);

    const error =
      invoiceResult.error ||
      linesResult.error ||
      jobsResult.error ||
      paymentsResult.error ||
      creditsResult.error;

    if (error) throw new Error(error.message);

    if (!invoiceResult.data) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    return NextResponse.json({
      invoice: invoiceResult.data,
      lines: linesResult.data ?? [],
      jobs: jobsResult.data ?? [],
      payments: paymentsResult.data ?? [],
      credits: creditsResult.data ?? [],
    });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const body = await request.json();
    const tenantId = String(body.tenantId ?? "").trim();
    const { id } = await context.params;

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const allowed = new Set([
      "status",
      "issue_date",
      "due_date",
      "po_reference",
      "customer_reference",
      "notes",
      "invoice_email",
      "accounting_provider",
      "accounting_invoice_id",
      "accounting_sync_status",
      "accounting_sync_error",
    ]);

    const patch: Record<string, unknown> = {};

    Object.entries(body).forEach(([key, value]) => {
      if (allowed.has(key)) patch[key] = value;
    });

    if (body.status === "approved") {
      patch.approved_by = user.id;
      patch.approved_at = new Date().toISOString();
    }

    if (body.status === "sent") {
      patch.sent_by = user.id;
      patch.sent_at = new Date().toISOString();
    }

    const { error } = await admin
      .from("invoices")
      .update(patch)
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
