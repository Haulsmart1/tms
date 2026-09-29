/*
  Shared types for driver walkaround checks. Pure and client-safe.
  Spec: docs/superpowers/specs/2026-09-29-driver-shifts-walkaround-design.md
*/

export type Severity = "minor" | "dangerous";
export type AppliesTo = "vehicle" | "trailer" | "both";
export type CheckResult = "pass" | "minor" | "dangerous";
export type SeveritySource = "baseline" | "company" | "driver";
export type CheckPhase = "start" | "swap" | "end_of_shift";
export type ObjectionStatus = "pending" | "approved" | "rejected";

/** One row of defect_catalogue_items. companyId null = locked baseline. */
export type CatalogueItem = {
  id: string;
  companyId: string | null;
  code: string;
  category: string;
  itemLabel: string;
  defectLabel: string;
  guidance: string;
  severity: Severity;
  appliesTo: AppliesTo;
  sortOrder: number;
  retiredAt: string | null;
};
