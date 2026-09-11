import { countBillableVehicles, type VehicleRow, type LicenceRow } from "../billing/vehicleCount";

/* Aggregation for the /super-admin dashboard and company list. Pure: the pages
   fetch rows, this turns them into figures. */

export type ChargeRow = {
  company_id: string;
  gross_pence: number | null;
  status: string | null;
  created_at: string | null;
};

/* rows: null means the source could not be read at all, which on this project
   usually means the migration that creates it has not been applied. That is a
   different fact from "no charges", and the tile has to say so. */
export type ChargeSource = {
  key: "v1_cycle" | "v1_addon" | "v2_period";
  label: string;
  rows: ChargeRow[] | null;
};

export type CollectedRevenue = {
  totalPence: number;
  companyCount: number;
  missingSources: string[];
};

const COLLECTED_STATUS = "succeeded";

export function collectedRevenue(
  sources: readonly ChargeSource[],
  now: Date,
  windowDays = 28,
): CollectedRevenue {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000;

  let totalPence = 0;
  const companies = new Set<string>();
  const missingSources: string[] = [];

  for (const source of sources) {
    if (source.rows == null) {
      missingSources.push(source.label);
      continue;
    }

    for (const row of source.rows) {
      /* 'failed', 'pending' and 'refunded' all collected nothing. Only
         'refunded' is subtle: it succeeded and was then given back in full,
         so counting it overstates income by exactly what was returned. */
      if (row.status !== COLLECTED_STATUS) continue;
      if (!row.created_at) continue;

      const at = new Date(row.created_at).getTime();
      if (Number.isNaN(at) || at < cutoff) continue;

      totalPence += row.gross_pence ?? 0;
      companies.add(row.company_id);
    }
  }

  return { totalPence, companyCount: companies.size, missingSources };
}

export type CompanySummary = {
  id: string;
  name: string | null;
  tenantCount: number;
  billableVehicleCount: number;
  userCount: number;
  billingModel: string | null;
  subscriptionStatus: string | null;
};

export type SummaryInput = {
  companies: readonly { id: string; name: string | null }[];
  tenants: readonly { id: string; name?: string | null; company_id: string | null }[];
  vehicles: readonly VehicleRow[];
  licences: readonly LicenceRow[];
  profiles: readonly { id: string; tenant_id: string | null }[];
  billing: readonly { company_id: string; status: string | null; billing_model?: string | null }[];
};

export function buildCompanySummaries(input: SummaryInput): CompanySummary[] {
  const billingByCompany = new Map(input.billing.map((row) => [row.company_id, row]));

  const rows = input.companies.map((company) => {
    const companyTenantIds = input.tenants
      .filter((tenant) => tenant.company_id === company.id)
      .map((tenant) => tenant.id);

    /* A profile belongs to the company when its tenant does, or when its
       tenant_id is the company id directly, the same two-way rule
       countBillableVehicles applies to vehicles. */
    const tenantIdSet = new Set(companyTenantIds);
    const userCount = input.profiles.filter(
      (profile) =>
        profile.tenant_id != null &&
        (tenantIdSet.has(profile.tenant_id) || profile.tenant_id === company.id),
    ).length;

    const billing = billingByCompany.get(company.id) ?? null;

    return {
      id: company.id,
      name: company.name,
      tenantCount: companyTenantIds.length,
      // The single definition of billable. Never count licence rows here: one
      // vehicle legitimately holds several active compliance licences.
      billableVehicleCount: countBillableVehicles({
        companyId: company.id,
        companyTenantIds,
        vehicles: input.vehicles,
        licences: input.licences,
      }),
      userCount,
      billingModel: billing?.billing_model ?? null,
      subscriptionStatus: billing?.status ?? null,
    };
  });

  return rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/* PostgREST reports a table that does not exist as Postgres 42P01, or as
   PGRST205 when the schema cache has never seen it. Both mean "this migration
   is not applied", which the caller must show rather than swallow. */
export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42P01" || code === "PGRST205";
}
