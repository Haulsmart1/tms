/*
  Detecting a silently truncated list (INV-11).

  Supabase's PostgREST returns at most max_rows rows per request (1000 by
  default) and says nothing when it stops. The accounts list endpoints do not
  paginate yet, so a response of exactly the cap almost certainly means rows
  are missing. The UI uses this to warn instead of presenting truncated KPIs
  as fact. Real pagination and server-side totals are a server change.
*/

export const POSTGREST_DEFAULT_MAX_ROWS = 1000;

export function mayBeTruncated(rowCount: number, cap: number = POSTGREST_DEFAULT_MAX_ROWS): boolean {
  return Number.isFinite(rowCount) && rowCount >= cap;
}
