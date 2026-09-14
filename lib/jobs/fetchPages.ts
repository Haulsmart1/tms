/*
  Page through a PostgREST query instead of trusting one request.

  Why (review POD-13): Supabase answers at most 1000 rows per request and says
  nothing when it cuts a result off, so /jobs and /pod silently lost jobs and
  evidence past the cap. This loops with explicit ranges up to a hard ceiling
  and reports `truncated` whenever it stopped before the end, so the page can
  say so instead of hiding data.
*/

export type PageResponse<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

export type FetchAllPagesResult<T> = {
  rows: T[];
  /** Exact total when the query asked for count: "exact"; otherwise null. */
  total: number | null;
  /** True when rows exist beyond what was returned. */
  truncated: boolean;
};

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<FetchAllPagesResult<T>> {
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 500, 1000));
  const maxRows = Math.max(1, options.maxRows ?? 5000);

  const rows: T[] = [];
  let total: number | null = null;
  let lastPageFull = false;

  for (let from = 0; from < maxRows; ) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const response = await fetchPage(from, to);
    if (response.error) throw new Error(response.error.message);
    if (typeof response.count === "number") total = response.count;

    const data = response.data ?? [];
    rows.push(...data);

    const requested = to - from + 1;
    lastPageFull = data.length >= requested;
    if (!lastPageFull) break;
    if (total !== null && rows.length >= total) break;
    from = to + 1;
  }

  const truncated = total !== null ? rows.length < total : rows.length >= maxRows && lastPageFull;
  return { rows, total, truncated };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.trunc(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}
