import {
  randomUUID,
} from "crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  Resend,
} from "resend";

import {
  errorResponse,
  requireTenantAccess,
} from "../../../../../../lib/accounts/server";

import {
  createQuotationShareToken,
  hashQuotationShareToken,
} from "../../../../../../lib/quotations/shareToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_PATTERN =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function calculateExpiry(
  validUntil: string | null,
  defaultValidDays: number
): number {
  const nowSeconds =
    Math.floor(Date.now() / 1000);

  const fallbackExpiry =
    nowSeconds +
    Math.max(
      1,
      defaultValidDays
    ) *
      24 *
      60 *
      60;

  if (!validUntil) {
    return fallbackExpiry;
  }

  const validityMilliseconds =
    new Date(
      `${validUntil}T23:59:59.999Z`
    ).getTime();

  if (
    !Number.isFinite(
      validityMilliseconds
    )
  ) {
    throw new Error(
      "Quotation has an invalid valid-until date."
    );
  }

  const validityExpiry =
    Math.floor(
      validityMilliseconds / 1000
    );

  if (
    validityExpiry <=
    nowSeconds
  ) {
    throw new Error(
      "Quotation validity has expired."
    );
  }

  return Math.min(
    validityExpiry,
    fallbackExpiry
  );
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
    } =
      await requireTenantAccess(
        tenantId
      );

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
        valid_until
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

    const recipient =
      requestedRecipient ||
      String(
        customer.operations_email ??
          customer.email ??
          customer.accounts_email ??
          ""
      ).trim();

    if (
      !recipient ||
      !EMAIL_PATTERN.test(
        recipient
      )
    ) {
      return NextResponse.json(
        {
          error:
            "A valid quotation email recipient is required.",
        },
        {
          status: 400,
        }
      );
    }

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

    const origin =
      new URL(
        request.url
      ).origin;

    const shareUrl =
      `${origin}/quotation/share/${encodeURIComponent(
        token
      )}`;

    const apiKey =
      process.env.RESEND_API_KEY;

    const from =
      process.env.MAIL_FROM;

    if (
      !apiKey ||
      !from
    ) {
      throw new Error(
        "Quotation email is not configured. RESEND_API_KEY and MAIL_FROM are required."
      );
    }

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

    const resend =
      new Resend(
        apiKey
      );

    const {
      data: sendData,
      error: sendError,
    } =
      await resend.emails.send({
        from,
        to:
          recipient,
        subject,
        text,
      });

    if (sendError) {
      await admin
        .from(
          "quotation_share_links"
        )
        .update({
          revoked_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          shareLinkId
        )
        .eq(
          "tenant_id",
          tenantId
        );

      newShareLinkId =
        null;

      return NextResponse.json(
        {
          error:
            sendError.message ||
            "Resend rejected the quotation email.",
        },
        {
          status: 502,
        }
      );
    }

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
      throw new Error(
        shareUpdateError.message
      );
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

    if (
      quotationUpdateError
    ) {
      throw new Error(
        quotationUpdateError.message
      );
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
      throw new Error(
        revokeOldError.message
      );
    }

    newShareLinkId =
      null;

    return NextResponse.json({
      ok: true,

      id:
        sendData?.id ??
        null,

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
        const body =
          await request
            .clone()
            .json();

        const tenantId =
          String(
            body.tenantId ??
              ""
          ).trim();

        if (tenantId) {
          const {
            admin,
          } =
            await requireTenantAccess(
              tenantId
            );

          await admin
            .from(
              "quotation_share_links"
            )
            .update({
              revoked_at:
                new Date()
                  .toISOString(),
            })
            .eq(
              "id",
              newShareLinkId
            )
            .eq(
              "tenant_id",
              tenantId
            );
        }
      }
      catch {
        // Preserve original error.
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