/*
  Company profile and document settings for PDF generation (review ACC-21).

  The invoice and quotation email routes used to fetch /api/settings/documents
  over HTTP with a URL built from the request Host and the caller's cookies
  forwarded. They now call this loader directly with the service-role client,
  after they have authorized the caller for `tenantId`. Branding is optional:
  any failure returns null and the PDF renders without it, as before.

  app/api/settings/documents/route.ts reads the same two records through
  loadBrandingRecords, so the settings page and the PDFs can never disagree
  about which company profile or logo applies.

  Server-only.
*/

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadTenantRef } from "../auth/serverTenantAccess";

// Loosely typed on purpose: the PDF generators declare their own input shapes,
// and these rows previously arrived untyped from response.json().
export type DocumentBranding = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  companyProfile: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  documentSettings: any;
};

export class DocumentBrandingReadError extends Error {
  constructor(
    readonly label: string,
    readonly code: string | undefined,
  ) {
    super(label);
  }
}

const COMPANY_PROFILE_COLUMNS =
  "tenant_id,company_name,trading_name,registration_number,vat_number,business_email,business_phone,website,address_line_1,address_line_2,city,region,postcode,country_code";

const DOCUMENT_SETTINGS_COLUMNS =
  "id,tenant_id,logo_path,footer_text,bank_details,generic_document_note,show_logo,show_company_registration,show_vat_number,show_contact_details,created_at,updated_at";

/**
 * The company profile and document settings for one tenant. Throws
 * DocumentBrandingReadError when a read fails.
 *
 * SET-1: company_profiles.tenant_id holds the COMPANY id
 * (docs/sql/rls_04_identity_tables.sql), so it is resolved through the tenant.
 * SET-15: only a logo inside this tenant's own folder is ever signed.
 */
export async function loadBrandingRecords(admin: SupabaseClient, tenantId: string): Promise<DocumentBranding> {
  const tenantRef = await loadTenantRef(admin, tenantId);
  const companyId = tenantRef?.companyId ?? null;

  const [companyResult, documentResult] = await Promise.all([
    companyId
      ? admin.from("company_profiles").select(COMPANY_PROFILE_COLUMNS).eq("tenant_id", companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from("document_settings").select(DOCUMENT_SETTINGS_COLUMNS).eq("tenant_id", tenantId).maybeSingle(),
  ]);

  if (companyResult.error) throw new DocumentBrandingReadError("company profile read", companyResult.error.code);
  if (documentResult.error) throw new DocumentBrandingReadError("document settings read", documentResult.error.code);

  let logoSignedUrl: string | null = null;
  const logoPath = documentResult.data?.logo_path;
  if (typeof logoPath === "string" && logoPath.startsWith(`${tenantId}/logo/`)) {
    const { data, error } = await admin.storage.from("document-branding").createSignedUrl(logoPath, 60 * 60);
    if (!error) logoSignedUrl = data?.signedUrl ?? null;
  }

  return {
    companyProfile: companyResult.data ?? null,
    documentSettings: documentResult.data ? { ...documentResult.data, logo_signed_url: logoSignedUrl } : null,
  };
}

export async function loadDocumentBranding(admin: SupabaseClient, tenantId: string): Promise<DocumentBranding | null> {
  try {
    return await loadBrandingRecords(admin, tenantId);
  } catch (error) {
    console.error(
      "[documentBranding] lookup failed",
      error instanceof DocumentBrandingReadError ? `${error.label} ${error.code ?? ""}` : error,
    );
    return null;
  }
}
