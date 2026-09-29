/*
  The walkaround checklist a driver sees: the locked baseline plus the
  company's own active items. Pure and client-safe.
*/

import type { AppliesTo, CatalogueItem, Severity } from "./types";

export type SnapshotItem = {
  id: string;
  code: string;
  category: string;
  itemLabel: string;
  defectLabel: string;
  guidance: string;
  severity: Severity;
  source: "baseline" | "company";
};

export type ItemGroup = { category: string; itemLabel: string; defects: CatalogueItem[] };

const SEVERITIES: readonly Severity[] = ["minor", "dangerous"];
const APPLIES_TO: readonly AppliesTo[] = ["vehicle", "trailer", "both"];

/** Baseline first, then the company's items; retired and other companies' rows removed. */
export function activeCatalogue(items: readonly CatalogueItem[], companyId: string): CatalogueItem[] {
  return items
    .filter((i) => i.retiredAt === null && (i.companyId === null || i.companyId === companyId))
    .sort(
      (a, b) =>
        (a.companyId === null ? 0 : 1) - (b.companyId === null ? 0 : 1) ||
        a.sortOrder - b.sortOrder ||
        a.code.localeCompare(b.code),
    );
}

/** Consecutive rows with the same category form one checklist item. */
export function groupByItem(items: readonly CatalogueItem[]): ItemGroup[] {
  const groups: ItemGroup[] = [];
  for (const row of items) {
    const last = groups[groups.length - 1];
    if (last && last.category === row.category) last.defects.push(row);
    else groups.push({ category: row.category, itemLabel: row.itemLabel, defects: [row] });
  }
  return groups;
}

export function toSnapshot(items: readonly CatalogueItem[]): SnapshotItem[] {
  return items.map((i) => ({
    id: i.id,
    code: i.code,
    category: i.category,
    itemLabel: i.itemLabel,
    defectLabel: i.defectLabel,
    guidance: i.guidance,
    severity: i.severity,
    source: i.companyId === null ? "baseline" : "company",
  }));
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export type CompanyItemInput = {
  category?: unknown;
  itemLabel?: unknown;
  defectLabel?: unknown;
  guidance?: unknown;
  severity?: unknown;
  appliesTo?: unknown;
};

export type ValidCompanyItem = {
  code: string;
  category: string;
  itemLabel: string;
  defectLabel: string;
  guidance: string;
  severity: Severity;
  appliesTo: AppliesTo;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Validate a company-added item. Company codes always start "co." so they never collide with the baseline. */
export function validateCompanyItem(
  input: CompanyItemInput,
  existingCodes: ReadonlySet<string>,
): { ok: true; value: ValidCompanyItem } | { ok: false; error: string } {
  const category = slug(text(input.category));
  const itemLabel = text(input.itemLabel);
  const defectLabel = text(input.defectLabel);
  const guidance = text(input.guidance);
  const appliesTo = input.appliesTo === undefined || input.appliesTo === null ? "vehicle" : input.appliesTo;

  if (!category) return { ok: false, error: "Give the item a category." };
  if (!itemLabel || itemLabel.length > 80) return { ok: false, error: "The item name must be 1 to 80 characters." };
  if (!defectLabel || defectLabel.length > 120) return { ok: false, error: "The defect must be 1 to 120 characters." };
  if (guidance.length > 400) return { ok: false, error: "Guidance must be 400 characters or fewer." };
  if (!SEVERITIES.includes(input.severity as Severity)) return { ok: false, error: "Severity must be minor or dangerous." };
  if (!APPLIES_TO.includes(appliesTo as AppliesTo)) return { ok: false, error: "Applies to must be vehicle, trailer or both." };

  const base = `co.${category}.${slug(defectLabel) || "defect"}`;
  let code = base;
  for (let n = 2; existingCodes.has(code); n += 1) code = `${base}_${n}`;

  return {
    ok: true,
    value: {
      code,
      category,
      itemLabel,
      defectLabel,
      guidance,
      severity: input.severity as Severity,
      appliesTo: appliesTo as AppliesTo,
    },
  };
}
