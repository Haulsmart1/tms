import {
  randomUUID,
} from "crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";


import {
  ACCOUNTS_ADMIN_ROLES,
  errorResponse,
  requireTenantAccess,
  AccountsHttpError,
} from "../../../../../../lib/accounts/server";

import {
  loadDocumentBranding,
} from "../../../../../../lib/accounts/documentBranding";

import {
  authorizeDocumentRecipient,
  enforceDocumentEmailLimits,
} from "../../../../../../lib/accounts/documentEmail";

import {
  publicAppOrigin,
} from "../../../../../../lib/accounts/appUrl";

import {
  createQuotationShareToken,
  hashQuotationShareToken,
} from "../../../../../../lib/quotations/shareToken";

import {
  generateQuotationPdf,
} from "../../../../../../lib/quotations/generatePdf";

import {
  sendLoggedDocumentEmail,
} from "../../../../../../lib/documents/delivery";

import {
  buildDocumentEmailHtml,
} from "../../../../../../lib/documents/emailTemplate";

import {
  quotationShareExpiry,
} from "../../../../../../lib/quotations/shareExpiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeHeader(
  value: string
): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);
}


function renderTemplate(
  value: string,
  quoteNumber: string,
  companyName: string
): string {
  return value
    .replaceAll(
      "{{quote_number}}",
      quoteNumber
    )
    .replaceAll(
      "{{company_name}}",
      companyName
    );
}

