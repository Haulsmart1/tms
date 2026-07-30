// Minimal chainable shape we rely on from a supabase-js query builder.
export type TenantQuery<Q> = Q & { eq(column: string, value: string): Q };

export function applyTenantFilter<Q>(query: TenantQuery<Q>, activeTenantId: string | null): Q {
  return activeTenantId ? query.eq("tenant_id", activeTenantId) : query;
}
