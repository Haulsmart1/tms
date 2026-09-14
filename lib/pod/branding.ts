/*
  Whose name goes on a POD (review POD-5).

  The PDF and email used to say "ADR Carriers" for every tenant, which put a
  real, different haulier's name on another operator's legal delivery record.
  The name now comes from the tenant's own company:

    tenants.company_id -> company_profiles (keyed by COMPANY id in its
    tenant_id column) trading_name, then company_name -> companies.name

  and never from a hardcoded string. When nothing is configured the document
  says a neutral "Your carrier" rather than borrowing anyone's name.
*/

export const NEUTRAL_CARRIER_NAME = "Your carrier";

export type PodBranding = {
  carrierName: string;
  footerText: string | null;
};

function firstText(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function resolvePodBranding(input: {
  tradingName?: unknown;
  companyProfileName?: unknown;
  companyName?: unknown;
  footerText?: unknown;
}): PodBranding {
  return {
    carrierName: firstText(input.tradingName, input.companyProfileName, input.companyName) ?? NEUTRAL_CARRIER_NAME,
    footerText: firstText(input.footerText),
  };
}
