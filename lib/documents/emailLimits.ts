import type { SupabaseClient } from "@supabase/supabase-js";
import { RATE_LIMITS, checkRateLimit, type RateLimitRule } from "../rateLimit";

/*
  Shared limits for every customer-facing document email (invoices,
  quotations, POD share links, tracking links). Review N-10: a company with
  no card on file is capped far lower than a paying one, so a self-serve
  signup cannot use the platform's sender as a branded mail relay.
*/

export type BillingCardRow = { square_card_id: string | null; status: string | null } | null;

export function isEmailVerifiedCompany(row: BillingCardRow): boolean {
  if (!row) return false;
  if (row.status === "canceled") return false;
  return typeof row.square_card_id === "string" && row.square_card_id.trim() !== "";
}

export type DocumentEmailRule = { rule: RateLimitRule; key: "user" | "tenant" };

export function documentEmailRules(verified: boolean): DocumentEmailRule[] {
  const rules: DocumentEmailRule[] = [
    { rule: RATE_LIMITS.documentEmailPerUser, key: "user" },
    { rule: RATE_LIMITS.documentEmailPerTenant, key: "tenant" },
  ];
  if (!verified) rules.push({ rule: RATE_LIMITS.documentEmailPerUnverifiedTenant, key: "tenant" });
  return rules;
}

/** The tenant's company billing row, read with the service role. A lookup failure counts as unverified. */
async function loadBillingCard(admin: SupabaseClient, tenantId: string): Promise<BillingCardRow> {
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("company_id")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError || !tenant?.company_id) return null;
  const { data, error } = await admin
    .from("company_billing")
    .select("square_card_id,status")
    .eq("company_id", tenant.company_id)
    .maybeSingle();
  if (error || !data) return null;
  return { square_card_id: data.square_card_id ?? null, status: data.status ?? null };
}

/** True when every document email limit allows one more send for this user and tenant. */
export async function documentEmailAllowed(admin: SupabaseClient, userId: string, tenantId: string): Promise<boolean> {
  const verified = isEmailVerifiedCompany(await loadBillingCard(admin, tenantId));
  const results = await Promise.all(
    documentEmailRules(verified).map(({ rule, key }) => checkRateLimit(admin, rule, key === "user" ? userId : tenantId)),
  );
  return results.every((r) => r.allowed);
}
