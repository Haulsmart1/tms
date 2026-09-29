/*
  Shapes a stored walkaround check for the office view on /maintenance. The
  checklist_snapshot is jsonb written by the driver's phone at the time of the
  check, so it is parsed defensively: a malformed entry is skipped, never
  thrown on. Pure and client-safe.
*/

import type { SnapshotItem } from "./catalogue";
import type { CheckPhase, CheckResult, Severity } from "./types";

export function parseSnapshot(value: unknown): SnapshotItem[] {
  if (!Array.isArray(value)) return [];
  const items: SnapshotItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.category !== "string") continue;
    items.push({
      id: r.id,
      code: typeof r.code === "string" ? r.code : "",
      category: r.category,
      itemLabel: typeof r.itemLabel === "string" ? r.itemLabel : r.category,
      defectLabel: typeof r.defectLabel === "string" ? r.defectLabel : "",
      guidance: typeof r.guidance === "string" ? r.guidance : "",
      severity: r.severity === "dangerous" ? "dangerous" : "minor",
      source: r.source === "company" ? "company" : "baseline",
    });
  }
  return items;
}

export type CheckGroup<D> = { category: string; itemLabel: string; defects: D[] };

/**
 * One entry per checklist item (consecutive snapshot rows with the same
 * category), each with the defects reported against it; an item with none was
 * checked OK. Defects that match no snapshot row (free text, or a snapshot
 * that could not be read) come back in `other`.
 */
export function groupCheckForView<D extends { catalogueItemId: string | null }>(
  snapshot: readonly SnapshotItem[],
  defects: readonly D[],
): { groups: CheckGroup<D>[]; other: D[] } {
  const groups: (CheckGroup<D> & { ids: Set<string> })[] = [];
  for (const item of snapshot) {
    const last = groups[groups.length - 1];
    if (last && last.category === item.category) last.ids.add(item.id);
    else groups.push({ category: item.category, itemLabel: item.itemLabel, defects: [], ids: new Set([item.id]) });
  }
  const other: D[] = [];
  for (const d of defects) {
    const group = d.catalogueItemId ? groups.find((g) => g.ids.has(d.catalogueItemId as string)) : undefined;
    if (group) group.defects.push(d);
    else other.push(d);
  }
  return { groups: groups.map(({ category, itemLabel, defects: ds }) => ({ category, itemLabel, defects: ds })), other };
}

export const PHASE_LABELS: Record<CheckPhase, string> = {
  start: "Start of shift",
  swap: "Vehicle swap",
  end_of_shift: "End of shift",
};

export const RESULT_LABELS: Record<CheckResult, string> = {
  pass: "Passed",
  minor: "Minor defects",
  dangerous: "Dangerous defect",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  minor: "Minor",
  dangerous: "Dangerous",
};

export function asPhase(value: unknown): CheckPhase {
  return value === "swap" || value === "end_of_shift" ? value : "start";
}

export function asResult(value: unknown): CheckResult {
  return value === "dangerous" || value === "minor" ? value : "pass";
}
