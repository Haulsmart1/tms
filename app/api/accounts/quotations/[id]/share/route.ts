import {
  randomUUID,
} from "crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

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

const DEFAULT_LIFETIME_SECONDS =
  14 * 24 * 60 * 60;

function expiryFromQuotation(
  validUntil: string | null
): number {
  const nowSeconds =
    Math.floor(Date.now() / 1000);

  if (!validUntil) {
    return (
      nowSeconds +
      DEFAULT_LIFETIME_SECONDS
    );
  }

  const endOfValidity =
    new Date(
      `${validUntil}T23:59:59.999Z`
    ).getTime();

  if (!Number.isFinite(endOfValidity)) {
    throw new Error(
      "Quotation has an invalid valid-until date."
    );
  }

  const expirySeconds =
    Math.floor(
      endOfValidity / 1000
    );

  if (
    expirySeconds <=
    nowSeconds
  ) {
    throw new Error(
      "Quotation validity has expired."
    );
  }

  return expirySeconds;
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const body =
      await request.json();

    const tenantId =
      String(
        body.tenantId ?? ""
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
            `Quotation cannot be shared while status is ${quotation.status}.`,
        },
        {
          status: 409,
        }
      );
    }

    const expiresAt =
      expiryFromQuotation(
        quotation.valid_until
      );

    const shareLinkId =
      randomUUID();

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

    const now =
      new Date()
        .toISOString();

    /*
      One active share link per quotation.
      Old links are revoked before the new one is created.
    */
    const {
      error: revokeError,
    } = await admin
      .from(
        "quotation_share_links"
      )
      .update({
        revoked_at: now,
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
      );

    if (revokeError) {
      throw new Error(
        revokeError.message
      );
    }

    const {
      error: insertError,
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

        expires_at:
          new Date(
            expiresAt * 1000
          ).toISOString(),
      });

    if (insertError) {
      throw new Error(
        insertError.message
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

    return NextResponse.json({
      ok: true,
      quotationId:
        quotation.id,
      quoteNumber:
        quotation.quote_number,
      shareLinkId,
      shareUrl,
      expiresAt:
        new Date(
          expiresAt * 1000
        ).toISOString(),
    });
  }
  catch (error) {
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