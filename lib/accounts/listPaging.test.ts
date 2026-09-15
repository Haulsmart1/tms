import { describe, expect, it } from "vitest";

import { appendPage, DEFAULT_LIST_PAGE_SIZE, listPageInfo, MAX_LIST_PAGE_SIZE, parseListPage } from "./listPaging";

const params = (query: string) => new URLSearchParams(query);

describe("parseListPage", () => {
  it("defaults to the first page", () => {
    expect(parseListPage(params(""))).toEqual({
      page: 1,
      pageSize: DEFAULT_LIST_PAGE_SIZE,
      from: 0,
      to: DEFAULT_LIST_PAGE_SIZE - 1,
    });
  });

  it("computes the inclusive range for a later page", () => {
    expect(parseListPage(params("page=3&pageSize=50"))).toEqual({ page: 3, pageSize: 50, from: 100, to: 149 });
  });

  it("caps the page size and ignores nonsense", () => {
    expect(parseListPage(params("pageSize=100000")).pageSize).toBe(MAX_LIST_PAGE_SIZE);
    expect(parseListPage(params("page=-2&pageSize=abc"))).toMatchObject({ page: 1, pageSize: DEFAULT_LIST_PAGE_SIZE });
    expect(parseListPage(params("page=0&pageSize=0"))).toMatchObject({ page: 1, pageSize: DEFAULT_LIST_PAGE_SIZE });
  });
});

describe("listPageInfo", () => {
  it("uses the exact count when present", () => {
    const page = parseListPage(params("page=2&pageSize=10"));
    expect(listPageInfo(page, 25, 10)).toEqual({ page: 2, pageSize: 10, total: 25, hasMore: true });
    expect(listPageInfo(page, 20, 10)).toEqual({ page: 2, pageSize: 10, total: 20, hasMore: false });
  });

  it("falls back to a full page meaning more when the count is missing", () => {
    const page = parseListPage(params("pageSize=10"));
    expect(listPageInfo(page, null, 10).hasMore).toBe(true);
    expect(listPageInfo(page, null, 4).hasMore).toBe(false);
  });
});

describe("appendPage", () => {
  it("appends new rows and skips ones already shown", () => {
    const current = [{ id: "a" }, { id: "b" }];
    expect(appendPage(current, [{ id: "b" }, { id: "c" }], (row) => row.id)).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });
});
