/*
  Detecting a silently truncated list (INV-11).

  Supabase's PostgREST returns at most max_rows rows per request (1000 by
  default) and says nothing when it stops. The main accounts list endpoints now
  page (page/pageSize) and the invoice KPIs come from server-side totals, so
  this remains only for lists that are still loaded in one request, such as
  the credit-note invoice picker: a response of exactly the cap almost
  certainly means rows are missing, and the UI warns instead of presenting a
  truncated list as complete.
*/

export const POSTGREST_DEFAULT_MAX_ROWS = 1000;

export function mayBeTruncated(rowCount: number, cap: number = POSTGREST_DEFAULT_MAX_ROWS): boolean {
  return Number.isFinite(rowCount) && rowCount >= cap;
}
