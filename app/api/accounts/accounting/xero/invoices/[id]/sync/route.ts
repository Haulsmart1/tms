import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../../../lib/accounts/server";
import {
  getValidXeroAccessToken,
} from "../../../../../../../../lib/accounts/providers/xero";

export const dynamic = "force-dynamic";

const XERO_API = "https://api.xero.com/api.xro/2.0";

type XeroContact = {
  ContactID?: string;
  Name?: string;
};

type XeroInvoice = {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Status?: string;
};

function xeroHeaders(
  accessToken: string,
  xeroTenantId: string
): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Xero-tenant-id": xeroTenantId,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function xeroErrorMessage(
  payload: unknown,
  fallback: string
): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;

  const elements = Array.isArray(record.Elements)
    ? record.Elements
    : [];

  const validationMessages = elements.flatMap((element) => {
    if (!element || typeof element !== "object") {
      return [];
    }

    const validationErrors = (
      element as Record<string, unknown>
    ).ValidationErrors;

    if (!Array.isArray(validationErrors)) {
      return [];
    }

    return validationErrors
      .map((validationError) => {
        if (
          !validationError ||
          typeof validationError !== "object"
        ) {
          return "";
        }

        return String(
          (
            validationError as Record<string, unknown>
          ).Message ?? ""
        ).trim();
      })
      .filter(Boolean);
  });

  if (validationMessages.length > 0) {
    return validationMessages.join("; ");
  }

  const message = String(
    record.Message ?? record.ErrorNumber ?? ""
  ).trim();

  return message || fallback;
}

function escapeXeroWhereValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
}

