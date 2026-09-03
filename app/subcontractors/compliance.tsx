import Badge from "../../components/Badge";
import type { ComplianceLevel, ComplianceResult } from "../../lib/compliance/expiry";

/* The subcontractor-specific presentation of a compliance result: the badge
   and the card's border/tint. Both page.tsx and SubcontractorCard.tsx use
   them, so they live here rather than in the card, which would make the page
   and the card import each other.

   The logic that produces a ComplianceResult now lives in
   lib/compliance/expiry.ts, where it can be unit tested. */

export function StatusBadge({ result }: { result: ComplianceResult }) {
  return (
    <Badge
      tone={
        result.level === "red"
          ? "danger"
          : result.level === "amber"
            ? "warning"
            : "success"
      }
    >
      {result.label}
    </Badge>
  );
}

export function subcontractorCardStyle(level: ComplianceLevel): string {
  if (level === "red") {
    return "rounded-lg border-2 border-danger bg-danger-tint p-3";
  }

  if (level === "amber") {
    return "rounded-lg border-2 border-warning bg-warning-tint p-3";
  }

  return "rounded-lg border border-line bg-surface-2 p-3";
}
