/*
  PostgREST answers at most max-rows (1000 on Supabase by default) per
  request and says nothing when it stops there, so an unpaginated list is
  silently truncated (review SET-12, SET-21). fetchAllRows pages with
  .range() until a short page, up to a hard ceiling, and reports whether the
  ceiling cut the result off so the page can say so instead of showing a
  quietly wrong total.

  The caller's query must have a deterministic order (end with a unique
  column such as .order("id")), or rows can repeat or vanish across pages.
*/

export type PageResult = {
  data: unknown;
  error: { message: string } | null;
};

export type AllRowsResult = {
  data: unknown[];
  error: { message: string } | null;
  truncated: boolean;
};

export const DEFAULT_PAGE_SIZE = 1000;
export const DEFAULT_MAX_ROWS = 50000;

export async function fetchAllRows(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<AllRowsResult> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE));
  const maxRows = Math.max(pageSize, Math.floor(options.maxRows ?? DEFAULT_MAX_ROWS));
  const rows: unknown[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { data: rows, error, truncated: false };

    const page = Array.isArray(data) ? data : [];
    rows.push(...page);

    if (page.length < to - from + 1) {
      return { data: rows, error: null, truncated: false };
    }
  }

  return { data: rows, error: null, truncated: true };
}

/** Splits a list so an .in() filter never builds an overlong URL. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}
