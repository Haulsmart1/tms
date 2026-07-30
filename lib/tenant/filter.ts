// filterByTenant scopes a supabase query builder to the active tenant. Q is left fully
// generic (NOT an intersection like `Q & { eq }`) so it does not trip TS2589
// "type instantiation is excessively deep" against postgrest-js's recursive builder
// generics. The single internal cast is the one place that assumes an .eq(column, value).
export function applyTenantFilter<Q>(query: Q, activeTenantId: string | null): Q {
  if (!activeTenantId) return query;
  return (query as unknown as { eq(column: string, value: string): Q }).eq(
    "tenant_id",
    activeTenantId
  );
}
