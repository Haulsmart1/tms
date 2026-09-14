import { NextRequest, NextResponse } from "next/server";

import {
  ACCOUNTS_ADMIN_ROLES,
  errorResponse,
  requireTenantAccess,
} from "../../../../lib/accounts/server";
import { loadTenantRef } from "../../../../lib/auth/serverTenantAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AdminClient = Awaited<ReturnType<typeof requireTenantAccess>>["admin"];

class DocumentsRouteError extends Error {}

function cleanText(value: unknown): string | null {
  const result = String(value ?? "").trim();
  return result || null;
}

function cleanBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function cleanInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function fail(label: string, error: { code?: string; message?: string }): never {
  console.error(`[settings/documents] ${label} failed`, error.code, error.message);
  throw new DocumentsRouteError(label);
}

function respondError(error: unknown) {
  if (error instanceof DocumentsRouteError) {
    return NextResponse.json({ error: "Unable to load or save document settings." }, { status: 500 });
  }
  const result = errorResponse(error);
  // Only the auth outcomes carry a safe message; anything else is generic.
  const body = result.status === 500 ? { error: "Unable to load or save document settings." } : result.body;
  if (result.status === 500) console.error("[settings/documents] unexpected error", error);
  return NextResponse.json(body, { status: result.status });
}

async function loadSettings(admin: AdminClient, tenantId: string) {
  /* SET-1: company_profiles.tenant_id holds the COMPANY id
     (docs/sql/rls_04_identity_tables.sql), so resolve it through the tenant. */
  const tenantRef = await loadTenantRef(admin, tenantId);
  const companyId = tenantRef?.companyId ?? null;

  const [companyResult, documentResult, quotationResult] = await Promise.all([
    companyId
      ? admin
          .from("company_profiles")
          .select(`
            tenant_id,
            company_name,
            trading_name,
            registration_number,
            vat_number,
            business_email,
            business_phone,
            website,
            address_line_1,
            address_line_2,
            city,
            region,
            postcode,
            country_code
          `)
          .eq("tenant_id", companyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),

    admin
      .from("document_settings")
      .select(`
        id,
        tenant_id,
        logo_path,
        footer_text,
        bank_details,
        generic_document_note,
        show_logo,
        show_company_registration,
        show_vat_number,
        show_contact_details,
        created_at,
        updated_at
      `)
      .eq("tenant_id", tenantId)
      .maybeSingle(),

    admin
      .from("quotation_template_settings")
      .select(`
        tenant_id,
        heading,
        intro_text,
        default_notes,
        default_terms,
        footer_text,
        default_valid_days,
        email_subject_template,
        email_body_template,
        auto_create_job_on_accept,
        show_company_registration,
        show_vat_number,
        show_route_details,
        show_line_vat
      `)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (companyResult.error) fail("company profile read", companyResult.error);
  if (documentResult.error) fail("document settings read", documentResult.error);
  if (quotationResult.error) fail("quotation template read", quotationResult.error);

  let logoSignedUrl: string | null = null;
  const logoPath = documentResult.data?.logo_path;

  // Only ever sign a path inside this tenant's own logo folder (SET-15).
  if (typeof logoPath === "string" && logoPath.startsWith(`${tenantId}/logo/`)) {
    const { data: signedLogo, error: signedLogoError } = await admin.storage
      .from("document-branding")
      .createSignedUrl(logoPath, 60 * 60);

    if (!signedLogoError) {
      logoSignedUrl = signedLogo?.signedUrl ?? null;
    }
  }

  return {
    companyProfile: companyResult.data,
    documentSettings: documentResult.data
      ? { ...documentResult.data, logo_signed_url: logoSignedUrl }
      : null,
    quotationTemplate: quotationResult.data,
  };
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId")?.trim() ?? "";

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin, role } = await requireTenantAccess(tenantId);

    /* SET-25: office staff print invoices and quotations, which carry bank
       details and the company header, so they keep read access. Drivers have
       no use for bank details or email templates. */
    if (role === "driver") {
      return NextResponse.json({ error: "You do not have access to document settings." }, { status: 403 });
    }

    return NextResponse.json(await loadSettings(admin, tenantId));
  } catch (error) {
    return respondError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const tenantId = String(body.tenantId ?? "").trim();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { admin } = await requireTenantAccess(tenantId, ACCOUNTS_ADMIN_ROLES);

    const document = body.documentSettings ?? {};
    const quotation = body.quotationTemplate ?? {};

    /* SET-15: logo_path is deliberately absent. The logo route
       (./logo/route.ts) is the only writer, and it validates the path. Left
       out of the upsert, an update keeps the stored value, so a stale
       autosave can no longer overwrite a freshly uploaded logo and a crafted
       body cannot point at another tenant's file. */
    const documentPayload = {
      tenant_id: tenantId,
      footer_text: cleanText(document.footer_text),
      bank_details: cleanText(document.bank_details),
      generic_document_note: cleanText(document.generic_document_note),
      show_logo: cleanBoolean(document.show_logo, true),
      show_company_registration: cleanBoolean(document.show_company_registration, true),
      show_vat_number: cleanBoolean(document.show_vat_number, true),
      show_contact_details: cleanBoolean(document.show_contact_details, true),
    };

    const { error: documentUpsertError } = await admin
      .from("document_settings")
      .upsert(documentPayload, { onConflict: "tenant_id" });

    if (documentUpsertError) fail("document settings save", documentUpsertError);

    const quotationPayload = {
      tenant_id: tenantId,
      heading: cleanText(quotation.heading) ?? "Quotation",
      intro_text: cleanText(quotation.intro_text),
      default_notes: cleanText(quotation.default_notes),
      default_terms: cleanText(quotation.default_terms),
      footer_text: cleanText(quotation.footer_text),
      default_valid_days: cleanInteger(quotation.default_valid_days, 14, 1, 365),
      email_subject_template:
        cleanText(quotation.email_subject_template) ?? "Quotation {{quote_number}} from {{company_name}}",
      email_body_template:
        cleanText(quotation.email_body_template) ??
        "Please review quotation {{quote_number}} using the secure link below.",
      auto_create_job_on_accept: cleanBoolean(quotation.auto_create_job_on_accept, false),
      show_company_registration: cleanBoolean(quotation.show_company_registration, true),
      show_vat_number: cleanBoolean(quotation.show_vat_number, true),
      show_route_details: cleanBoolean(quotation.show_route_details, true),
      show_line_vat: cleanBoolean(quotation.show_line_vat, true),
    };

    const { data: existingQuotation, error: existingQuotationError } = await admin
      .from("quotation_template_settings")
      .select("tenant_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (existingQuotationError) fail("quotation template read", existingQuotationError);

    if (existingQuotation) {
      const { error: quotationUpdateError } = await admin
        .from("quotation_template_settings")
        .update(quotationPayload)
        .eq("tenant_id", tenantId);

      if (quotationUpdateError) fail("quotation template save", quotationUpdateError);
    } else {
      const { error: quotationInsertError } = await admin
        .from("quotation_template_settings")
        .insert(quotationPayload);

      if (quotationInsertError) fail("quotation template save", quotationInsertError);
    }

    return NextResponse.json(await loadSettings(admin, tenantId));
  } catch (error) {
    return respondError(error);
  }
}