// Ends with valid_until in Europe/London, not UTC, and never outlives the
// template's default validity (lib/quotations/shareExpiry.ts).
function calculateExpiry(
  validUntil: string | null,
  defaultValidDays: number
): number {
  const lifetimeSeconds = Math.max(1, defaultValidDays) * 24 * 60 * 60;
  const result = quotationShareExpiry({
    validUntil,
    fallbackLifetimeSeconds: lifetimeSeconds,
    maxLifetimeSeconds: lifetimeSeconds,
  });

  if (!result.ok) {
    throw result.reason === "quotation_expired"
      ? new AccountsHttpError(409, "Quotation validity has expired. Extend the valid-until date first.", "quotation_expired")
      : new AccountsHttpError(409, "Quotation has an invalid valid-until date.", "invalid_valid_until");
  }

  return result.expiresAt;
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  let newShareLinkId:
    string | null = null;

  // Review INV-17: the request body is consumed once, so the failure cleanup
  // uses these instead of re-reading it.
  let cleanupAdmin:
    Awaited<ReturnType<typeof requireTenantAccess>>["admin"] | null = null;
  let cleanupTenantId = "";

  try {
    const body =
      await request.json();

    const tenantId =
      String(
        body.tenantId ?? ""
      ).trim();

    const requestedRecipient =
      String(
        body.to ?? ""
      ).trim();

    const {
      id: quotationId,
    } =
      await context.params;

    if (!tenantId) {
      return NextResponse.json(
        {
          error:
            "tenantId is required.",
        },
        {
          status: 400,
        }
      );
    }

    if (!quotationId) {
      return NextResponse.json(
        {
          error:
            "Quotation id is required.",
        },
        {
          status: 400,
        }
      );
    }

    const {
      admin,
      user,
    } =
      await requireTenantAccess(
        tenantId,
        ACCOUNTS_ADMIN_ROLES
      );

    cleanupAdmin = admin;
    cleanupTenantId = tenantId;

    const {
      data: quotation,
      error: quotationError,
    } = await admin
      .from("quotations")
      .select(`
        id,
        tenant_id,
        customer_id,
        quote_number,
        status,
        quote_date,
        valid_until,
        currency_code,
        subtotal,
        vat_total,
        total,
        notes,
        customer_reference,
        po_reference
      `)
      .eq(
        "id",
        quotationId
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .maybeSingle();

    if (quotationError) {
      throw new Error(
        quotationError.message
      );
    }

    if (!quotation) {
      return NextResponse.json(
        {
          error:
            "Quotation not found.",
        },
        {
          status: 404,
        }
      );
    }

    if (
      [
        "converted",
        "declined",
        "expired",
        "cancelled",
      ].includes(
        String(
          quotation.status
        )
      )
    ) {
      return NextResponse.json(
        {
          error:
            `Quotation cannot be emailed while status is ${quotation.status}.`,
        },
        {
          status: 409,
        }
      );
    }

    const {
      data: customer,
      error: customerError,
    } = await admin
      .from("customers")
      .select(`
        id,
        name,
        contact_name,
        email,
        operations_email,
        accounts_email
      `)
      .eq(
        "id",
        quotation.customer_id
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .maybeSingle();

    if (customerError) {
      throw new Error(
        customerError.message
      );
    }

    if (!customer) {
      return NextResponse.json(
        {
          error:
            "Quotation customer not found.",
        },
        {
          status: 404,
        }
      );
    }

    // Review ACC-5: only addresses stored for this customer (or the caller's
    // own address).
    const recipient =
      await authorizeDocumentRecipient({
        admin,
        tenantId,
        customerId: String(quotation.customer_id),
        requested: requestedRecipient,
        defaults: [
          customer.operations_email,
          customer.email,
          customer.accounts_email,
        ],
        customerEmails: [
          customer.operations_email,
          customer.email,
          customer.accounts_email,
        ],
        callerEmail: user.email,
      });

    // Review ACC-18: per-user and per-tenant send limits.
    await enforceDocumentEmailLimits(admin, user.id, tenantId);

    const {
      data: tenant,
      error: tenantError,
    } = await admin
      .from("tenants")
      .select(`
        id,
        name
      `)
      .eq(
        "id",
        tenantId
      )
      .maybeSingle();

    if (tenantError) {
      throw new Error(
        tenantError.message
      );
    }

    if (!tenant) {
      return NextResponse.json(
        {
          error:
            "Tenant not found.",
        },
        {
          status: 404,
        }
      );
    }

    const companyName =
      String(
        tenant.name ?? ""
      ).trim();

    if (!companyName) {
      return NextResponse.json(
        {
          error:
            "Tenant company name is not configured.",
        },
        {
          status: 409,
        }
      );
    }

    const {
      data: template,
      error: templateError,
    } = await admin
      .from(
        "quotation_template_settings"
      )
      .select(`
        default_valid_days,
        email_subject_template,
        email_body_template
      `)
      .eq(
        "tenant_id",
        tenantId
      )
      .maybeSingle();

    if (templateError) {
      throw new Error(
        templateError.message
      );
    }

    const defaultValidDays =
      Number(
        template?.default_valid_days ??
          14
      );

    const subjectTemplate =
      String(
        template?.email_subject_template ??
          "Quotation {{quote_number}} from {{company_name}}"
      );

    const bodyTemplate =
      String(
        template?.email_body_template ??
          "Please review quotation {{quote_number}} using the secure link below."
      );

    const expiresAt =
      calculateExpiry(
        quotation.valid_until,
        Number.isFinite(
          defaultValidDays
        )
          ? defaultValidDays
          : 14
      );

    const shareLinkId =
      randomUUID();

    newShareLinkId =
      shareLinkId;

    const token =
      createQuotationShareToken({
        shareLinkId,
        quotationId:
          quotation.id,
        tenantId,
        expiresAt,
      });

    const tokenHash =
      hashQuotationShareToken(
        token
      );

    const {
      error: shareInsertError,
    } = await admin
      .from(
        "quotation_share_links"
      )
      .insert({
        id:
          shareLinkId,

        tenant_id:
          tenantId,

        quotation_id:
          quotation.id,

        token_hash:
          tokenHash,

        sent_to_email:
          recipient,

        expires_at:
          new Date(
            expiresAt * 1000
          ).toISOString(),
      });

    if (shareInsertError) {
      throw new Error(
        shareInsertError.message
      );
    }

    // Review INV-26: the configured site URL, never the request Host.
    const origin =
      publicAppOrigin(request.url);

    const shareUrl =
      `${origin}/quotation/share/${encodeURIComponent(
        token
      )}`;
const quoteNumber =
      String(
        quotation.quote_number
      );

    const subject =
      safeHeader(
        renderTemplate(
          subjectTemplate,
          quoteNumber,
          companyName
        )
      );

    const messageBody =
      renderTemplate(
        bodyTemplate,
        quoteNumber,
        companyName
      ).trim();

    const customerName =
      String(
        customer.contact_name ??
          customer.name ??
          "Customer"
      ).trim();

    const text = [
      `Hi ${customerName},`,
      "",
      messageBody,
      "",
      `View quotation: ${shareUrl}`,
      "",
      "You can securely accept or decline this quotation using the link above.",
      "",
      "Regards,",
      companyName,
    ].join("\n");
    const {
      data: quotationLines,
      error: quotationLinesError,
    } = await admin
      .from("quotation_lines")
      .select(`
        description,
        quantity,
        unit_price,
        vat_rate,
        line_total,
        line_number
      `)
      .eq(
        "quotation_id",
        quotation.id
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .order(
        "line_number",
        {
          ascending: true,
        }
      );

    if (quotationLinesError) {
      throw new Error(
        quotationLinesError.message
      );
    }

    const {
      data: shareSnapshot,
      error: shareSnapshotError,
    } = await admin
      .from("quotation_share_links")
      .select(`
        terms_snapshot
      `)
      .eq(
        "id",
        shareLinkId
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .maybeSingle();

    if (shareSnapshotError) {
      throw new Error(
        shareSnapshotError.message
      );
    }

    const branding =
      await loadDocumentBranding(admin, tenantId);

    const {
      bytes: quotationPdfBytes,
      filename: quotationPdfFilename,
    } = await generateQuotationPdf({
      companyName,
      companyProfile:
        branding?.companyProfile ??
        null,
      documentSettings:
        branding?.documentSettings ??
        null,
      customerName,
      quoteNumber,
      quoteDate:
        quotation.quote_date ?? null,
      validUntil:
        quotation.valid_until ?? null,
      currency:
        quotation.currency_code || "GBP",
      subtotal:
        Number(quotation.subtotal ?? 0),
      vatTotal:
        Number(quotation.vat_total ?? 0),
      total:
        Number(quotation.total ?? 0),
      notes:
        quotation.notes ?? null,
      customerReference:
        quotation.customer_reference ?? null,
      poReference:
        quotation.po_reference ?? null,
      lines:
        (quotationLines ?? []).map(
          (line) => ({
            description:
              String(
                line.description ?? ""
              ),
            quantity:
              Number(
                line.quantity ?? 0
              ),
            unitPrice:
              Number(
                line.unit_price ?? 0
              ),
            vatRate:
              Number(
                line.vat_rate ?? 0
              ),
            lineTotal:
              Number(
                line.line_total ?? 0
              ),
          })
        ),
      termsSnapshot:
        shareSnapshot?.terms_snapshot ??
        null,
    });

    const html =
      buildDocumentEmailHtml({
        companyName,
        recipientName:
          customerName,
        title:
          `Your quotation ${quoteNumber} is ready`,
        intro:
          messageBody ||
          `Please review quotation ${quoteNumber}.`,
        summaryRows: [
          {
            label:
              "Quotation",
            value:
              quoteNumber,
          },
          {
            label:
              "Quote date",
            value:
              quotation.quote_date ||
              "-",
          },
          {
            label:
              "Valid until",
            value:
              quotation.valid_until ||
              "-",
          },
          {
            label:
              "Total",
            value:
              new Intl.NumberFormat(
                "en-GB",
                {
                  style:
                    "currency",
                  currency:
                    quotation.currency_code ||
                    "GBP",
                }
              ).format(
                Number(
                  quotation.total ??
                  0
                )
              ),
          },
        ],
        attachmentText:
          "A detailed quotation PDF is attached.",
        actionLabel:
          "Review & Accept Quotation",
        actionUrl:
          shareUrl,
        footerText:
          "You can review, accept or decline this quotation securely online.",
      });
    const delivery =
      await sendLoggedDocumentEmail({
        admin,
        tenantId,
        documentType:
          "quotation",
        documentId:
          quotation.id,
        recipient,
        subject,
        text,
        html,
        shareReference:
          shareUrl,
        attachments: [
          {
            filename:
              quotationPdfFilename,
            content:
              Buffer.from(
                quotationPdfBytes
              ),
            contentType:
              "application/pdf",
          },
        ],
        metadata: {
          quoteNumber,
          customerName,
          subject,
        },
      });

    // The email has been delivered with this link in it: it must never be
    // revoked by the failure cleanup, and later bookkeeping failures are
    // warnings rather than errors (review INV-17, INV-25).
    newShareLinkId =
      null;

    const warnings: string[] = [];


    const sentAt =
      new Date()
        .toISOString();

    const {
      error: shareUpdateError,
    } = await admin
      .from(
        "quotation_share_links"
      )
      .update({
        sent_at:
          sentAt,

        sent_to_email:
          recipient,
      })
      .eq(
        "id",
        shareLinkId
      )
      .eq(
        "tenant_id",
        tenantId
      );

    if (shareUpdateError) {
      console.error("[quotation email] sent but share link update failed", shareUpdateError.code);
      warnings.push("The quotation was emailed, but the share link record could not be updated.");
    }

    const nextStatus =
      quotation.status ===
      "draft"
        ? "sent"
        : quotation.status;

    const {
      error: quotationUpdateError,
    } = await admin
      .from("quotations")
      .update({
        status:
          nextStatus,

        sent_at:
          sentAt,

        updated_at:
          sentAt,
      })
      .eq(
        "id",
        quotation.id
      )
      .eq(
        "tenant_id",
        tenantId
      );

    if (quotationUpdateError) {
      console.error("[quotation email] sent but status update failed", quotationUpdateError.code);
      warnings.push("The quotation was emailed, but it could not be marked as sent. Do not resend; refresh the list.");
    }

    /*
      Keep the newly-sent link active and revoke older
      active links for the same quotation.
    */
    const {
      error: revokeOldError,
    } = await admin
      .from(
        "quotation_share_links"
      )
      .update({
        revoked_at:
          sentAt,
      })
      .eq(
        "tenant_id",
        tenantId
      )
      .eq(
        "quotation_id",
        quotation.id
      )
      .is(
        "revoked_at",
        null
      )
      .neq(
        "id",
        shareLinkId
      );

    if (revokeOldError) {
      console.error("[quotation email] older share links could not be revoked", revokeOldError.code);
      warnings.push("Older links to this quotation could not be revoked. Revoke them by sharing again.");
    }

    return NextResponse.json({
      ok: true,

      warnings,

      id:
        delivery.providerMessageId,

      deliveryLogId:
        delivery.deliveryLogId,

      recipient,

      quotationId:
        quotation.id,

      quoteNumber,

      shareLinkId,

      shareUrl,

      expiresAt:
        new Date(
          expiresAt * 1000
        ).toISOString(),
    });
  }
  catch (error) {
    /*
      Best effort: if a link was created but the overall
      operation failed before completion, revoke it.
    */
    if (
      newShareLinkId
    ) {
      try {
        if (cleanupAdmin && cleanupTenantId) {
          await cleanupAdmin
            .from("quotation_share_links")
            .update({
              revoked_at: new Date().toISOString(),
            })
            .eq("id", newShareLinkId)
            .eq("tenant_id", cleanupTenantId);
        }
      }
      catch (cleanupError) {
        // Preserve the original error.
        console.error("[quotation email] share link cleanup failed", cleanupError);
      }
    }

    const result =
      errorResponse(error);

    return NextResponse.json(
      result.body,
      {
        status:
          result.status,
      }
    );
  }
}