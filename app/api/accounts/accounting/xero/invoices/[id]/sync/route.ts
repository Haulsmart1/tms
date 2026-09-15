import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ACCOUNTS_ADMIN_ROLES,
  errorResponse,
  requireTenantAccess,
} from "../../../../../../../../lib/accounts/server";
import { AccountsHttpError, readJsonObject } from "../../../../../../../../lib/accounts/errors";
import { getValidXeroAccessToken } from "../../../../../../../../lib/accounts/providers/xero";
import {
  expectedGrossTotal,
  parseTaxTypeMap,
  resolveXeroTaxType,
  totalsAgree,
  type XeroTaxRateInfo,
} from "../../../../../../../../lib/accounts/xeroTax";
import { isUuid } from "../../../../../../../../lib/auth/serverTenantAccess";

export const dynamic = "force-dynamic";

const XERO_API = "https://api.xero.com/api.xro/2.0";

/** A "syncing" claim older than this is treated as abandoned. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

type XeroContact = {
  ContactID?: string;
  Name?: string;
};

type XeroInvoice = {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Status?: string;
  Total?: number;
};

type AdminClient = Awaited<ReturnType<typeof requireTenantAccess>>["admin"];

function xeroHeaders(accessToken: string, xeroTenantId: string, idempotencyKey?: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Xero-tenant-id": xeroTenantId,
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

/** Xero's own validation messages, kept for the invoice's sync error and the log. */
function xeroErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const elements = Array.isArray(record.Elements) ? record.Elements : [];

  const validationMessages = elements.flatMap((element) => {
    if (!element || typeof element !== "object") {
      return [];
    }

    const validationErrors = (element as Record<string, unknown>).ValidationErrors;

    if (!Array.isArray(validationErrors)) {
      return [];
    }

    return validationErrors
      .map((validationError) =>
        validationError && typeof validationError === "object"
          ? String((validationError as Record<string, unknown>).Message ?? "").trim()
          : ""
      )
      .filter(Boolean);
  });

  if (validationMessages.length > 0) {
    return validationMessages.join("; ").slice(0, 1000);
  }

  const message = String(record.Message ?? record.ErrorNumber ?? "").trim();

  return (message || fallback).slice(0, 1000);
}

function escapeXeroWhereValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function idempotencyKey(prefix: string, id: string, payload: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
  return `tms-${prefix}-${id}-${digest}`.slice(0, 128);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function findOrCreateContact({
  accessToken,
  xeroTenantId,
  customerId,
  customerName,
  accountsEmail,
  accountCode,
}: {
  accessToken: string;
  xeroTenantId: string;
  customerId: string;
  customerName: string;
  accountsEmail: string | null;
  accountCode: string | null;
}): Promise<XeroContact> {
  const headers = xeroHeaders(accessToken, xeroTenantId);

  if (accountCode) {
    const where = `ContactNumber=="${escapeXeroWhereValue(accountCode)}"`;

    const response = await fetch(`${XERO_API}/Contacts?where=${encodeURIComponent(where)}`, {
      headers,
      cache: "no-store",
    });

    const payload = (await readJson(response)) as { Contacts?: XeroContact[] } | null;

    if (!response.ok) {
      throw new Error(xeroErrorMessage(payload, `Unable to search Xero contacts (${response.status}).`));
    }

    const existing = payload?.Contacts?.[0];

    if (existing?.ContactID) {
      return existing;
    }
  }

  const nameWhere = `Name=="${escapeXeroWhereValue(customerName)}"`;

  const nameResponse = await fetch(`${XERO_API}/Contacts?where=${encodeURIComponent(nameWhere)}`, {
    headers,
    cache: "no-store",
  });

  const namePayload = (await readJson(nameResponse)) as { Contacts?: XeroContact[] } | null;

  if (!nameResponse.ok) {
    throw new Error(xeroErrorMessage(namePayload, `Unable to search Xero contacts (${nameResponse.status}).`));
  }

  const namedContact = namePayload?.Contacts?.[0];

  if (namedContact?.ContactID) {
    return namedContact;
  }

  const contactPayload = {
    Contacts: [
      {
        Name: customerName,
        ...(accountCode ? { ContactNumber: accountCode } : {}),
        ...(accountsEmail ? { EmailAddress: accountsEmail } : {}),
      },
    ],
  };

  // Review ACC-7: an idempotency key stops two concurrent syncs creating two
  // copies of the same contact.
  const createResponse = await fetch(`${XERO_API}/Contacts`, {
    method: "POST",
    headers: xeroHeaders(accessToken, xeroTenantId, idempotencyKey("contact", customerId, contactPayload)),
    body: JSON.stringify(contactPayload),
    cache: "no-store",
  });

  const createdPayload = (await readJson(createResponse)) as { Contacts?: XeroContact[] } | null;

  if (!createResponse.ok) {
    throw new Error(xeroErrorMessage(createdPayload, `Unable to create Xero contact (${createResponse.status}).`));
  }

  const created = createdPayload?.Contacts?.[0];

  if (!created?.ContactID) {
    throw new Error("Xero created the contact but returned no ContactID.");
  }

  return created;
}

async function findExistingXeroInvoice({
  accessToken,
  xeroTenantId,
  invoiceNumber,
}: {
  accessToken: string;
  xeroTenantId: string;
  invoiceNumber: string;
}): Promise<XeroInvoice | null> {
  const where = `InvoiceNumber=="${escapeXeroWhereValue(invoiceNumber)}"`;

  const response = await fetch(`${XERO_API}/Invoices?where=${encodeURIComponent(where)}`, {
    headers: xeroHeaders(accessToken, xeroTenantId),
    cache: "no-store",
  });

  const payload = (await readJson(response)) as { Invoices?: XeroInvoice[] } | null;

  if (!response.ok) {
    throw new Error(xeroErrorMessage(payload, `Unable to check Xero invoice number (${response.status}).`));
  }

  return payload?.Invoices?.[0] ?? null;
}

async function fetchTaxRates(accessToken: string, xeroTenantId: string): Promise<XeroTaxRateInfo[]> {
  const response = await fetch(`${XERO_API}/TaxRates`, {
    headers: xeroHeaders(accessToken, xeroTenantId),
    cache: "no-store",
  });

  const payload = (await readJson(response)) as { TaxRates?: XeroTaxRateInfo[] } | null;

  if (!response.ok) {
    throw new Error(xeroErrorMessage(payload, `Unable to read Xero tax rates (${response.status}).`));
  }

  return Array.isArray(payload?.TaxRates) ? payload.TaxRates : [];
}

async function releaseClaim(admin: AdminClient, tenantId: string, invoiceId: string, message: string) {
  const { error } = await admin
    .from("invoices")
    .update({
      accounting_provider: "xero",
      accounting_sync_status: "error",
      accounting_sync_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .eq("accounting_sync_status", "syncing")
    .is("accounting_invoice_id", null);

  if (error) {
    console.error("[xero sync] could not release the sync claim", invoiceId, error.code);
  }
}

/*
  Review ACC-6, ACC-7, ACC-15.
  - Validation, including the TMS totals check, happens before anything is
    claimed or posted.
  - The invoice is claimed with a conditional update (not yet synced, not
    already syncing unless the claim is stale); a second concurrent request
    gets 409 instead of posting a duplicate.
  - Each line's VAT rate maps to a Xero TaxType; an unmapped or ambiguous rate
    refuses the sync.
  - Xero POSTs carry an Idempotency-Key.
  - Xero's total is compared with the TMS total after posting.
  - Xero and database error text is stored on the invoice and in the sync log,
    never returned in the response.
*/
export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  let tenantId = "";
  let invoiceId = "";
  let integrationId: string | null = null;
  let claimed = false;
  let claimAdmin: AdminClient | null = null;
  let userId: string | null = null;

  try {
    const body = await readJsonObject(request);

    tenantId = String(body.tenantId ?? "").trim();

    const params = await context.params;

    invoiceId = String(params.id ?? "").trim();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    if (!invoiceId) {
      return NextResponse.json({ error: "Invoice id is required." }, { status: 400 });
    }

    const { admin, user } = await requireTenantAccess(tenantId, ACCOUNTS_ADMIN_ROLES);
    userId = user.id;

    if (!isUuid(invoiceId)) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    const { data: integration, error: integrationError } = await admin
      .from("accounting_integrations")
      .select("id,external_tenant_id,default_sales_account_code,default_tax_code,settings")
      .eq("tenant_id", tenantId)
      .eq("provider", "xero")
      .eq("active", true)
      .eq("connection_status", "connected")
      .maybeSingle();

    if (integrationError) {
      throw new Error(integrationError.message);
    }

    if (!integration?.id || !integration.external_tenant_id) {
      return NextResponse.json({ error: "Xero is not connected for this tenant." }, { status: 409 });
    }

    integrationId = integration.id;

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select(
        "id,customer_id,invoice_number,status,issue_date,due_date,currency,po_reference,customer_reference,notes,total,accounting_invoice_id,accounting_sync_status"
      )
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (invoiceError) {
      throw new Error(invoiceError.message);
    }

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }

    if (invoice.accounting_invoice_id) {
      return NextResponse.json({
        ok: true,
        alreadySynced: true,
        xeroInvoiceId: invoice.accounting_invoice_id,
        invoiceNumber: invoice.invoice_number,
      });
    }

    if (!invoice.customer_id) {
      return NextResponse.json({ error: "Invoice has no customer." }, { status: 409 });
    }

    if (!invoice.invoice_number) {
      return NextResponse.json({ error: "Invoice has no invoice number." }, { status: 409 });
    }

    const status = String(invoice.status ?? "").toLowerCase();

    if (!["approved", "sent"].includes(status)) {
      return NextResponse.json({ error: "Approve the invoice before syncing it to Xero." }, { status: 409 });
    }

    const [customerResult, linesResult] = await Promise.all([
      admin
        .from("customers")
        .select("id,name,account_code,accounts_email")
        .eq("id", invoice.customer_id)
        .eq("tenant_id", tenantId)
        .maybeSingle(),

      admin
        .from("invoice_lines")
        .select("id,line_number,description,quantity,unit_price,vat_rate")
        .eq("invoice_id", invoiceId)
        .eq("tenant_id", tenantId)
        .order("line_number"),
    ]);

    if (customerResult.error) {
      throw new Error(customerResult.error.message);
    }

    if (linesResult.error) {
      throw new Error(linesResult.error.message);
    }

    const customer = customerResult.data;
    const lines = linesResult.data ?? [];

    if (!customer) {
      return NextResponse.json({ error: "Invoice customer could not be loaded." }, { status: 409 });
    }

    const customerName = String(customer.name ?? "").trim();

    if (!customerName) {
      return NextResponse.json({ error: "Customer requires a name before Xero sync." }, { status: 409 });
    }

    if (lines.length === 0) {
      return NextResponse.json({ error: "Invoice has no lines." }, { status: 409 });
    }

    const parsedLines = lines.map((line) => ({
      description: String(line.description ?? "Transport service").trim() || "Transport service",
      quantity: Number(line.quantity),
      unitPrice: Number(line.unit_price),
      vatRate: Number(line.vat_rate),
    }));

    // Zero-value lines (free of charge) are allowed; negative prices are not.
    const invalidLine = parsedLines.some(
      (line) =>
        !Number.isFinite(line.quantity) ||
        line.quantity <= 0 ||
        !Number.isFinite(line.unitPrice) ||
        line.unitPrice < 0 ||
        !Number.isFinite(line.vatRate) ||
        line.vatRate < 0
    );

    if (invalidLine) {
      return NextResponse.json(
        {
          error:
            "Every invoice line needs a quantity greater than zero, a unit price of zero or more and a valid VAT rate before Xero sync.",
        },
        { status: 409 }
      );
    }

    const invoiceTotal = Number(invoice.total ?? 0);

    if (!totalsAgree(expectedGrossTotal(parsedLines), invoiceTotal, parsedLines.length)) {
      return NextResponse.json(
        {
          error: "The invoice total does not match its lines. Recalculate the invoice before syncing.",
          code: "totals_mismatch",
        },
        { status: 409 }
      );
    }

    const salesAccountCode = String(integration.default_sales_account_code ?? "").trim();

    if (!salesAccountCode) {
      return NextResponse.json(
        { error: "Set the Xero Sales Account Code in Accounting settings before syncing invoices." },
        { status: 409 }
      );
    }

    // Review ACC-7: atomic claim.
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();

    const { data: claimRows, error: claimError } = await admin
      .from("invoices")
      .update({
        accounting_provider: "xero",
        accounting_sync_status: "syncing",
        accounting_sync_error: null,
        updated_at: now.toISOString(),
      })
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId)
      .is("accounting_invoice_id", null)
      .or(`accounting_sync_status.is.null,accounting_sync_status.neq.syncing,updated_at.lt."${staleBefore}"`)
      .select("id");

    if (claimError) {
      throw new Error(claimError.message);
    }

    if (!claimRows || claimRows.length === 0) {
      return NextResponse.json(
        { error: "This invoice is already being synced to Xero. Wait a moment and refresh.", code: "sync_in_progress" },
        { status: 409 }
      );
    }

    claimed = true;
    claimAdmin = admin;

    const accessToken = await getValidXeroAccessToken(integration.id);

    // Review ACC-6: map every line's VAT rate before posting anything.
    const taxRates = await fetchTaxRates(accessToken, integration.external_tenant_id);
    const explicitMap = parseTaxTypeMap(integration.settings);
    const defaultTaxType = String(integration.default_tax_code ?? "").trim() || null;

    const lineItems = [];

    for (const line of parsedLines) {
      const resolution = resolveXeroTaxType({
        vatRate: line.vatRate,
        explicitMap,
        defaultTaxType,
        taxRates,
      });

      if (!resolution.ok) {
        await releaseClaim(admin, tenantId, invoiceId, resolution.message);
        claimed = false;
        throw new AccountsHttpError(409, resolution.message, "tax_mapping_required");
      }

      lineItems.push({
        Description: line.description,
        Quantity: line.quantity,
        UnitAmount: line.unitPrice,
        AccountCode: salesAccountCode,
        TaxType: resolution.taxType,
      });
    }

    /*
     * If the TMS record has no Xero ID but the invoice number already exists
     * in Xero, stop rather than create or bind a duplicate.
     */
    const existingXeroInvoice = await findExistingXeroInvoice({
      accessToken,
      xeroTenantId: integration.external_tenant_id,
      invoiceNumber: invoice.invoice_number,
    });

    if (existingXeroInvoice?.InvoiceID) {
      const message =
        `Invoice number ${invoice.invoice_number} already exists in Xero. ` + "Reconcile it before retrying sync.";

      await releaseClaim(admin, tenantId, invoiceId, message);
      claimed = false;

      return NextResponse.json({ error: message, code: "xero_duplicate_number" }, { status: 409 });
    }

    const contact = await findOrCreateContact({
      accessToken,
      xeroTenantId: integration.external_tenant_id,
      customerId: String(customer.id),
      customerName,
      accountsEmail: customer.accounts_email ?? null,
      accountCode: customer.account_code ?? null,
    });

    if (!contact.ContactID) {
      throw new Error("Xero contact has no ContactID.");
    }

    const xeroInvoicePayload = {
      Invoices: [
        {
          Type: "ACCREC",
          Contact: { ContactID: contact.ContactID },
          InvoiceNumber: invoice.invoice_number,
          Date: invoice.issue_date,
          DueDate: invoice.due_date,
          ...(invoice.po_reference
            ? { Reference: invoice.po_reference }
            : invoice.customer_reference
              ? { Reference: invoice.customer_reference }
              : {}),
          CurrencyCode: invoice.currency || "GBP",
          LineAmountTypes: "Exclusive",
          LineItems: lineItems,
          Status: "AUTHORISED",
        },
      ],
    };

    const response = await fetch(`${XERO_API}/Invoices`, {
      method: "POST",
      headers: xeroHeaders(
        accessToken,
        integration.external_tenant_id,
        idempotencyKey("invoice", invoiceId, xeroInvoicePayload)
      ),
      body: JSON.stringify(xeroInvoicePayload),
      cache: "no-store",
    });

    const payload = (await readJson(response)) as { Invoices?: XeroInvoice[] } | null;

    if (!response.ok) {
      const message = xeroErrorMessage(payload, `Xero invoice sync failed (${response.status}).`);

      await releaseClaim(admin, tenantId, invoiceId, message);
      claimed = false;

      await admin.from("accounting_sync_log").insert({
        tenant_id: tenantId,
        integration_id: integration.id,
        entity_type: "invoice",
        entity_id: invoiceId,
        direction: "outbound",
        action: "sync",
        status: "error",
        request_payload: xeroInvoicePayload,
        response_payload: payload,
        error_message: message,
        initiated_by: user.id,
      });

      return NextResponse.json(
        {
          error: "Xero rejected the invoice. The reason is shown in the invoice's sync error.",
          code: "xero_rejected",
        },
        { status: 502 }
      );
    }

    const xeroInvoice: XeroInvoice | undefined = payload?.Invoices?.[0];

    if (!xeroInvoice?.InvoiceID) {
      throw new Error("Xero returned success but no InvoiceID.");
    }

    const xeroTotal = Number(xeroInvoice.Total);
    const totalMismatch = Number.isFinite(xeroTotal) && !totalsAgree(xeroTotal, invoiceTotal, parsedLines.length);

    const mismatchMessage = totalMismatch
      ? `Posted to Xero, but Xero's total ${xeroTotal.toFixed(2)} differs from the TMS total ${invoiceTotal.toFixed(2)}. Check the tax codes in Xero.`
      : null;

    const syncedAt = new Date().toISOString();

    const { error: saveError } = await admin
      .from("invoices")
      .update({
        accounting_provider: "xero",
        accounting_invoice_id: xeroInvoice.InvoiceID,
        accounting_sync_status: "synced",
        accounting_synced_at: syncedAt,
        accounting_sync_error: mismatchMessage,
        updated_at: syncedAt,
      })
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId);

    if (saveError) {
      // The invoice is in Xero; a retry will find its number there and stop.
      throw new Error(`Xero invoice ${xeroInvoice.InvoiceID} posted but not recorded: ${saveError.message}`);
    }

    claimed = false;

    await admin
      .from("accounting_integrations")
      .update({ last_sync_at: syncedAt, updated_at: syncedAt })
      .eq("id", integration.id);

    await admin.from("accounting_sync_log").insert({
      tenant_id: tenantId,
      integration_id: integration.id,
      entity_type: "invoice",
      entity_id: invoiceId,
      direction: "outbound",
      action: "sync",
      status: totalMismatch ? "error" : "success",
      external_id: xeroInvoice.InvoiceID,
      request_payload: xeroInvoicePayload,
      response_payload: payload,
      error_message: mismatchMessage,
      initiated_by: user.id,
    });

    return NextResponse.json({
      ok: true,
      invoiceNumber: invoice.invoice_number,
      xeroInvoiceId: xeroInvoice.InvoiceID,
      xeroInvoiceNumber: xeroInvoice.InvoiceNumber ?? invoice.invoice_number,
      xeroStatus: xeroInvoice.Status ?? null,
      totalMismatch,
      warning: mismatchMessage,
    });
  } catch (error) {
    if (claimed && claimAdmin && tenantId && invoiceId) {
      console.error("[xero sync] unexpected failure", invoiceId, error);

      await releaseClaim(
        claimAdmin,
        tenantId,
        invoiceId,
        "Sync failed unexpectedly. Check the Xero connection and retry."
      );

      if (integrationId) {
        await claimAdmin.from("accounting_sync_log").insert({
          tenant_id: tenantId,
          integration_id: integrationId,
          entity_type: "invoice",
          entity_id: invoiceId,
          direction: "outbound",
          action: "sync",
          status: "error",
          error_message: error instanceof Error ? error.message.slice(0, 1000) : "Unknown Xero sync error.",
          initiated_by: userId,
        });
      }
    }

    const result = errorResponse(error);

    return NextResponse.json(result.body, { status: result.status });
  }
}
