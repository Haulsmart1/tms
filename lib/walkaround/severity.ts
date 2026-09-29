/*
  Severity is decided by the catalogue, never by the driver. The driver can
  escalate a minor defect to dangerous but can never downgrade. The server runs
  this on every submission and ignores what the phone claims.
*/

import type { CatalogueItem, CheckResult, Severity, SeveritySource } from "./types";

export type SubmittedDefect = {
  clientId: string;
  catalogueItemId: string | null;
  driverSeverity: Severity | null;
  note: string | null;
};

export type ResolvedDefect = {
  clientId: string;
  catalogueItemId: string | null;
  label: string;
  catalogueSeverity: Severity | null;
  finalSeverity: Severity;
  escalatedByDriver: boolean;
  severitySource: SeveritySource;
  note: string | null;
};

export function resolveDefect(
  defect: SubmittedDefect,
  catalogue: ReadonlyMap<string, CatalogueItem>,
): { ok: true; value: ResolvedDefect } | { ok: false; error: string } {
  const note = defect.note?.trim() || null;

  if (defect.catalogueItemId === null) {
    if (!note) return { ok: false, error: "Describe the defect." };
    const dangerous = defect.driverSeverity === "dangerous";
    return {
      ok: true,
      value: {
        clientId: defect.clientId,
        catalogueItemId: null,
        label: `Other: ${note.slice(0, 80)}`,
        catalogueSeverity: null,
        finalSeverity: dangerous ? "dangerous" : "minor",
        escalatedByDriver: dangerous,
        severitySource: "driver",
        note,
      },
    };
  }

  const item = catalogue.get(defect.catalogueItemId);
  if (!item) return { ok: false, error: "That defect is not on this vehicle's checklist." };
  if (item.retiredAt !== null) return { ok: false, error: "That defect has been retired from the checklist." };

  const escalated = item.severity === "minor" && defect.driverSeverity === "dangerous";
  return {
    ok: true,
    value: {
      clientId: defect.clientId,
      catalogueItemId: item.id,
      label: `${item.itemLabel}: ${item.defectLabel}`,
      catalogueSeverity: item.severity,
      finalSeverity: escalated ? "dangerous" : item.severity,
      escalatedByDriver: escalated,
      severitySource: escalated ? "driver" : item.companyId === null ? "baseline" : "company",
      note,
    },
  };
}

export function checkResult(defects: readonly { finalSeverity: Severity }[]): CheckResult {
  if (defects.some((d) => d.finalSeverity === "dangerous")) return "dangerous";
  if (defects.length > 0) return "minor";
  return "pass";
}

/** The "why is this dangerous" line on the driver's VOR screen. Null for minor defects. */
export function dangerReason(
  defect: { finalSeverity: Severity; severitySource: SeveritySource },
  companyName: string | null,
): string | null {
  if (defect.finalSeverity !== "dangerous") return null;
  if (defect.severitySource === "baseline") return "Classed dangerous in the baseline checklist (based on DVSA guidance).";
  if (defect.severitySource === "company") return `Classed dangerous by ${companyName || "your company"} for this item.`;
  return "You marked this as dangerous.";
}
