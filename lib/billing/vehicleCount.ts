// THE billable-count definition. The cron and /super-admin/billing must agree
// on what a billable vehicle is; this is the single implementation.
//
// Semantics mirror app/super-admin/billing/page.tsx: a vehicle is the
// company's when its tenant belongs to the company, or when its tenant_id
// equals the company id directly (rows written before tenants existed).
// Billable = has at least one active licence.
//
// There is no vehicles.company_id column in the schema, so nothing here may
// look for one: doing so made both callers select a column that does not
// exist and fail with Postgres 42703.

export type VehicleRow = {
  id: string;
  tenant_id?: string | null;
};

export type LicenceRow = {
  vehicle_id: string;
  active: boolean | null;
};

export function countBillableVehicles(args: {
  companyId: string;
  companyTenantIds: readonly string[];
  vehicles: readonly VehicleRow[];
  licences: readonly LicenceRow[];
}): number {
  const tenantIds = new Set(args.companyTenantIds);

  const companyVehicleIds = new Set(
    args.vehicles
      .filter(
        (v) =>
          v.tenant_id != null &&
          (tenantIds.has(v.tenant_id) || v.tenant_id === args.companyId)
      )
      .map((v) => v.id)
  );

  const licensed = new Set(
    args.licences
      .filter((l) => l.active && companyVehicleIds.has(l.vehicle_id))
      .map((l) => l.vehicle_id)
  );

  return licensed.size;
}
