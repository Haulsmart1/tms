import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenantAccess } from "../../../../../lib/accounts/server";
import { AccountsHttpError, readJsonObject, rpcFailure, type RpcMessages } from "../../../../../lib/accounts/errors";
import { canEditInvoiceValues, checkInvoiceTransition } from "../../../../../lib/accounts/invoiceStatus";
import { parseInvoicePatch } from "../../../../../lib/accounts/invoiceRequests";
import { isUuid } from "../../../../../lib/auth/serverTenantAccess";

export const dynamic = "force-dynamic";

const EDIT_MESSAGES: RpcMessages = {
  invoice_not_found: [404, "Invoice not found."],
  invoice_synced: [409, "This invoice has been posted to the accounting system and can no longer be edited."],
  invoice_locked: [409, "Only draft invoices can be edited. Reload to see its current status."],
  invoice_line_invalid: [400, "Invalid invoice line values."],
  invoice_line_not_found: [400, "One or more lines do not belong to this invoice."],
};

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

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

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

/*
  Review ACC-3, ACC-4, INV-8. Order matters and is deliberate:
    1. parse and validate the whole request (status and value edits cannot be
       mixed; server-only fields are refused; every line is validated);
    2. read the current invoice and apply the lock or transition rules;
    3. only then write. A status change is a conditional update on the status
       we read, so a concurrent change makes it fail instead of overwrite. A
       value edit goes through accounts_update_invoice_values
       (docs/sql/prodfix_43), which re-checks the lock under a row lock and
       writes header, lines and totals in one transaction.
*/
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const body = await readJsonObject(request);
    const tenantId = String(body.tenantId ?? "").trim();
    const { id } = await context.params;

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin, user, tier } = await requireTenantAccess(tenantId);

    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    const { tenantId: _tenantId, ...changes } = body;
    void _tenantId;

    const parsed = parseInvoicePatch(changes);
    if (!parsed.ok) {
      throw new AccountsHttpError(400, parsed.message, parsed.code);
    }

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("id,status,accounting_invoice_id,amount_paid,credit_total")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (invoiceError) throw new Error(invoiceError.message);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    if (parsed.value.kind === "status") {
      const to = parsed.value.status;
      const rule = checkInvoiceTransition({
        from: invoice.status,
        to,
        tier,
        accountingInvoiceId: invoice.accounting_invoice_id,
        amountPaid: Number(invoice.amount_paid ?? 0),
        creditTotal: Number(invoice.credit_total ?? 0),
      });

      if (!rule.ok) {
        throw new AccountsHttpError(rule.status, rule.message, rule.code);
      }

      const now = new Date().toISOString();
      const patch: Record<string, unknown> = { status: to, updated_at: now };

      if (to === "approved") {
        patch.approved_by = user.id;
        patch.approved_at = now;
      }

      let update = admin
        .from("invoices")
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .eq("status", invoice.status);

      if (!invoice.accounting_invoice_id) {
        update = update.is("accounting_invoice_id", null);
      }

      const { data: updated, error: updateError } = await update.select("id");

      if (updateError) throw new Error(updateError.message);

      if (!updated || updated.length === 0) {
        throw new AccountsHttpError(
          409,
          "The invoice changed while you were saving. Reload and try again.",
          "invoice_changed"
        );
      }

      return NextResponse.json({ ok: true, status: to });
    }

    const lock = canEditInvoiceValues({
      status: invoice.status,
      accountingInvoiceId: invoice.accounting_invoice_id,
    });

    if (!lock.ok) {
      throw new AccountsHttpError(lock.status, lock.message, lock.code);
    }

    const { error: editError } = await admin.rpc("accounts_update_invoice_values", {
      p_tenant_id: tenantId,
      p_invoice_id: id,
      p_header: parsed.value.header,
      p_lines: parsed.value.lines,
    });

    if (editError) {
      throw rpcFailure(editError, EDIT_MESSAGES, "prodfix_43_accounts_invoice_edit.sql");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
