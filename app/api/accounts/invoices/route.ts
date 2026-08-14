import { NextRequest, NextResponse } from "next/server";
import { errorResponse, requireTenantAccess } from "../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

type CreateInvoiceBody = {
  tenantId?: string;
  customerId?: string;
  jobIds?: string[];
  issueDate?: string;
  dueDate?: string;
  invoiceNumber?: string;
  poReference?: string;
  notes?: string;
};

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId);

    const { data, error } = await admin
      .from("invoices")
      .select(
        "id,tenant_id,customer_id,invoice_number,status,issue_date,due_date,subtotal,vat_total,total,amount_paid,credit_total,balance_due,currency,po_reference,customer_reference,notes,accounting_provider,accounting_invoice_id,accounting_sync_status,accounting_synced_at,accounting_sync_error,created_at,updated_at"
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const customerIds = Array.from(
      new Set((data ?? []).map((row) => row.customer_id).filter(Boolean))
    );

    let customers = new Map<string, { id: string; name: string }>();

    if (customerIds.length > 0) {
      const { data: customerRows, error: customerError } = await admin
        .from("customers")
        .select("id,name")
        .in("id", customerIds);

      if (customerError) throw new Error(customerError.message);

      customers = new Map((customerRows ?? []).map((row) => [row.id, row]));
    }

    return NextResponse.json({
      invoices: (data ?? []).map((invoice) => ({
        ...invoice,
        customer_name: invoice.customer_id
          ? customers.get(invoice.customer_id)?.name ?? null
          : null,
      })),
    });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateInvoiceBody;
    const tenantId = body.tenantId?.trim();
    const customerId = body.customerId?.trim();
    const jobIds = Array.from(new Set(body.jobIds ?? []));

    if (!tenantId || !customerId || jobIds.length === 0) {
      return NextResponse.json(
        { error: "tenantId, customerId and at least one job are required." },
        { status: 400 }
      );
    }

    const { admin, user } = await requireTenantAccess(tenantId);

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select(
        "id,name,payment_terms_days,currency_code,vat_rate,requires_po,pod_required,invoice_pod_attachment_required,accounts_email"
      )
      .eq("id", customerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (customerError) throw new Error(customerError.message);
    if (!customer) {
      return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    }

    const { data: jobs, error: jobsError } = await admin
      .from("jobs")
      .select("id,customer_id,reference,customer_price,pod_status,completed_at")
      .eq("tenant_id", tenantId)
      .in("id", jobIds);

    if (jobsError) throw new Error(jobsError.message);

    if ((jobs ?? []).length !== jobIds.length) {
      return NextResponse.json(
        { error: "One or more selected jobs were not found." },
        { status: 400 }
      );
    }

    if ((jobs ?? []).some((job) => job.customer_id !== customerId)) {
      return NextResponse.json(
        { error: "All jobs on an invoice must belong to the same customer." },
        { status: 409 }
      );
    }

    const { data: existingInvoiceJobs, error: duplicateError } = await admin
      .from("invoice_jobs")
      .select("job_id")
      .in("job_id", jobIds)
      .eq("active", true);

    if (duplicateError) throw new Error(duplicateError.message);

    if ((existingInvoiceJobs ?? []).length > 0) {
      return NextResponse.json(
        { error: "One or more selected jobs have already been invoiced." },
        { status: 409 }
      );
    }

    const requiresPod = customer.pod_required === true;
    const requiresAttachment = customer.invoice_pod_attachment_required === true;
    const podBlocked = (jobs ?? []).some((job) => {
      const status = String(job.pod_status ?? "").toLowerCase();
      return requiresPod && !["complete", "completed", "approved", "received"].includes(status);
    });

    const issueDate = body.issueDate || new Date().toISOString().slice(0, 10);

    const due = body.dueDate
      ? new Date(`${body.dueDate}T00:00:00`)
      : new Date(`${issueDate}T00:00:00`);

    if (!body.dueDate) {
      due.setDate(due.getDate() + Number(customer.payment_terms_days ?? 30));
    }

    const invoiceNumber =
      body.invoiceNumber?.trim() ||
      `INV-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;

    const status = podBlocked ? "awaiting_pod" : "draft";

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        invoice_number: invoiceNumber,
        status,
        issue_date: issueDate,
        due_date: due.toISOString().slice(0, 10),
        currency: customer.currency_code || "GBP",
        po_reference: body.poReference?.trim() || null,
        notes: body.notes?.trim() || null,
        invoice_email: customer.accounts_email || null,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (invoiceError) throw new Error(invoiceError.message);

    const vatRate = Number(customer.vat_rate ?? 20);

    const lineRows = (jobs ?? []).map((job, index) => ({
      tenant_id: tenantId,
      invoice_id: invoice.id,
      job_id: job.id,
      line_number: index + 1,
      description: `Transport job ${job.reference || job.id}`,
      quantity: 1,
      unit_price: Number(job.customer_price ?? 0),
      vat_rate: vatRate,
    }));

    const { error: linesError } = await admin.from("invoice_lines").insert(lineRows);
    if (linesError) throw new Error(linesError.message);

    const invoiceJobRows = (jobs ?? []).map((job) => ({
      tenant_id: tenantId,
      invoice_id: invoice.id,
      job_id: job.id,
      pod_required: requiresPod,
      pod_status: job.pod_status || null,
      pod_attached: requiresAttachment ? false : !requiresPod,
      po_required: customer.requires_po === true,
      po_reference: body.poReference?.trim() || null,
      active: true,
    }));

    const { error: invoiceJobsError } = await admin
      .from("invoice_jobs")
      .insert(invoiceJobRows);

    if (invoiceJobsError) throw new Error(invoiceJobsError.message);

    await admin.rpc("recalculate_invoice_totals", {
      p_invoice_id: invoice.id,
    });

    return NextResponse.json({ ok: true, invoiceId: invoice.id }, { status: 201 });
  } catch (error) {
    const result = errorResponse(error);
    return NextResponse.json(result.body, { status: result.status });
  }
}
