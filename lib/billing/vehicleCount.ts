// THE billable-count definition. The cron and /super-admin/billing must agree
// on what a billable vehicle is; this is the single implementation.
//
// Semantics mirror app/super-admin/billing/page.tsx: a vehicle is the
// company's when its tenant belongs to the company, or when its tenant_id or
// company_id column equals the company id directly (a legacy data shape the
// page supports). Billable = has at least one active licence.

export type VehicleRow = {
  id: string;
  tenant_id?: string | null;
  company_id?: string | null;
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
          (v.tenant_id != null &&
            (tenantIds.has(v.tenant_id) || v.tenant_id === args.companyId)) ||
          v.company_id === args.companyId
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
