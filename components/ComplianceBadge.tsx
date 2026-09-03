import Badge from "./Badge";
import type { ComplianceResult } from "../lib/compliance/expiry";

/* The one rendering of a ComplianceResult as a badge. It was duplicated
   byte-for-byte in app/vehicles/compliance.tsx and
   app/subcontractors/compliance.tsx; four more pages are queued on the same
   pattern, and the next implementer would have copied whichever file they
   opened first.

   Only the badge is shared. The two cardStyle helpers stay with their pages:
   those genuinely differ (p-4 / bg-surface shadow-sm versus p-3 /
   bg-surface-2) and the difference is deliberate.

   Renders correctly ONLY inside a `.ds` wrapper, like every component here:
   Preflight is disabled, so Badge's tokens resolve through the scoped reset in
   app/globals.css. */
export default function ComplianceBadge({ result }: { result: ComplianceResult }) {
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
