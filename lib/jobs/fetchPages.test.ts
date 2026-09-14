import { describe, expect, it } from "vitest";
import { chunk, fetchAllPages } from "./fetchPages";

function source(total: number, withCount = true) {
  const calls: Array<[number, number]> = [];
  const all = Array.from({ length: total }, (_, i) => i);
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    // Mimic the server cap: never more than 1000 rows per request.
    const capped = Math.min(to, from + 999);
    return { data: all.slice(from, capped + 1), error: null, count: withCount ? total : null };
  };
  return { calls, fetchPage };
}

describe("fetchAllPages", () => {
  it("returns every row past the 1000-row cap", async () => {
    const { fetchPage, calls } = source(2300);
    const result = await fetchAllPages(fetchPage, { pageSize: 1000, maxRows: 10000 });
    expect(result.rows).toHaveLength(2300);
    expect(result.total).toBe(2300);
    expect(result.truncated).toBe(false);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops at the ceiling and reports truncation", async () => {
    const { fetchPage } = source(7000);
    const result = await fetchAllPages(fetchPage, { pageSize: 500, maxRows: 1200 });
    expect(result.rows).toHaveLength(1200);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(7000);
  });

  it("reports truncation without a count when the ceiling page was full", async () => {
    const { fetchPage } = source(3000, false);
    const result = await fetchAllPages(fetchPage, { pageSize: 500, maxRows: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.total).toBeNull();
  });

  it("does not claim truncation for an exact fit without a count", async () => {
    const { fetchPage } = source(700, false);
    const result = await fetchAllPages(fetchPage, { pageSize: 500, maxRows: 1000 });
    expect(result.rows).toHaveLength(700);
    expect(result.truncated).toBe(false);
  });

  it("throws the query error instead of returning partial data", async () => {
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });

  it("handles an empty result", async () => {
    const { fetchPage } = source(0);
    expect(await fetchAllPages(fetchPage)).toEqual({ rows: [], total: 0, truncated: false });
  });
});

describe("chunk", () => {
  it("splits into fixed-size groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
