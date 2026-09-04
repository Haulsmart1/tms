import ComplianceBadge from "../../components/ComplianceBadge";
import Skeleton from "../../components/Skeleton";
import { formatDateGB } from "../../lib/format/date";
import {
  getCompliance,
  mostUrgent,
  type ComplianceLevel,
  type ComplianceResult,
} from "../../lib/compliance/expiry";
import type { FleetInsurancePolicy, Vehicle } from "./types";

/* The vehicle-specific half of compliance display.

   EVERY export here is used by VehicleCard.tsx and by nothing else. page.tsx
   imports none of them: it lost its last import from this module when the
   badge moved to components/ComplianceBadge.tsx and the date formatter to
   lib/format/date.ts.

   So this module exists to mirror app/subcontractors/compliance.tsx, where the
   same split IS load-bearing: there, page.tsx imports subcontractorCardStyle
   directly, so the helper cannot live in the card without the page importing
   the card's module for a style. Keeping the two features structurally
   parallel is the reason this file survives; four more pages are queued on
   this shape. Folding it into VehicleCard.tsx would be perfectly reasonable
   if that parallel ever stops being the reason, but do it knowingly.

   Deliberately NOT shared with app/subcontractors/compliance.tsx: the two
   cardStyle helpers genuinely differ (p-4 and bg-surface shadow-sm here, p-3
   and bg-surface-2 there). The badge that WAS duplicated between them is now
   components/ComplianceBadge.tsx.

   The logic that produces a ComplianceResult lives in lib/compliance/expiry.ts
   and the date formatter in lib/format/date.ts, both of which vitest reaches
   and this file does not. */

/** The expiry that actually governs this vehicle's insurance: a fleet vehicle
 *  inherits the policy's date, an individually insured one carries its own.
 *  Takes the policy explicitly rather than closing over the page's
 *  fleetPolicies state, so the card can call it too. */
export function insuranceExpiryOf(
  vehicle: Vehicle,
  policy: FleetInsurancePolicy | null,
): string | null {
  if (vehicle.insurance_type === "fleet") return policy?.expiry_date ?? null;
  return vehicle.insurance_expiry;
}

/** The single worst of the three dates, which drives the card's border. */
export function vehicleCardCompliance(
  vehicle: Vehicle,
  policy: FleetInsurancePolicy | null,
): ComplianceResult {
  return mostUrgent([
    getCompliance(vehicle.mot_expiry),
    getCompliance(vehicle.tax_expiry),
    getCompliance(insuranceExpiryOf(vehicle, policy)),
  ]);
}

export function ComplianceItem({
  label,
  expiry,
  result,
  extra,
  loading,
}: {
  label: string;
  expiry: string | null;
  result: ComplianceResult | null;
  extra?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-2.5">
      {/* The label is static, so it renders for real. */}
      <span className="block text-kicker uppercase text-ink-3">{label}</span>

      <div className="font-mono text-sm font-semibold text-ink">
        {loading ? (
          <Skeleton display="inline-block" w="9ch" h="0.875rem" />
        ) : expiry ? (
          formatDateGB(expiry)
        ) : (
          "Not set"
        )}
      </div>

      {loading ? (
        <div className="text-xs text-ink-3">
          <Skeleton display="inline-block" w="70%" h="0.75rem" />
        </div>
      ) : extra ? (
        <div className="text-xs text-ink-3">{extra}</div>
      ) : null}

      <div className="mt-2">
        {loading || !result ? (
          <Skeleton w="3.5rem" h="1.25rem" pill />
        ) : (
          <ComplianceBadge result={result} />
        )}
      </div>
    </div>
  );
}

export function vehicleCardStyle(level: ComplianceLevel): string {
  if (level === "red") {
    return "rounded-lg border-2 border-danger bg-danger-tint p-4";
  }

  if (level === "amber") {
    return "rounded-lg border-2 border-warning bg-warning-tint p-4";
  }

  return "rounded-lg border border-line bg-surface p-4 shadow-sm";
}
