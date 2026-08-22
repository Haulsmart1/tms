import { NextRequest, NextResponse } from "next/server";
import {
  errorResponse,
  requireTenantAccess,
} from "../../../../lib/accounts/server";

export const dynamic = "force-dynamic";

type QuoteLineInput = {
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  vatRate?: unknown;
};

type QuoteStopInput = {
  type?: unknown;
  addressLine?: unknown;
  city?: unknown;
  postcode?: unknown;
  recipientName?: unknown;
  contactPhone?: unknown;
  notes?: unknown;
};

function asNumber(
  value: unknown,
  fallback: number
): number {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function parseLines(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((raw, index) => {
    const line = raw as QuoteLineInput;

    const description = String(
      line.description ?? ""
    ).trim();

    const quantity = asNumber(
      line.quantity,
      1
    );

    const unitPrice = asNumber(
      line.unitPrice,
      0
    );

    const vatRate = asNumber(
      line.vatRate,
      20
    );

    if (!description) {
      throw new Error(
        `Quotation line ${index + 1} requires a description.`
      );
    }

    if (quantity <= 0) {
      throw new Error(
        `Quotation line ${index + 1} quantity must be greater than zero.`
      );
    }

    if (unitPrice < 0 || vatRate < 0) {
      throw new Error(
        `Quotation line ${index + 1} contains invalid values.`
      );
    }

    return {
      description,
      quantity,
      unitPrice,
      vatRate,
    };
  });
}

function parseStops(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((raw, index) => {
    const stop = raw as QuoteStopInput;

    const type = String(
      stop.type ?? ""
    ).toLowerCase();

    if (
      type !== "collection" &&
      type !== "delivery"
    ) {
      throw new Error(
        `Quotation stop ${index + 1} must be collection or delivery.`
      );
    }

    const addressLine = String(
      stop.addressLine ?? ""
    ).trim();

    if (!addressLine) {
      throw new Error(
        `Quotation stop ${index + 1} requires an address.`
      );
    }

    return {
      type,
      addressLine,
      city:
        String(stop.city ?? "").trim() ||
        null,
      postcode:
        String(stop.postcode ?? "")
          .trim()
          .toUpperCase() ||
        null,
      recipientName:
        String(stop.recipientName ?? "").trim() ||
        null,
      contactPhone:
        String(stop.contactPhone ?? "").trim() ||
        null,
      notes:
        String(stop.notes ?? "").trim() ||
        null,
    };
  });
}

export async function GET(
  request: NextRequest
) {
  try {
    const tenantId =
      request.nextUrl.searchParams
        .get("tenantId")
        ?.trim();

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId is required." },
        { status: 400 }
      );
    }

    const { admin } =
      await requireTenantAccess(tenantId);

    const { data, error } = await admin
      .from("quotations")
      .select(`
        *,
        customers (
          id,
          name
        ),
        quotation_lines (
          id,
          line_number,
          description,
          quantity,
          unit_price,
          vat_rate,
          line_subtotal,
          line_vat,
          line_total
        ),
        quotation_stops (
          id,
          stop_order,
          type,
          address_line,
          city,
          postcode,
          recipient_name,
          contact_phone,
          notes
        )
      `)
      .eq("tenant_id", tenantId)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      quotations: data ?? [],
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      { status: result.status }
    );
  }
}

