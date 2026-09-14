/*
  Paging for the accounts list endpoints (INV-11).

  PostgREST returns at most max_rows rows (1000 by default) and says nothing
  when it stops, so an unpaged list silently loses its oldest rows. Each list
  endpoint now reads one explicit page with `.range()` and `count: "exact"`,
  and tells the client the total and whether more rows exist.

  Pure so the parsing and the "has more" rule are unit tested.
*/

export const DEFAULT_LIST_PAGE_SIZE = 200;
export const MAX_LIST_PAGE_SIZE = 500;

export type ListPage = {
  page: number;
  pageSize: number;
  /** Inclusive row offsets for PostgREST `.range(from, to)`. */
  from: number;
  to: number;
};

export type ListPageInfo = {
  page: number;
  pageSize: number;
  /** Rows matching the filter across every page; null when the count was unavailable. */
  total: number | null;
  hasMore: boolean;
};

function positiveInteger(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const whole = Math.trunc(parsed);
  return whole >= 1 ? whole : fallback;
}

/** Reads `page` (1-based) and `pageSize` (capped at MAX_LIST_PAGE_SIZE). */
export function parseListPage(
  params: URLSearchParams,
  defaultPageSize: number = DEFAULT_LIST_PAGE_SIZE,
): ListPage {
  const page = Math.min(positiveInteger(params.get("page"), 1), 1_000_000);
  const pageSize = Math.min(positiveInteger(params.get("pageSize"), defaultPageSize), MAX_LIST_PAGE_SIZE);
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

export function listPageInfo(page: ListPage, total: number | null, returned: number): ListPageInfo {
  const hasMore =
    typeof total === "number" && Number.isFinite(total)
      ? page.from + returned < total
      : returned >= page.pageSize;
  return { page: page.page, pageSize: page.pageSize, total: typeof total === "number" ? total : null, hasMore };
}

/** Appends a newly loaded page, dropping rows already on screen. A row can
    reappear on the next page when newer rows were inserted in between. */
export function appendPage<T>(current: readonly T[], next: readonly T[], key: (row: T) => string): T[] {
  const seen = new Set(current.map(key));
  return [...current, ...next.filter((row) => !seen.has(key(row)))];
}
