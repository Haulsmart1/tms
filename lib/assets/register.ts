/* What the /assets register shows and in what order. Pure and client-side:
   the page loads the tenant's whole list once and narrows it here, which is
   fine at fleet scale (revisit if a tenant passes a few thousand assets). */

import type { Asset } from "./types";

export type StatusFilter = "any" | "active" | "maintenance" | "inactive";
export type MechanicalFilter = "any" | "yes" | "no";

export type AssetFilters = {
  query: string;
  typeId: string;
  status: StatusFilter;
  mechanical: MechanicalFilter;
  showArchived: boolean;
};

export const EMPTY_FILTERS: AssetFilters = {
  query: "",
  typeId: "",
  status: "any",
  mechanical: "any",
  showArchived: false,
};

/** True when something narrows the list. The archive toggle widens it, so it does not count. */
export function hasActiveFilters(filters: AssetFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.typeId !== "" ||
    filters.status !== "any" ||
    filters.mechanical !== "any"
  );
}

/** A null status has always displayed as Active, so it filters as Active too. */
export function assetStatus(asset: Asset): string {
  return asset.status || "active";
}

export function isArchived(asset: Asset): boolean {
  return Boolean(asset.archived_at);
}

const SEARCH_FIELDS = ["name", "asset_number", "registration", "serial_number", "barcode"] as const;

export function filterAssets(assets: readonly Asset[], filters: AssetFilters): Asset[] {
  const needle = filters.query.trim().toLowerCase();

  return assets.filter((asset) => {
    if (!filters.showArchived && isArchived(asset)) return false;
    if (filters.typeId && asset.asset_type_id !== filters.typeId) return false;
    if (filters.status !== "any" && assetStatus(asset) !== filters.status) return false;
    if (filters.mechanical === "yes" && !asset.mechanical) return false;
    if (filters.mechanical === "no" && asset.mechanical) return false;
    if (
      needle &&
      !SEARCH_FIELDS.some((field) => (asset[field] ?? "").toLowerCase().includes(needle))
    ) {
      return false;
    }
    return true;
  });
}

/** The one identifier worth a table column: registration, else serial, else barcode. */
export function identifierSummary(asset: Asset): string {
  return asset.registration || asset.serial_number || asset.barcode || "";
}

export type SortKey = "created" | "name" | "number" | "type" | "status" | "mechanical";
export type SortDirection = "asc" | "desc";
export type AssetSort = { key: SortKey; direction: SortDirection };

export const DEFAULT_SORT: AssetSort = { key: "created", direction: "desc" };

function sortValue(asset: Asset, key: SortKey): string {
  switch (key) {
    case "created":
      return asset.created_at ?? "";
    case "name":
      return asset.name ?? "";
    case "number":
      return asset.asset_number ?? "";
    case "type":
      return asset.asset_type ?? "";
    case "status":
      return assetStatus(asset);
    case "mechanical":
      return asset.mechanical ? "yes" : "no";
  }
}

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" });

/* created_at is an ISO-style timestamp string, so a plain comparison orders it
   correctly; the numeric collator would misread fractional seconds. */
function compareValues(key: SortKey, a: string, b: string): number {
  if (key === "created") return a < b ? -1 : a > b ? 1 : 0;
  return collator.compare(a, b);
}

/** Stable, non-mutating. Empty values sort last in both directions. */
export function sortAssets(assets: readonly Asset[], sort: AssetSort): Asset[] {
  const sign = sort.direction === "asc" ? 1 : -1;

  return [...assets].sort((x, y) => {
    const a = sortValue(x, sort.key);
    const b = sortValue(y, sort.key);
    if (a === "" && b !== "") return 1;
    if (b === "" && a !== "") return -1;
    return sign * compareValues(sort.key, a, b);
  });
}

/** Header click: the same column flips direction, a new column starts ascending. */
export function nextSort(current: AssetSort, key: SortKey): AssetSort {
  if (current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
}
