import { describe, expect, it } from "vitest";
import { chunk, fetchAllRows } from "./paginate";

function source(total: number) {
  const calls: Array<[number, number]> = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    const rows = [];
    for (let i = from; i <= to && i < total; i++) rows.push(i);
    return { data: rows, error: null };
  };
  return { calls, fetchPage };
}

describe("fetchAllRows", () => {
  it("reads past the 1000-row cap", async () => {
    const { fetchPage } = source(2500);
    const result = await fetchAllRows(fetchPage);
    expect(result.data).toHaveLength(2500);
    expect(result.truncated).toBe(false);
  });

  it("stops after a short page", async () => {
    const { calls, fetchPage } = source(10);
    await fetchAllRows(fetchPage, { pageSize: 5 });
    // 5, 5, then an empty page proves the end.
    expect(calls).toEqual([[0, 4], [5, 9], [10, 14]]);
  });

  it("flags truncation at the ceiling instead of hiding it", async () => {
    const { fetchPage } = source(100);
    const result = await fetchAllRows(fetchPage, { pageSize: 10, maxRows: 30 });
    expect(result.data).toHaveLength(30);
    expect(result.truncated).toBe(true);
  });

  it("returns the error and stops", async () => {
    const result = await fetchAllRows(async () => ({ data: null, error: { message: "boom" } }));
    expect(result.error?.message).toBe("boom");
    expect(result.data).toEqual([]);
  });
});

describe("chunk", () => {
  it("splits into fixed-size groups", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
