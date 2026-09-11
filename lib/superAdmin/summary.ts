import { countBillableVehicles, type VehicleRow, type LicenceRow } from "../billing/vehicleCount";

/* Aggregation for the /super-admin dashboard and company list. Pure: the pages
   fetch rows, this turns them into figures. */

export type ChargeRow = {
  company_id: string;
  // bigint over the wire: usually a number, but a string must be accepted
  // and coerced rather than concatenated. See the Number(...) call below.
  gross_pence: number | string | null;
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
  // A source whose query returned rows, but zero of them -- distinct from
  // missingSources (isMissingRelationError, table does not exist at all).
  // Zero rows is genuinely ambiguous: it means either "no charges in the
  // window" or "the table exists but the caller cannot read it", and those
  // look identical over PostgREST. docs/sql/billing_06_period_billing.sql:451
  // names the concrete cause this project already has one of: "A policy
  // without a grant reads as an empty table, not as an error." Naming the
  // source here, instead of collapsing it into the total, gives an operator
  // seeing an unexpectedly low figure somewhere to look.
  zeroRowSources: string[];
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
  const zeroRowSources: string[] = [];

  for (const source of sources) {
    if (source.rows == null) {
      missingSources.push(source.label);
      continue;
    }

    // See CollectedRevenue.zeroRowSources: an empty array here is read
    // BEFORE the loop below runs, so it names "the query returned nothing
    // at all", not "nothing matched the status/window filter" -- the two
    // are the same fact for this caller (loadChargeSource already filters
    // status and created_at server-side), but recording it here, rather
    // than after filtering, is what makes that fact available even if a
    // future caller stops pre-filtering.
    if (source.rows.length === 0) {
      zeroRowSources.push(source.label);
    }

    for (const row of source.rows) {
      /* 'failed' and 'pending' collected nothing. 'refunded' is subtle: it
         succeeded and was then given back in full, so counting it overstates
         income by exactly what was returned. Only period_charges can carry
         it: platform_charges and vehicle_addon_charges constrain status to
         succeeded/failed only, so a v1 row can never be 'refunded' today. If
         a v1 refund path is ever added, this function would overstate
         silently until it is taught to handle it too. */
      if (row.status !== COLLECTED_STATUS) continue;

      // created_at is `not null` on all three tables, so neither guard below
      // is reachable today. They stay as belt and braces: a malformed date
      // must be excluded loudly (well, by omission from the total) rather
      // than turning into NaN and poisoning every later +=.
      if (!row.created_at) continue;

      const at = new Date(row.created_at).getTime();
      if (Number.isNaN(at) || at < cutoff) continue;

      // gross_pence is a Postgres bigint, which the client can hand back as a
      // string. Number(...) guards that: "0 + '10000'" would be the string
      // "010000", and every later += would append instead of sum.
      const grossPence = Number(row.gross_pence ?? 0);
      totalPence += grossPence;

      // A v2 balance that settles to nothing owed still inserts a
      // status = 'succeeded', gross_pence = 0 row (see
      // lib/billing/periodPaymentServer.ts). That is a normal outcome, not a
      // payment, so it must not make the company count as having paid.
      if (grossPence > 0) {
        companies.add(row.company_id);
      }
    }
  }

  // totalPence is cash collected GROSS, VAT included. The VAT portion is
  // owed to HMRC, not profit, which is why this tile is labelled "Collected"
  // rather than "Revenue".
  return { totalPence, companyCount: companies.size, missingSources, zeroRowSources };
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
  profiles: readonly { id: string; tenant_id: string | null; company_id?: string | null }[];
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
       countBillableVehicles applies to vehicles. profiles.company_id is a
       third path: nothing in the repo writes it today (only read, at
       app/api/settings/users/invite/route.ts), so any row carrying it was
       seeded by hand, plausibly the account holder, and would otherwise be
       undercounted by exactly one person. */
    const tenantIdSet = new Set(companyTenantIds);
    const userCount = input.profiles.filter(
      (profile) =>
        (profile.tenant_id != null &&
          (tenantIdSet.has(profile.tenant_id) || profile.tenant_id === company.id)) ||
        profile.company_id === company.id,
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

/* Platform-wide billable count for the /super-admin dashboard: how many
   vehicles across the WHOLE platform have at least one active licence. Not a
   per-company sum: the dashboard wants "how many vehicles are billable", and
   a vehicle with two active compliance licences is still one vehicle.

   Deliberately applies the SAME v.tenant_id != null rule as
   countBillableVehicles in ../billing/vehicleCount.ts. That rule closes ONE
   of two gaps between this headline and the sum of the per-company figures:
   without it, a vehicle with no tenant_id at all would count here but be
   invisible to every per-company figure on /super-admin/billing (which can
   only attribute a vehicle to a company through its tenant).

   It does NOT close the other gap: a vehicle whose tenant_id is set but
   points at a tenant with no company_id, or at no tenant row at all (a
   dangling id), still passes this filter and counts here, while still being
   invisible to every per-company figure -- companies list included, since
   buildCompanySummaries above can only attribute a vehicle to a company
   through a resolved tenant->company_id chain. So this headline CAN still
   exceed the sum of its parts, just not for the reason the tenant_id check
   guards against. That headline is the number people quote, so the residual
   is recorded here rather than left to be rediscovered as a mismatch. */
export function platformBillableVehicleCount(
  vehicles: readonly VehicleRow[],
  licences: readonly LicenceRow[],
): number {
  const activeVehicleIds = new Set(
    licences.filter((licence) => licence.active).map((licence) => licence.vehicle_id),
  );

  return vehicles.filter((vehicle) => vehicle.tenant_id != null && activeVehicleIds.has(vehicle.id))
    .length;
}

/* PostgREST reports a table that does not exist as Postgres 42P01, or as
   PGRST205 when the schema cache has never seen it. Both mean "this migration
   is not applied", which the caller must show rather than swallow. */
export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42P01" || code === "PGRST205";
}

/* A sibling of isMissingRelationError for a migration that adds a COLUMN to
   an existing table rather than a whole new table (billing_06 adding
   company_billing.billing_model is the motivating case). That failure mode
   surfaces differently: Postgres reports an undefined column as 42703, and
   PostgREST reports its own schema-cache miss for a column as PGRST204, not
   PGRST205, which is the missing-TABLE code above. Conflating the two would
   let an unrelated 42703 - a genuine typo in a query, say - get silently
   waved through as "expected, migration not applied". */
export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42703" || code === "PGRST204";
}
