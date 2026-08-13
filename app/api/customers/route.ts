import { NextRequest, NextResponse } from "next/server";
import { ApiError, requireTenant } from "../../../lib/api/server";

const CUSTOMER_FIELDS = `
  id,
  tenant_id,
  name,
  legal_name,
  trading_name,
  account_code,
  company_number,
  vat_number,
  eori_number,
  website,
  industry_type,
  active,
  contact_name,
  job_title,
  phone,
  mobile,
  email,
  accounts_email,
  operations_email,
  address_line_1,
  address_line_2,
  city,
  county_region,
  postcode,
  country_code,
  payment_terms_days,
  credit_limit,
  credit_status,
  currency_code,
  requires_po,
  default_po_reference,
  default_customer_price,
  fuel_surcharge_percent,
  vat_rate,
  default_collection_instructions,
  default_delivery_instructions,
  default_vehicle_type,
  tail_lift_required,
  adr_required,
  temperature_control_required,
  timed_delivery_required,
  pod_required,
  invoice_pod_attachment_required,
  pallet_exchange_required,
  weekend_delivery_allowed,
  booking_reference_required,
  default_depot,
  default_contact_method,
  account_manager,
  service_level,
  customer_status,
  credit_hold,
  out_of_hours_contact,
  external_customer_id,
  accounting_customer_id,
  crm_customer_id,
  api_enabled,
  webhook_url,
  notes,
  created_at,
  updated_at
`;

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

export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await requireTenant(request);

    const search = request.nextUrl.searchParams.get("search")?.trim();
    const active = request.nextUrl.searchParams.get("active");

    let query = supabase
      .from("customers")
      .select(CUSTOMER_FIELDS)
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });

    if (search) {
      const safeSearch = search.replaceAll(",", " ");
      query = query.or(
        `name.ilike.%${safeSearch}%,legal_name.ilike.%${safeSearch}%,trading_name.ilike.%${safeSearch}%,account_code.ilike.%${safeSearch}%,postcode.ilike.%${safeSearch}%`
      );
    }

    if (active === "true" || active === "false") {
      query = query.eq("active", active === "true");
    }

    const { data, error } = await query;

    if (error) {
      throw new ApiError(400, error.message);
    }

    return NextResponse.json({ customers: data ?? [] });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, tenantId, user } = await requireTenant(request);
    const body = (await request.json()) as Record<string, unknown>;
    const payload = cleanCustomerPayload(body);

    const name = String(payload.name ?? "").trim();

    if (!name) {
      throw new ApiError(400, "Customer name is required");
    }

    payload.name = name;
    payload.tenant_id = tenantId;
    payload.created_by = user.id;

    const { data, error } = await supabase
      .from("customers")
      .insert(payload)
      .select(CUSTOMER_FIELDS)
      .single();

    if (error) {
      throw new ApiError(400, error.message);
    }

    return NextResponse.json({ customer: data }, { status: 201 });
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

  console.error("Customers API error", error);

  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}
