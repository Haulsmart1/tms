import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filterAssets,
  hasActiveFilters,
  identifierSummary,
  nextSort,
  sortAssets,
} from "./register";
import type { Asset } from "./types";

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: "a",
    company_id: "c",
    tenant_id: "t",
    name: "Trailer",
    asset_type: "Trailer",
    asset_type_id: "type-trailer",
    asset_number: "TRL-1",
    identifier_type: "internal",
    reference: null,
    serial_number: null,
    registration: null,
    barcode: null,
    mechanical: false,
    status: "active",
    notes: null,
    created_at: "2026-10-01T09:00:00",
    archived_at: null,
    archived_by: null,
    ...overrides,
  };
}

const ids = (list: Asset[]) => list.map((item) => item.id);

describe("filterAssets", () => {
  const assets = [
    asset({ id: "1", name: "Curtainsider 12", asset_number: "TRL-012", registration: "AB12 CDE" }),
    asset({
      id: "2",
      name: "Forklift",
      asset_number: "FLT-1",
      asset_type: "Forklift",
      asset_type_id: "type-forklift",
      serial_number: "SN-998",
      mechanical: true,
      status: "maintenance",
    }),
    asset({ id: "3", name: "Pallet cage", asset_number: "PAL-7", barcode: "5012345678900", status: null }),
    asset({
      id: "4",
      name: "Old trailer",
      asset_number: "TRL-001",
      archived_at: "2026-10-02T10:00:00Z",
      status: "inactive",
    }),
  ];

  it("hides archived assets by default", () => {
    expect(ids(filterAssets(assets, EMPTY_FILTERS))).toEqual(["1", "2", "3"]);
  });

  it("shows archived assets when asked", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, showArchived: true }))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it.each([
    ["curtain", "1"],
    ["trl-012", "1"],
    ["ab12 cde", "1"],
    ["sn-998", "2"],
    ["50123", "3"],
  ])("searches name, number, registration, serial and barcode: %s", (query, id) => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, query }))).toEqual([id]);
  });

  it("trims the search and ignores case", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, query: "  FORKLIFT  " }))).toEqual(["2"]);
  });

  it("filters by type id", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, typeId: "type-forklift" }))).toEqual(["2"]);
  });

  it("treats a missing status as active", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, status: "active" }))).toEqual(["1", "3"]);
  });

  it("filters by status", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, status: "maintenance" }))).toEqual(["2"]);
  });

  it("filters by mechanical", () => {
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, mechanical: "yes" }))).toEqual(["2"]);
    expect(ids(filterAssets(assets, { ...EMPTY_FILTERS, mechanical: "no" }))).toEqual(["1", "3"]);
  });

  it("combines filters", () => {
    expect(
      ids(
        filterAssets(assets, {
          ...EMPTY_FILTERS,
          query: "trl",
          status: "inactive",
          showArchived: true,
        }),
      ),
    ).toEqual(["4"]);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the empty filters, a blank query, and the archive toggle alone", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: "   " })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, showArchived: true })).toBe(false);
  });

  it("is true when any narrowing filter is set", () => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, query: "x" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, typeId: "t" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, status: "inactive" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, mechanical: "no" })).toBe(true);
  });
});

describe("identifierSummary", () => {
  it("prefers registration, then serial, then barcode", () => {
    expect(identifierSummary(asset({ registration: "R", serial_number: "S", barcode: "B" }))).toBe("R");
    expect(identifierSummary(asset({ serial_number: "S", barcode: "B" }))).toBe("S");
    expect(identifierSummary(asset({ barcode: "B" }))).toBe("B");
    expect(identifierSummary(asset({}))).toBe("");
  });
});

describe("sortAssets", () => {
  const list = [
    asset({ id: "a", name: "trailer 10", created_at: "2026-10-01T09:00:00" }),
    asset({ id: "b", name: "Trailer 9", created_at: "2026-10-03T09:00:00" }),
    asset({ id: "c", name: "", created_at: "2026-10-02T09:00:00" }),
  ];

  it("defaults to newest first", () => {
    expect(ids(sortAssets(list, DEFAULT_SORT))).toEqual(["b", "c", "a"]);
  });

  it("sorts names case-insensitively and numerically, empty last", () => {
    expect(ids(sortAssets(list, { key: "name", direction: "asc" }))).toEqual(["b", "a", "c"]);
  });

  it("keeps empty values last when descending", () => {
    expect(ids(sortAssets(list, { key: "name", direction: "desc" }))).toEqual(["a", "b", "c"]);
  });

  it("is stable for equal keys in both directions", () => {
    const twins = [asset({ id: "x", name: "Same" }), asset({ id: "y", name: "Same" })];
    expect(ids(sortAssets(twins, { key: "name", direction: "asc" }))).toEqual(["x", "y"]);
    expect(ids(sortAssets(twins, { key: "name", direction: "desc" }))).toEqual(["x", "y"]);
  });

  it("sorts numbers numerically", () => {
    const nums = [
      asset({ id: "ten", asset_number: "TRL-10" }),
      asset({ id: "two", asset_number: "TRL-2" }),
    ];
    expect(ids(sortAssets(nums, { key: "number", direction: "asc" }))).toEqual(["two", "ten"]);
  });

  it("puts a null created_at last under the default sort", () => {
    const dated = [
      asset({ id: "none", created_at: null }),
      asset({ id: "new", created_at: "2026-10-03T09:00:00" }),
      asset({ id: "old", created_at: "2026-10-01T09:00:00" }),
    ];
    expect(ids(sortAssets(dated, DEFAULT_SORT))).toEqual(["new", "old", "none"]);
  });

  it("treats a null status as active when sorting", () => {
    const statuses = [
      asset({ id: "m", status: "maintenance" }),
      asset({ id: "n", status: null }),
      asset({ id: "i", status: "inactive" }),
    ];
    expect(ids(sortAssets(statuses, { key: "status", direction: "asc" }))).toEqual(["n", "i", "m"]);
  });

  it("does not mutate its input", () => {
    const copy = [...list];
    sortAssets(list, { key: "name", direction: "asc" });
    expect(list).toEqual(copy);
  });
});

describe("nextSort", () => {
  it("flips direction on the same key", () => {
    expect(nextSort({ key: "name", direction: "asc" }, "name")).toEqual({ key: "name", direction: "desc" });
    expect(nextSort({ key: "name", direction: "desc" }, "name")).toEqual({ key: "name", direction: "asc" });
  });

  it("starts ascending on a new key", () => {
    expect(nextSort(DEFAULT_SORT, "type")).toEqual({ key: "type", direction: "asc" });
  });
});