export async function POST(
  request: NextRequest
) {
  let createdQuotationId: string | null =
    null;
  let cleanupAdmin:
    Awaited<
      ReturnType<typeof requireTenantAccess>
    >["admin"] | null = null;

  try {
    const body = await request.json();

    const tenantId = String(
      body.tenantId ?? ""
    ).trim();

    const customerId = String(
      body.customerId ?? ""
    ).trim();

    if (!tenantId || !customerId) {
      return NextResponse.json(
        {
          error:
            "tenantId and customerId are required.",
        },
        { status: 400 }
      );
    }

    const lines = parseLines(body.lines);
    const stops = parseStops(body.stops);

    if (lines.length === 0) {
      return NextResponse.json(
        {
          error:
            "Add at least one quotation line.",
        },
        { status: 400 }
      );
    }

    if (stops.length === 0) {
      return NextResponse.json(
        {
          error:
            "Add at least one quotation stop.",
        },
        { status: 400 }
      );
    }

    const { admin, user } =
      await requireTenantAccess(tenantId);

    cleanupAdmin = admin;

    const {
      data: customer,
      error: customerError,
    } = await admin
      .from("customers")
      .select("id,currency_code")
      .eq("id", customerId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (customerError) {
      throw new Error(customerError.message);
    }

    if (!customer) {
      return NextResponse.json(
        { error: "Customer not found." },
        { status: 404 }
      );
    }

    const quoteDate = String(
      body.quoteDate ??
        new Date()
          .toISOString()
          .slice(0, 10)
    );

    const {
      data: quoteNumber,
      error: numberError,
    } = await admin.rpc(
      "next_quotation_number",
      {
        p_tenant_id: tenantId,
        p_quote_date: quoteDate,
      }
    );

    if (numberError) {
      throw new Error(
        `Unable to allocate quotation number: ${numberError.message}`
      );
    }

    const {
      data: quotation,
      error: quotationError,
    } = await admin
      .from("quotations")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        quote_number: String(quoteNumber),
        status: "draft",
        quote_date: quoteDate,
        valid_until:
          body.validUntil || null,
        proposed_service_date:
          body.proposedServiceDate || null,
        customer_reference:
          String(
            body.customerReference ?? ""
          ).trim() || null,
        po_reference:
          String(
            body.poReference ?? ""
          ).trim() || null,
        currency_code:
          customer.currency_code ||
          "GBP",
        notes:
          String(body.notes ?? "").trim() ||
          null,
        terms:
          String(body.terms ?? "").trim() ||
          null,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (quotationError) {
      throw new Error(
        quotationError.message
      );
    }

    createdQuotationId = quotation.id;

    const { error: lineError } =
      await admin
        .from("quotation_lines")
        .insert(
          lines.map((line, index) => ({
            tenant_id: tenantId,
            quotation_id: quotation.id,
            line_number: index + 1,
            description:
              line.description,
            quantity: line.quantity,
            unit_price:
              line.unitPrice,
            vat_rate: line.vatRate,
          }))
        );

    if (lineError) {
      throw new Error(lineError.message);
    }

    const { error: stopError } =
      await admin
        .from("quotation_stops")
        .insert(
          stops.map((stop, index) => ({
            tenant_id: tenantId,
            quotation_id: quotation.id,
            stop_order: index + 1,
            type: stop.type,
            address_line:
              stop.addressLine,
            city: stop.city,
            postcode: stop.postcode,
            recipient_name:
              stop.recipientName,
            contact_phone:
              stop.contactPhone,
            notes: stop.notes,
          }))
        );

    if (stopError) {
      throw new Error(stopError.message);
    }

    const { error: totalsError } =
      await admin.rpc(
        "recalculate_quotation_totals",
        {
          p_quotation_id:
            quotation.id,
        }
      );

    if (totalsError) {
      throw new Error(
        totalsError.message
      );
    }

    const {
      data: completed,
      error: reloadError,
    } = await admin
      .from("quotations")
      .select(`
        *,
        quotation_lines (*),
        quotation_stops (*)
      `)
      .eq("id", quotation.id)
      .eq("tenant_id", tenantId)
      .single();

    if (reloadError) {
      throw new Error(
        reloadError.message
      );
    }

    createdQuotationId = null;

    return NextResponse.json(
      { quotation: completed },
      { status: 201 }
    );
  } catch (error) {
    if (
      cleanupAdmin &&
      createdQuotationId
    ) {
      await cleanupAdmin
        .from("quotations")
        .delete()
        .eq(
          "id",
          createdQuotationId
        );
    }

    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      { status: result.status }
    );
  }
}

export async function PATCH(
  request: NextRequest
) {
  try {
    const body = await request.json();

    const tenantId = String(
      body.tenantId ?? ""
    ).trim();

    const quotationId = String(
      body.quotationId ?? ""
    ).trim();

    if (!tenantId || !quotationId) {
      return NextResponse.json(
        {
          error:
            "tenantId and quotationId are required.",
        },
        { status: 400 }
      );
    }

    const { admin } =
      await requireTenantAccess(tenantId);

    const {
      data: quotation,
      error: existingError,
    } = await admin
      .from("quotations")
      .select(
        "id,status,converted_job_id"
      )
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        existingError.message
      );
    }

    if (!quotation) {
      return NextResponse.json(
        { error: "Quotation not found." },
        { status: 404 }
      );
    }

    if (
      quotation.converted_job_id
    ) {
      return NextResponse.json(
        {
          error:
            "Converted quotations cannot be changed.",
        },
        { status: 409 }
      );
    }

    const allowedStatuses = new Set([
      "draft",
      "sent",
      "accepted",
      "declined",
      "expired",
      "cancelled",
    ]);

    const status =
      body.status === undefined
        ? null
        : String(
            body.status
          ).toLowerCase();

    if (
      status &&
      !allowedStatuses.has(status)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid quotation status.",
        },
        { status: 400 }
      );
    }

    const updates:
      Record<string, unknown> = {
        updated_at:
          new Date().toISOString(),
      };

    if (status) {
      updates.status = status;
    }

    if (
      body.validUntil !== undefined
    ) {
      updates.valid_until =
        body.validUntil || null;
    }

    if (
      body.proposedServiceDate !==
      undefined
    ) {
      updates.proposed_service_date =
        body.proposedServiceDate ||
        null;
    }

    if (
      body.customerReference !==
      undefined
    ) {
      updates.customer_reference =
        String(
          body.customerReference ??
            ""
        ).trim() || null;
    }

    if (
      body.poReference !== undefined
    ) {
      updates.po_reference =
        String(
          body.poReference ?? ""
        ).trim() || null;
    }

    if (body.notes !== undefined) {
      updates.notes =
        String(body.notes ?? "").trim() ||
        null;
    }

    if (body.terms !== undefined) {
      updates.terms =
        String(body.terms ?? "").trim() ||
        null;
    }

    const { data, error } = await admin
      .from("quotations")
      .update(updates)
      .eq("id", quotationId)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      quotation: data,
    });
  } catch (error) {
    const result = errorResponse(error);

    return NextResponse.json(
      result.body,
      { status: result.status }
    );
  }
}