async function findOrCreateContact({
  accessToken,
  xeroTenantId,
  customerName,
  accountsEmail,
  accountCode,
}: {
  accessToken: string;
  xeroTenantId: string;
  customerName: string;
  accountsEmail: string | null;
  accountCode: string | null;
}): Promise<XeroContact> {
  const headers = xeroHeaders(
    accessToken,
    xeroTenantId
  );

  if (accountCode) {
    const where =
      `ContactNumber=="${escapeXeroWhereValue(accountCode)}"`;

    const response = await fetch(
      `${XERO_API}/Contacts?where=${encodeURIComponent(where)}`,
      {
        headers,
        cache: "no-store",
      }
    );

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        xeroErrorMessage(
          payload,
          `Unable to search Xero contacts (${response.status}).`
        )
      );
    }

    const existing = payload?.Contacts?.[0];

    if (existing?.ContactID) {
      return existing;
    }
  }

  const nameWhere =
    `Name=="${escapeXeroWhereValue(customerName)}"`;

  const nameResponse = await fetch(
    `${XERO_API}/Contacts?where=${encodeURIComponent(nameWhere)}`,
    {
      headers,
      cache: "no-store",
    }
  );

  const namePayload = await nameResponse.json();

  if (!nameResponse.ok) {
    throw new Error(
      xeroErrorMessage(
        namePayload,
        `Unable to search Xero contacts (${nameResponse.status}).`
      )
    );
  }

  const namedContact = namePayload?.Contacts?.[0];

  if (namedContact?.ContactID) {
    return namedContact;
  }

  const contactPayload = {
    Contacts: [
      {
        Name: customerName,
        ...(accountCode
          ? {
              ContactNumber: accountCode,
            }
          : {}),
        ...(accountsEmail
          ? {
              EmailAddress: accountsEmail,
            }
          : {}),
      },
    ],
  };

  const createResponse = await fetch(
    `${XERO_API}/Contacts`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(contactPayload),
      cache: "no-store",
    }
  );

  const createdPayload = await createResponse.json();

  if (!createResponse.ok) {
    throw new Error(
      xeroErrorMessage(
        createdPayload,
        `Unable to create Xero contact (${createResponse.status}).`
      )
    );
  }

  const created = createdPayload?.Contacts?.[0];

  if (!created?.ContactID) {
    throw new Error(
      "Xero created the contact but returned no ContactID."
    );
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
  const where =
    `InvoiceNumber=="${escapeXeroWhereValue(invoiceNumber)}"`;

  const response = await fetch(
    `${XERO_API}/Invoices?where=${encodeURIComponent(where)}`,
    {
      headers: xeroHeaders(
        accessToken,
        xeroTenantId
      ),
      cache: "no-store",
    }
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      xeroErrorMessage(
        payload,
        `Unable to check Xero invoice number (${response.status}).`
      )
    );
  }

  return payload?.Invoices?.[0] ?? null;
}

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

  try {
    const body = await request.json();

    tenantId = String(
      body.tenantId ?? ""
    ).trim();

    const params = await context.params;

    invoiceId = String(
      params.id ?? ""
    ).trim();

    if (!tenantId) {
      return NextResponse.json(
        {
          error: "tenantId is required.",
        },
        {
          status: 400,
        }
      );
    }

    if (!invoiceId) {
      return NextResponse.json(
        {
          error: "Invoice id is required.",
        },
        {
          status: 400,
        }
      );
    }

    const {
      admin,
      user,
    } = await requireTenantAccess(tenantId);

    const {
      data: integration,
      error: integrationError,
    } = await admin
      .from("accounting_integrations")
      .select(
        "id,external_tenant_id,default_sales_account_code,default_tax_code"
      )
      .eq("tenant_id", tenantId)
      .eq("provider", "xero")
      .eq("active", true)
      .eq("connection_status", "connected")
      .maybeSingle();

    if (integrationError) {
      throw new Error(integrationError.message);
    }

    if (
      !integration?.id ||
      !integration.external_tenant_id
    ) {
      return NextResponse.json(
        {
          error: "Xero is not connected for this tenant.",
        },
        {
          status: 409,
        }
      );
    }

    integrationId = integration.id;

    const {
      data: invoice,
      error: invoiceError,
    } = await admin
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
      return NextResponse.json(
        {
          error: "Invoice not found.",
        },
        {
          status: 404,
        }
      );
    }

    if (invoice.accounting_invoice_id) {
      return NextResponse.json({
        ok: true,
        alreadySynced: true,
        xeroInvoiceId:
          invoice.accounting_invoice_id,
        invoiceNumber:
          invoice.invoice_number,
      });
    }

    if (!invoice.customer_id) {
      return NextResponse.json(
        {
          error: "Invoice has no customer.",
        },
        {
          status: 409,
        }
      );
    }

    if (!invoice.invoice_number) {
      return NextResponse.json(
        {
          error: "Invoice has no invoice number.",
        },
        {
          status: 409,
        }
      );
    }

    const status = String(
      invoice.status ?? ""
    ).toLowerCase();

    if (
      !["approved", "sent"].includes(status)
    ) {
      return NextResponse.json(
        {
          error:
            "Approve the invoice before syncing it to Xero.",
        },
        {
          status: 409,
        }
      );
    }

    const [
      customerResult,
      linesResult,
    ] = await Promise.all([
      admin
        .from("customers")
        .select(
          "id,name,account_code,accounts_email"
        )
        .eq(
          "id",
          invoice.customer_id
        )
        .eq(
          "tenant_id",
          tenantId
        )
        .maybeSingle(),

      admin
        .from("invoice_lines")
        .select(
          "id,line_number,description,quantity,unit_price,vat_rate"
        )
        .eq(
          "invoice_id",
          invoiceId
        )
        .eq(
          "tenant_id",
          tenantId
        )
        .order("line_number"),
    ]);

    if (customerResult.error) {
      throw new Error(
        customerResult.error.message
      );
    }

    if (linesResult.error) {
      throw new Error(
        linesResult.error.message
      );
    }

    const customer = customerResult.data;
    const lines = linesResult.data ?? [];

    if (!customer) {
      return NextResponse.json(
        {
          error:
            "Invoice customer could not be loaded.",
        },
        {
          status: 409,
        }
      );
    }

    const customerName = String(
      customer.name ?? ""
    ).trim();

    if (!customerName) {
      return NextResponse.json(
        {
          error:
            "Customer requires a name before Xero sync.",
        },
        {
          status: 409,
        }
      );
    }

    if (lines.length === 0) {
      return NextResponse.json(
        {
          error: "Invoice has no lines.",
        },
        {
          status: 409,
        }
      );
    }

    const invalidLine = lines.find((line) => {
      const quantity = Number(
        line.quantity
      );

      const unitPrice = Number(
        line.unit_price
      );

      return (
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice <= 0
      );
    });

    if (invalidLine) {
      return NextResponse.json(
        {
          error:
            "Every invoice line must have a quantity greater than zero and a Unit Price greater than 0 before Xero sync.",
        },
        {
          status: 409,
        }
      );
    }

    const salesAccountCode = String(
      integration.default_sales_account_code ??
        ""
    ).trim();

    if (!salesAccountCode) {
      return NextResponse.json(
        {
          error:
            "Set the Xero Sales Account Code in Accounting settings before syncing invoices.",
        },
        {
          status: 409,
        }
      );
    }

    await admin
      .from("invoices")
      .update({
        accounting_provider: "xero",
        accounting_sync_status: "syncing",
        accounting_sync_error: null,
      })
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId);

    const accessToken =
      await getValidXeroAccessToken(
        integration.id
      );

    /*
     * If the TMS record has no Xero ID but the invoice
     * number already exists in Xero, stop rather than
     * accidentally create/bind a duplicate.
     */
    const existingXeroInvoice =
      await findExistingXeroInvoice({
        accessToken,
        xeroTenantId:
          integration.external_tenant_id,
        invoiceNumber:
          invoice.invoice_number,
      });

    if (existingXeroInvoice?.InvoiceID) {
      const message =
        `Invoice number ${invoice.invoice_number} already exists in Xero. ` +
        "Reconcile it before retrying sync.";

      await admin
        .from("invoices")
        .update({
          accounting_provider: "xero",
          accounting_sync_status: "error",
          accounting_sync_error: message,
        })
        .eq("id", invoiceId)
        .eq("tenant_id", tenantId);

      return NextResponse.json(
        {
          error: message,
          xeroInvoiceId:
            existingXeroInvoice.InvoiceID,
        },
        {
          status: 409,
        }
      );
    }

    const contact =
      await findOrCreateContact({
        accessToken,
        xeroTenantId:
          integration.external_tenant_id,
        customerName,
        accountsEmail:
          customer.accounts_email ?? null,
        accountCode:
          customer.account_code ?? null,
      });

    if (!contact.ContactID) {
      throw new Error(
        "Xero contact has no ContactID."
      );
    }

    const taxCode = String(
      integration.default_tax_code ?? ""
    ).trim();

    const lineItems = lines.map((line) => ({
      Description:
        String(
          line.description ??
            "Transport service"
        ).trim() ||
        "Transport service",

      Quantity:
        Number(line.quantity),

      UnitAmount:
        Number(line.unit_price),

      AccountCode:
        salesAccountCode,

      ...(taxCode
        ? {
            TaxType: taxCode,
          }
        : {}),
    }));

    const xeroInvoicePayload = {
      Invoices: [
        {
          Type: "ACCREC",

          Contact: {
            ContactID:
              contact.ContactID,
          },

          InvoiceNumber:
            invoice.invoice_number,

          Date:
            invoice.issue_date,

          DueDate:
            invoice.due_date,

          ...(invoice.po_reference
            ? {
                Reference:
                  invoice.po_reference,
              }
            : invoice.customer_reference
              ? {
                  Reference:
                    invoice.customer_reference,
                }
              : {}),

          CurrencyCode:
            invoice.currency || "GBP",

          LineAmountTypes:
            "Exclusive",

          LineItems:
            lineItems,

          Status:
            "AUTHORISED",
        },
      ],
    };

    const response = await fetch(
      `${XERO_API}/Invoices`,
      {
        method: "POST",
        headers: xeroHeaders(
          accessToken,
          integration.external_tenant_id
        ),
        body: JSON.stringify(
          xeroInvoicePayload
        ),
        cache: "no-store",
      }
    );

    const payload = await response.json();

    if (!response.ok) {
      const message =
        xeroErrorMessage(
          payload,
          `Xero invoice sync failed (${response.status}).`
        );

      await admin
        .from("invoices")
        .update({
          accounting_provider: "xero",
          accounting_sync_status: "error",
          accounting_sync_error: message,
        })
        .eq("id", invoiceId)
        .eq("tenant_id", tenantId);

      await admin
        .from("accounting_sync_log")
        .insert({
          tenant_id: tenantId,
          integration_id:
            integration.id,
          entity_type: "invoice",
          entity_id: invoiceId,
          direction: "outbound",
          action: "sync",
          status: "error",
          request_payload:
            xeroInvoicePayload,
          response_payload: payload,
          error_message: message,
          initiated_by: user.id,
        });

      return NextResponse.json(
        {
          error: message,
          payload,
        },
        {
          status: 502,
        }
      );
    }

    const xeroInvoice:
      XeroInvoice | undefined =
        payload?.Invoices?.[0];

    if (!xeroInvoice?.InvoiceID) {
      throw new Error(
        "Xero returned success but no InvoiceID."
      );
    }

    const syncedAt =
      new Date().toISOString();

    const {
      error: saveError,
    } = await admin
      .from("invoices")
      .update({
        accounting_provider: "xero",
        accounting_invoice_id:
          xeroInvoice.InvoiceID,
        accounting_sync_status: "synced",
        accounting_synced_at: syncedAt,
        accounting_sync_error: null,
      })
      .eq("id", invoiceId)
      .eq("tenant_id", tenantId);

    if (saveError) {
      throw new Error(saveError.message);
    }

    await admin
      .from("accounting_integrations")
      .update({
        last_sync_at: syncedAt,
        updated_at: syncedAt,
      })
      .eq("id", integration.id);

    await admin
      .from("accounting_sync_log")
      .insert({
        tenant_id: tenantId,
        integration_id:
          integration.id,
        entity_type: "invoice",
        entity_id: invoiceId,
        direction: "outbound",
        action: "sync",
        status: "success",
        external_id:
          xeroInvoice.InvoiceID,
        request_payload:
          xeroInvoicePayload,
        response_payload: payload,
        initiated_by: user.id,
      });

    return NextResponse.json({
      ok: true,
      invoiceNumber:
        invoice.invoice_number,
      xeroInvoiceId:
        xeroInvoice.InvoiceID,
      xeroInvoiceNumber:
        xeroInvoice.InvoiceNumber ??
        invoice.invoice_number,
      xeroStatus:
        xeroInvoice.Status ?? null,
    });
  } catch (error) {
    try {
      if (tenantId && invoiceId) {
        const {
          admin,
        } = await requireTenantAccess(
          tenantId
        );

        const message =
          error instanceof Error
            ? error.message
            : "Unknown Xero sync error.";

        await admin
          .from("invoices")
          .update({
            accounting_provider: "xero",
            accounting_sync_status: "error",
            accounting_sync_error: message,
          })
          .eq("id", invoiceId)
          .eq("tenant_id", tenantId);

        if (integrationId) {
          await admin
            .from("accounting_sync_log")
            .insert({
              tenant_id: tenantId,
              integration_id:
                integrationId,
              entity_type: "invoice",
              entity_id: invoiceId,
              direction: "outbound",
              action: "sync",
              status: "error",
              error_message: message,
            });
        }
      }
    } catch {
      // Preserve the original failure.
    }

    const result =
      errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status: result.status,
      }
    );
  }
}