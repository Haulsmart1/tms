import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  errorResponse,
  requireTenantAccess,
} from "../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

const ALLOWED_STATUSES =
  new Set([
    "new",
    "reviewing",
    "converted",
    "rejected",
  ]);

export async function GET(
  request: NextRequest
) {
  try {
    const tenantId =
      request.nextUrl.searchParams
        .get("tenantId")
        ?.trim() ?? "";

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

    const {
      admin,
    } =
      await requireTenantAccess(
        tenantId
      );

    const {
      data,
      error,
    } = await admin
      .from("quote_requests")
      .select(`
        id,
        tenant_id,
        source,
        status,
        customer_id,
        quotation_id,
        customer_name,
        contact_name,
        email,
        phone,
        accounts_email,
        collection_address,
        collection_city,
        collection_postcode,
        delivery_address,
        delivery_city,
        delivery_postcode,
        requested_service_date,
        customer_reference,
        po_reference,
        description,
        quantity,
        notes,
        received_at,
        reviewed_at,
        converted_at,
        rejected_at
      `)
      .eq(
        "tenant_id",
        tenantId
      )
      .in(
        "status",
        [
          "new",
          "reviewing",
        ]
      )
      .order(
        "received_at",
        {
          ascending: false,
        }
      );

    if (error) {
      throw new Error(
        error.message
      );
    }

    return NextResponse.json({
      quoteRequests:
        data ?? [],
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

export async function PATCH(
  request: NextRequest
) {
  try {
    const body =
      await request.json();

    const tenantId =
      String(
        body.tenantId ?? ""
      ).trim();

    const requestId =
      String(
        body.requestId ?? ""
      ).trim();

    const status =
      String(
        body.status ?? ""
      )
        .trim()
        .toLowerCase();

    if (
      !tenantId ||
      !requestId
    ) {
      return NextResponse.json(
        {
          error:
            "tenantId and requestId are required.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !ALLOWED_STATUSES.has(
        status
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid quote request status.",
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

    const now =
      new Date()
        .toISOString();

    const updates:
      Record<string, unknown> = {
        status,
        updated_at:
          now,
      };

    if (
      status ===
      "reviewing"
    ) {
      updates.reviewed_at =
        now;
    }

    if (
      status ===
      "rejected"
    ) {
      updates.rejected_at =
        now;
    }

    if (
      status ===
      "converted"
    ) {
      const quotationId =
        String(
          body.quotationId ??
            ""
        ).trim();

      if (!quotationId) {
        return NextResponse.json(
          {
            error:
              "quotationId is required when converting a quote request.",
          },
          {
            status: 400,
          }
        );
      }

      const {
        data: quotation,
        error:
          quotationError,
      } = await admin
        .from("quotations")
        .select(`
          id,
          tenant_id
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

      if (
        quotationError
      ) {
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

      updates.quotation_id =
        quotationId;

      updates.converted_at =
        now;
    }

    const {
      data,
      error,
    } = await admin
      .from("quote_requests")
      .update(updates)
      .eq(
        "id",
        requestId
      )
      .eq(
        "tenant_id",
        tenantId
      )
      .select(`
        id,
        status,
        quotation_id,
        reviewed_at,
        converted_at,
        rejected_at
      `)
      .maybeSingle();

    if (error) {
      throw new Error(
        error.message
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error:
            "Quote request not found.",
        },
        {
          status: 404,
        }
      );
    }

    return NextResponse.json({
      quoteRequest:
        data,
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