/*
  The operator's time zone and display name for a driver's tenant. Server-only
  (takes the service-role client). company_profiles is keyed by the COMPANY id
  in its tenant_id column.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { OPERATOR_TIME_ZONE, isValidIanaTimeZone } from "../time";

export type OperatorProfile = { companyId: string | null; timeZone: string; companyName: string | null };

export async function loadOperatorProfile(admin: SupabaseClient, tenantId: string): Promise<OperatorProfile> {
  const { data: tenant, error: tenantError } = await admin.from("tenants").select("company_id").eq("id", tenantId).maybeSingle();
  if (tenantError || !tenant?.company_id) return { companyId: null, timeZone: OPERATOR_TIME_ZONE, companyName: null };

  const companyId = String(tenant.company_id);
  const { data: profile, error: profileError } = await admin
    .from("company_profiles")
    .select("timezone, company_name, trading_name")
    .eq("tenant_id", companyId)
    .maybeSingle();

  if (profileError) {
    console.warn("[driver] company profile lookup failed", profileError.code);
    return { companyId, timeZone: OPERATOR_TIME_ZONE, companyName: null };
  }

  const candidate = typeof profile?.timezone === "string" ? profile.timezone.trim() : "";
  const name = [profile?.trading_name, profile?.company_name].find((v) => typeof v === "string" && v.trim());
  return {
    companyId,
    timeZone: candidate && isValidIanaTimeZone(candidate) ? candidate : OPERATOR_TIME_ZONE,
    companyName: typeof name === "string" ? name.trim() : null,
  };
}

export async function loadOperatorTimeZone(admin: SupabaseClient, tenantId: string): Promise<string> {
  return (await loadOperatorProfile(admin, tenantId)).timeZone;
}
