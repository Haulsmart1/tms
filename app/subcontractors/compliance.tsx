import type { ComplianceLevel } from "../../lib/compliance/expiry";

/* The subcontractor-specific presentation of a compliance result: the card's
   border and tint. Both page.tsx and SubcontractorCard.tsx use it, so it lives
   here rather than in the card, which would make the page and the card import
   each other.

   The badge that used to sit beside it was byte-identical to the one in
   app/vehicles/compliance.tsx and is now components/ComplianceBadge.tsx. This
   helper deliberately stays: it differs from vehicleCardStyle (p-3 and
   bg-surface-2 here, p-4 and bg-surface shadow-sm there) and that difference
   is real.

   The logic that produces a ComplianceResult lives in lib/compliance/expiry.ts,
   where it can be unit tested. */

export function subcontractorCardStyle(level: ComplianceLevel): string {
  if (level === "red") {
    return "rounded-lg border-2 border-danger bg-danger-tint p-3";
  }

  if (level === "amber") {
    return "rounded-lg border-2 border-warning bg-warning-tint p-3";
  }

  return "rounded-lg border border-line bg-surface-2 p-3";
}
