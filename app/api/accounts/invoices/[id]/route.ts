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

    const linkedJobIds = (jobsResult.data ?? [])
      .map((row) => row.job_id)
      .filter(Boolean);

    let jobDetails: Array<{
      job_id: string;
      reference: string | null;
      external_reference: string | null;
      pod_status: string | null;
    }> = [];

    if (linkedJobIds.length > 0) {
      const { data: jobs, error: jobDetailError } = await admin
        .from("jobs")
        .select("id,reference,external_reference,pod_status")
        .eq("tenant_id", tenantId)
        .in("id", linkedJobIds);

      if (jobDetailError) {
        throw new Error(jobDetailError.message);
      }

      jobDetails = (jobs ?? []).map((job) => ({
        job_id: job.id,
        reference: job.reference ?? null,
        external_reference: job.external_reference ?? null,
        pod_status: job.pod_status ?? null,
      }));
    }

    return NextResponse.json({
      invoice: invoiceResult.data,
      lines: linesResult.data ?? [],
      jobs: jobDetails,
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

    const { data: currentInvoice, error: currentInvoiceError } = await admin
      .from("invoices")
      .select("id,status,accounting_sync_status")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (currentInvoiceError) {
      throw new Error(currentInvoiceError.message);
    }

    if (!currentInvoice) {
      return NextResponse.json(
        { error: "Invoice not found." },
        { status: 404 }
      );
    }

    const lockedStatuses = new Set([
      "sent",
      "paid",
      "void",
      "credited",
    ]);

    if (
      Array.isArray(body.lines) &&
      lockedStatuses.has(
        String(currentInvoice.status ?? "").toLowerCase()
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Sent, paid, void or credited invoices cannot have their values edited.",
        },
        {
          status: 409,
        }
      );
    }

    if (Array.isArray(body.lines)) {
      for (const rawLine of body.lines) {
        const lineId =
          String(rawLine.id ?? "").trim();

        const quantity =
          Number(rawLine.quantity);

        const unitPrice =
          Number(rawLine.unit_price);

        const vatRate =
          Number(rawLine.vat_rate);

        if (
          !lineId ||
          !Number.isFinite(quantity) ||
          quantity <= 0 ||
          !Number.isFinite(unitPrice) ||
          unitPrice < 0 ||
          !Number.isFinite(vatRate) ||
          vatRate < 0
        ) {
          return NextResponse.json(
            {
              error:
                "Invalid invoice line values.",
            },
            {
              status: 400,
            }
          );
        }

        const { error: lineError } = await admin
          .from("invoice_lines")
          .update({
            description:
              String(
                rawLine.description ?? ""
              ).trim() ||
              "Transport service",
            quantity,
            unit_price: unitPrice,
            vat_rate: vatRate,
          })
          .eq("id", lineId)
          .eq("invoice_id", id)
          .eq("tenant_id", tenantId);

        if (lineError) {
          throw new Error(
            lineError.message
          );
        }
      }

      const {
        error: recalculateError,
      } = await admin.rpc(
        "recalculate_invoice_totals",
        {
          p_invoice_id: id,
        }
      );

      if (recalculateError) {
        throw new Error(
          recalculateError.message
        );
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
