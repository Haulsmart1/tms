/*
  The operator timezone for Planning, Tachograph and Tracking (review PLAN-9,
  PLAN-10, PLAN-20 context).

  company_profiles is keyed by COMPANY id: its tenant_id column holds the
  company id (docs/sql/rls_04_identity_tables.sql). Filtering it through
  tenant.filterByTenant adds `tenant_id = <active tenant id>`, which only
  matches when a tenant's id happens to equal its company id. So the company is
  resolved from tenants.company_id first and the profile is read by that.

  With "All tenants" active the page passes every accessible tenant id. An
  admin's tenants share one company, so that still resolves. A super_admin can
  see several companies at once; there is no single right zone then, so the
  operator default is used and the page says so instead of failing to load.

  Nothing here throws: every failure degrades to Europe/London with a note the
  page shows next to the times it formats.
*/

import type { SupabaseClient } from "@supabase/supabase-js";
import { OPERATOR_TIME_ZONE, resolveTimeZone } from "../time";

export type CompanyTimeZone = {
  timeZone: string;
  /** Plain-language reason the operator default is in use, or null. */
  note: string | null;
};

export type CompanyTimeZoneFacts = {
  companyIds: string[];
  storedTimeZone: unknown;
  loadFailed: boolean;
};

/* Past this many tenants the lookup is skipped: only a super_admin on "All"
   gets here, and they span companies anyway. */
export const COMPANY_TIME_ZONE_TENANT_LIMIT = 200;

export function describeCompanyTimeZone(facts: CompanyTimeZoneFacts): CompanyTimeZone {
  const distinct = [...new Set(facts.companyIds.filter(Boolean))];

  if (facts.loadFailed) {
    return {
      timeZone: OPERATOR_TIME_ZONE,
      note: `The company timezone could not be loaded, so times use ${OPERATOR_TIME_ZONE}.`,
    };
  }

  if (distinct.length > 1) {
    return {
      timeZone: OPERATOR_TIME_ZONE,
      note: `Tenants from more than one company are in view, so times use ${OPERATOR_TIME_ZONE}. Pick a tenant to use its company timezone.`,
    };
  }

  const resolved = resolveTimeZone(facts.storedTimeZone);

  if (resolved.fallback) {
    return {
      timeZone: resolved.timeZone,
      note: `The company timezone "${resolved.requested}" is not a recognised IANA timezone (for example Europe/London), so times use ${OPERATOR_TIME_ZONE}. Fix it in Settings.`,
    };
  }

  return { timeZone: resolved.timeZone, note: null };
}

export async function loadCompanyTimeZone(
  supabase: SupabaseClient,
  tenantIds: string[],
): Promise<CompanyTimeZone> {
  const ids = [...new Set(tenantIds.filter(Boolean))];

  if (ids.length === 0) {
    return { timeZone: OPERATOR_TIME_ZONE, note: null };
  }

  if (ids.length > COMPANY_TIME_ZONE_TENANT_LIMIT) {
    return {
      timeZone: OPERATOR_TIME_ZONE,
      note: `Too many tenants are in view to pick one company timezone, so times use ${OPERATOR_TIME_ZONE}. Pick a tenant to use its company timezone.`,
    };
  }

  try {
    const { data: tenantRows, error: tenantError } = await supabase
      .from("tenants")
      .select("id, company_id")
      .in("id", ids);

    if (tenantError) {
      return describeCompanyTimeZone({ companyIds: [], storedTimeZone: null, loadFailed: true });
    }

    const companyIds = [
      ...new Set(
        (tenantRows ?? [])
          .map((row: { company_id: unknown }) =>
            typeof row.company_id === "string" ? row.company_id : "",
          )
          .filter(Boolean),
      ),
    ];

    if (companyIds.length !== 1) {
      return describeCompanyTimeZone({ companyIds, storedTimeZone: null, loadFailed: false });
    }

    const { data: profile, error: profileError } = await supabase
      .from("company_profiles")
      .select("timezone")
      .eq("tenant_id", companyIds[0])
      .maybeSingle();

    return describeCompanyTimeZone({
      companyIds,
      storedTimeZone: profile?.timezone ?? null,
      loadFailed: Boolean(profileError),
    });
  } catch {
    return describeCompanyTimeZone({ companyIds: [], storedTimeZone: null, loadFailed: true });
  }
}
