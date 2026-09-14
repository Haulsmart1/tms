/*
  Server-only loader for lib/pod/branding.ts. company_profiles is keyed by the
  COMPANY id (stored in its tenant_id column), so the lookup goes through
  tenants.company_id. A failed lookup falls back to a neutral name, never to
  another company's. Never import from client code.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePodBranding, type PodBranding } from "./branding";

export async function loadPodBranding(admin: SupabaseClient, tenantId: string): Promise<PodBranding> {
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, company_id")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError) console.warn("[pod-branding] tenant lookup failed", tenantError.code);

  const companyId = tenant?.company_id ? String(tenant.company_id) : null;

  const [profile, company, documents] = await Promise.all([
    companyId
      ? admin.from("company_profiles").select("company_name, trading_name").eq("tenant_id", companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    companyId
      ? admin.from("companies").select("name").eq("id", companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin.from("document_settings").select("footer_text").eq("tenant_id", tenantId).maybeSingle(),
  ]);

  for (const [label, result] of [["company_profiles", profile], ["companies", company], ["document_settings", documents]] as const) {
    if (result.error) console.warn(`[pod-branding] ${label} lookup failed`, result.error.code);
  }

  return resolvePodBranding({
    tradingName: profile.data?.trading_name,
    companyProfileName: profile.data?.company_name,
    companyName: company.data?.name,
    footerText: documents.data?.footer_text,
  });
}
