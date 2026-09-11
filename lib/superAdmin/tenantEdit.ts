const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Normalization and validation for a super-admin tenant edit (rename, and/or
   re-parent to a different company).

   THE SECURITY CONTROL OF THIS FEATURE. The route that calls this holds the
   service-role key, which bypasses Row Level Security completely. Passing a
   request body straight to .update() would let any key in that body reach any
   column of tenants. This function only ever returns the two fields it
   understands (name, companyId); the consuming route builds its patch from
   those, never from the raw body, so an extra key in the request (id, or a
   made-up column) is silently dropped rather than reaching Postgres.

   Presence, not value, is what the caller cares about: a request that omits
   company_id entirely must leave tenants.company_id untouched, and a request
   that omits name must leave tenants.name untouched. That is why this returns
   optional fields rather than nulls -- `"companyId" in result` (or, as used
   here, `result.companyId !== undefined`) is how the route tells "rename
   only" apart from "move". Collapsing an absent field to null here would make
   a rename request indistinguishable from a request that tried to move the
   tenant to company null. */

export type TenantEditResult =
  | { ok: true; name?: string; companyId?: string }
  | { ok: false; error: string; field?: string };

export function normalizeTenantEdit(input: unknown): TenantEditResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Expected a JSON object." };
  }

  const body = input as { name?: unknown; company_id?: unknown };
  const hasName = "name" in body && body.name !== undefined;
  const hasCompanyId = "company_id" in body && body.company_id !== undefined;

  if (!hasName && !hasCompanyId) {
    return { ok: false, error: "Provide a name, a company_id, or both." };
  }

  const result: { name?: string; companyId?: string } = {};

  if (hasName) {
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return { ok: false, error: "Tenant name cannot be blank.", field: "name" };
    }
    result.name = body.name.trim();
  }

  if (hasCompanyId) {
    if (typeof body.company_id !== "string" || body.company_id.trim() === "") {
      return { ok: false, error: "A company_id is required to move this tenant.", field: "company_id" };
    }

    const trimmed = body.company_id.trim();

    // Checked here, not left for Postgres: an id shaped wrong for a uuid
    // column reaches PostgREST as 22P02, which the route would otherwise
    // have to distinguish from "no such company" by parsing Supabase error
    // text -- exactly what the route must never surface to the client.
    if (!UUID_PATTERN.test(trimmed)) {
      return { ok: false, error: "That is not a valid company id.", field: "company_id" };
    }

    result.companyId = trimmed;
  }

  return { ok: true, ...result };
}
