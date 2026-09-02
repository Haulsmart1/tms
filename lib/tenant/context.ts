export type TenantRole = "staff" | "admin" | "super_admin";
export type TenantStatus = "loading" | "ready" | "signed-out" | "no-tenant";
export type TenantOption = { id: string; name: string };

/* Adding a field here means updating tenantContextEquals in ./revalidate.ts.
   That comparison decides whether a background revalidate is a no-op, so a
   field it does not know about is a change that never reaches the UI. */
export type TenantContextData = {
  status: TenantStatus;
  role: TenantRole;
  companyId: string | null;
  homeTenantId: string | null;
  tenants: TenantOption[];
};

function normalizeRole(role: unknown): TenantRole {
  return role === "super_admin" ? "super_admin" : role === "admin" ? "admin" : "staff";
}

export function parseTenantContext(raw: unknown): TenantContextData {
  const empty: TenantContextData = {
    status: "no-tenant", role: "staff", companyId: null, homeTenantId: null, tenants: [],
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  const status = r.status;
  if (status === "signed-out") return { ...empty, status: "signed-out" };
  if (status !== "ready") return empty;

  const tenants = Array.isArray(r.tenants)
    ? (r.tenants as unknown[])
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({ id: String(t.id), name: String(t.name ?? "") }))
    : [];

  return {
    status: "ready",
    role: normalizeRole(r.role),
    companyId: r.company_id ? String(r.company_id) : null,
    homeTenantId: r.home_tenant_id ? String(r.home_tenant_id) : null,
    tenants,
  };
}

export function pickInitialActiveTenant(
  role: TenantRole,
  homeTenantId: string | null,
  tenants: TenantOption[],
  persisted: string | null
): string | null {
  if (role === "staff") return homeTenantId;
  if (persisted && tenants.some((t) => t.id === persisted)) return persisted;
  return null; // "All tenants"
}

export function computeWriteTenantId(
  role: TenantRole,
  homeTenantId: string | null,
  activeTenantId: string | null
): string | null {
  if (role === "staff") return homeTenantId;
  return activeTenantId; // specific tenant, or null for "All"
}

export function tenantStorageKey(userId: string): string {
  return `tms.activeTenant.${userId}`;
}
