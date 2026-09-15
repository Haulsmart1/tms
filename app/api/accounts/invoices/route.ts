import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenantAccess } from "../../../../lib/accounts/server";
import { AccountsHttpError, readJsonObject, rpcFailure, type RpcMessages } from "../../../../lib/accounts/errors";
import { parseCreateInvoice } from "../../../../lib/accounts/invoiceRequests";
import { operatorDay } from "../../../../lib/time";
import { listPageInfo, parseListPage } from "../../../../lib/accounts/listPaging";
import {
  addInvoiceTotals,
  emptyInvoiceTotals,
  finishInvoiceTotals,
  NOT_OUTSTANDING_INVOICE_STATUSES,
  type InvoiceTotals,
} from "../../../../lib/invoices/totals";

export const dynamic = "force-dynamic";

/*
  Invoice creation runs in one transaction (docs/sql/prodfix_41): per-job
  locks, the "already invoiced" check, number allocation, invoice, lines,
  invoice_jobs and the totals recalculation either all happen or none do
  (review ACC-9, INV-9).
*/
const CREATE_MESSAGES: RpcMessages = {
  invoice_invalid: [400, "The invoice details are not valid."],
  no_jobs: [400, "Select at least one job."],
  customer_not_found: [404, "Customer not found."],
  jobs_not_found: [400, "One or more selected jobs were not found."],
  jobs_mixed_customer: [409, "All jobs on an invoice must belong to the same customer."],
  jobs_already_invoiced: [409, "One or more selected jobs have already been invoiced."],
  invoice_number_empty: [500, "Invoice number allocation failed. Please try again."],
  invoice_number_taken: [409, "The next invoice number is already in use. Please try again."],
};

/*
  INV-11: one explicit page (?page, ?pageSize) with the exact total, plus
  outstanding and overdue totals across EVERY matching invoice on page 1, so
  neither the list nor the KPIs are silently capped by PostgREST's max_rows.
*/
const TOTALS_BATCH_SIZE = 1000;

async function loadInvoiceTotals(
  admin: Awaited<ReturnType<typeof requireTenantAccess>>["admin"],
  tenantId: string
): Promise<InvoiceTotals> {
  const today = operatorDay(new Date());
  const totals = emptyInvoiceTotals();
  const excluded = `(${NOT_OUTSTANDING_INVOICE_STATUSES.join(",")})`;

  for (let from = 0; ; from += TOTALS_BATCH_SIZE) {
    const { data, error } = await admin
      .from("invoices")
      .select("id,status,due_date,balance_due")
      .eq("tenant_id", tenantId)
      .gt("balance_due", 0)
      .not("status", "in", excluded)
      .order("id", { ascending: true })
      .range(from, from + TOTALS_BATCH_SIZE - 1);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    addInvoiceTotals(totals, rows, today);

    if (rows.length < TOTALS_BATCH_SIZE) break;
  }

  return finishInvoiceTotals(totals);
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId);
    const page = parseListPage(request.nextUrl.searchParams);

    const { data, error, count } = await admin
      .from("invoices")
      .select(
        "id,tenant_id,customer_id,invoice_number,status,issue_date,due_date,subtotal,vat_total,total,amount_paid,credit_total,balance_due,currency,po_reference,customer_reference,notes,accounting_provider,accounting_invoice_id,accounting_sync_status,accounting_synced_at,accounting_sync_error,sent_at,created_at,updated_at",
        { count: "exact" }
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page.from, page.to);

    if (error) throw new Error(error.message);

    const customerIds = Array.from(
      new Set((data ?? []).map((row) => row.customer_id).filter(Boolean))
    );

    let customers = new Map<string, { id: string; name: string }>();

    if (customerIds.length > 0) {
      const { data: customerRows, error: customerError } = await admin
        .from("customers")
        .select("id,name")
        .eq("tenant_id", tenantId)
        .in("id", customerIds);

      if (customerError) throw new Error(customerError.message);

      customers = new Map((customerRows ?? []).map((row) => [row.id, row]));
    }

    // Totals do not depend on the page, so only the first page pays for them.
    const totals = page.page === 1 ? await loadInvoiceTotals(admin, tenantId) : null;

    return NextResponse.json({
      invoices: (data ?? []).map((invoice) => ({
        ...invoice,
        customer_name: invoice.customer_id
          ? customers.get(invoice.customer_id)?.name ?? null
          : null,
      })),
      pagination: listPageInfo(page, count, (data ?? []).length),
      totals,
    });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const tenantId = String(body.tenantId ?? "").trim();

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId, customerId and at least one job are required." },
        { status: 400 }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const parsed = parseCreateInvoice(body, operatorDay(new Date()));
    if (!parsed.ok) {
      throw new AccountsHttpError(400, parsed.message, parsed.code);
    }

    const input = parsed.value;

    const { data: invoiceId, error } = await admin.rpc("accounts_create_invoice_from_jobs", {
      p_tenant_id: tenantId,
      p_customer_id: input.customerId,
      p_user_id: user.id,
      p_job_ids: input.jobIds,
      p_issue_date: input.issueDate,
      p_due_date: input.dueDate,
      p_po_reference: input.poReference,
      p_notes: input.notes,
    });

    if (error) {
      throw rpcFailure(error, CREATE_MESSAGES, "prodfix_41_accounts_invoice_create.sql");
    }

    if (!invoiceId) {
      throw new Error("accounts_create_invoice_from_jobs returned no id");
    }

    return NextResponse.json({ ok: true, invoiceId }, { status: 201 });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
