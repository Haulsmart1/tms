/*
  company_profiles is keyed by COMPANY id: its tenant_id column holds the
  company id (docs/sql/rls_04_identity_tables.sql), and its policies compare
  it with get_my_company_id(). Reading or upserting it with a tenant id finds
  nothing and fails RLS on save (review SET-1).

  These helpers decide which tenant to resolve the company from, and read the
  answer out of a tenants row. They are pure so the rule is unit tested.
*/

export type CompanyScopeInput = {
  role: "staff" | "admin" | "super_admin";
  activeTenantId: string | null;
  writeTenantId: string | null;
  tenants: readonly { id: string }[];
};

/**
  The tenant whose tenants.company_id names the company to show.

  - A selected tenant always wins.
  - An admin on "All tenants" only ever sees tenants of their own company, so
    any of them resolves the same company.
  - A super admin on "All tenants" spans many companies: null, pick a tenant.
*/
export function companyLookupTenantId(input: CompanyScopeInput): string | null {
  const selected = input.writeTenantId ?? input.activeTenantId;
  if (selected) return selected;
  if (input.role === "super_admin") return null;
  return input.tenants[0]?.id ?? null;
}

export function companyIdFromTenantRow(row: { company_id?: unknown } | null | undefined): string | null {
  const value = row?.company_id;
  return typeof value === "string" && value.trim() ? value : null;
}
