import { NextRequest, NextResponse } from "next/server";
import { ApiError, apiDbError, requireTenant } from "../../../../lib/api/server";
import { isUuid } from "../../../../lib/auth/serverTenantAccess";
import { validateWebhookUrl } from "../../../../lib/validation/webhookUrl";

const allowedFields = new Set([
  "name",
  "legal_name",
  "trading_name",
  "account_code",
  "company_number",
  "vat_number",
  "eori_number",
  "website",
  "industry_type",
  "active",
  "contact_name",
  "job_title",
  "phone",
  "mobile",
  "email",
  "accounts_email",
  "operations_email",
  "address_line_1",
  "address_line_2",
  "city",
  "county_region",
  "postcode",
  "country_code",
  "payment_terms_days",
  "credit_limit",
  "credit_status",
  "currency_code",
  "requires_po",
  "default_po_reference",
  "default_customer_price",
  "fuel_surcharge_percent",
  "vat_rate",
  "default_collection_instructions",
  "default_delivery_instructions",
  "default_vehicle_type",
  "tail_lift_required",
  "adr_required",
  "temperature_control_required",
  "timed_delivery_required",
  "pod_required",
  "invoice_pod_attachment_required",
  "pallet_exchange_required",
  "weekend_delivery_allowed",
  "booking_reference_required",
  "default_depot",
  "default_contact_method",
  "account_manager",
  "service_level",
  "customer_status",
  "credit_hold",
  "out_of_hours_contact",
  "external_customer_id",
  "accounting_customer_id",
  "crm_customer_id",
  "api_enabled",
  "webhook_url",
  "notes",
]);

function cleanCustomerPayload(body: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => allowedFields.has(key))
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, tenantId } = await requireTenant(request);

    if (!isUuid(id)) {
      throw new ApiError(404, "Customer not found");
    }

    const { data: customer, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      throw apiDbError(error, "Unable to load the customer.");
    }

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    const [contacts, addresses, rates, integrations] = await Promise.all([
      supabase
        .from("customer_contacts")
        .select("*")
        .eq("customer_id", id)
        .eq("tenant_id", tenantId)
        .order("primary_contact", { ascending: false })
        .order("name"),

      supabase
        .from("customer_addresses")
        .select("*")
        .eq("customer_id", id)
        .eq("tenant_id", tenantId)
        .order("site_name"),

      supabase
        .from("customer_rates")
        .select("*")
        .eq("customer_id", id)
        .eq("tenant_id", tenantId)
        .order("rate_name"),

      supabase
        .from("customer_integrations")
        .select("id, integration_type, external_id, api_enabled, webhook_url, active, created_at, updated_at")
        .eq("customer_id", id)
        .eq("tenant_id", tenantId)
        .order("integration_type"),
    ]);

    const childError =
      contacts.error ||
      addresses.error ||
      rates.error ||
      integrations.error;

    if (childError) {
      throw apiDbError(childError, "Unable to load the customer.");
    }

    return NextResponse.json({
      customer,
      contacts: contacts.data ?? [],
      addresses: addresses.data ?? [],
      rates: rates.data ?? [],
      integrations: integrations.data ?? [],
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, tenantId, tier } = await requireTenant(request);

    if (!isUuid(id)) {
      throw new ApiError(404, "Customer not found");
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "The request body must be a JSON object");
    }

    const payload = cleanCustomerPayload(body);

    if (Object.keys(payload).length === 0) {
      throw new ApiError(400, "No valid customer fields supplied");
    }

    if ("name" in payload && !String(payload.name ?? "").trim()) {
      throw new ApiError(400, "Customer name cannot be empty");
    }

    // Review ACC-23: webhook_url must be a public https URL, and only an admin
    // may change api_enabled or webhook_url. The customer form always sends
    // both, so unchanged values from staff are dropped rather than refused.
    if ("webhook_url" in payload) {
      const webhook = validateWebhookUrl(payload.webhook_url);
      if (!webhook.ok) {
        throw new ApiError(400, webhook.message);
      }
      payload.webhook_url = webhook.value;
    }

    if ("api_enabled" in payload) {
      payload.api_enabled = payload.api_enabled === true;
    }

    if (tier === "staff" && ("webhook_url" in payload || "api_enabled" in payload)) {
      const { data: current, error: currentError } = await supabase
        .from("customers")
        .select("api_enabled, webhook_url")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (currentError) {
        throw apiDbError(currentError, "Unable to save the customer.");
      }

      if (!current) {
        throw new ApiError(404, "Customer not found");
      }

      const webhookChanged =
        "webhook_url" in payload && (payload.webhook_url ?? null) !== (current.webhook_url || null);
      const apiChanged =
        "api_enabled" in payload && payload.api_enabled !== (current.api_enabled === true);

      if (webhookChanged || apiChanged) {
        throw new ApiError(403, "Only an admin can change API access or the webhook URL");
      }

      delete payload.webhook_url;
      delete payload.api_enabled;

      if (Object.keys(payload).length === 0) {
        return NextResponse.json({ customer: current });
      }
    }

    const { data, error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .maybeSingle();

    if (error) {
      throw apiDbError(error, "Unable to save the customer.");
    }

    if (!data) {
      throw new ApiError(404, "Customer not found");
    }

    return NextResponse.json({ customer: data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { supabase, tenantId } = await requireTenant(request);

    if (!isUuid(id)) {
      throw new ApiError(404, "Customer not found");
    }

    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      throw apiDbError(error, "Unable to delete the customer.");
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status }
    );
  }

  console.error("Customer detail API error", error);

  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}
