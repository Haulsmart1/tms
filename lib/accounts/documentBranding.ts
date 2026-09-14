/*
  Company profile and document settings for PDF generation (review ACC-21).

  The invoice and quotation email routes used to fetch /api/settings/documents
  over HTTP with a URL built from the request Host and the caller's cookies
  forwarded. They now call this loader directly with the service-role client,
  after they have authorized the caller for `tenantId`. Branding is optional:
  any failure returns null and the PDF renders without it, as before.

  Server-only. The select lists mirror loadSettings() in
  app/api/settings/documents/route.ts.
*/

import type { SupabaseClient } from "@supabase/supabase-js";

// Loosely typed on purpose: the PDF generators declare their own input shapes,
// and these rows previously arrived untyped from response.json().
export type DocumentBranding = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  companyProfile: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  documentSettings: any;
};

export async function loadDocumentBranding(admin: SupabaseClient, tenantId: string): Promise<DocumentBranding | null> {
  try {
    const [companyResult, documentResult] = await Promise.all([
      admin
        .from("company_profiles")
        .select(
          "tenant_id,company_name,trading_name,registration_number,vat_number,business_email,business_phone,website,address_line_1,address_line_2,city,region,postcode,country_code",
        )
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      admin
        .from("document_settings")
        .select(
          "id,tenant_id,logo_path,footer_text,bank_details,generic_document_note,show_logo,show_company_registration,show_vat_number,show_contact_details,created_at,updated_at",
        )
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

    if (companyResult.error || documentResult.error) {
      console.error("[documentBranding] lookup failed", companyResult.error?.code, documentResult.error?.code);
      return null;
    }

    let logoSignedUrl: string | null = null;
    const logoPath = documentResult.data?.logo_path;
    if (typeof logoPath === "string" && logoPath) {
      const { data, error } = await admin.storage.from("document-branding").createSignedUrl(logoPath, 60 * 60);
      if (!error) logoSignedUrl = data?.signedUrl ?? null;
    }

    return {
      companyProfile: companyResult.data ?? null,
      documentSettings: documentResult.data ? { ...documentResult.data, logo_signed_url: logoSignedUrl } : null,
    };
  } catch (error) {
    console.error("[documentBranding] unexpected failure", error);
    return null;
  }
}
