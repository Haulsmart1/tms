import Badge from "../../components/Badge";
import Skeleton from "../../components/Skeleton";
import {
  getCompliance,
  mostUrgent,
  type ComplianceLevel,
  type ComplianceResult,
} from "../../lib/compliance/expiry";
import type { FleetInsurancePolicy, Vehicle } from "./types";

/* The vehicle-specific presentation of a compliance result: the badge, the
   card's border/tint, and the MOT/Tax/Insurance cell. Both page.tsx and
   VehicleCard.tsx use them, so they live here rather than in the card, which
   would make the page and the card import each other.

   Deliberately NOT shared with app/subcontractors/compliance.tsx, which looks
   similar and is not: vehicleCardStyle uses p-4 and bg-surface shadow-sm where
   the subcontractor one uses p-3 and bg-surface-2, and this StatusBadge still
   carries a vestigial `small` prop its call sites pass.

   The logic that produces a ComplianceResult lives in lib/compliance/expiry.ts,
   where it can be unit tested. */

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

export function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB");
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
          formatDate(expiry)
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
          <StatusBadge result={result} small />
        )}
      </div>
    </div>
  );
}

export function StatusBadge({
  result,
}: {
  result: ComplianceResult;
  /** Accepted for call-site compatibility; Badge has a single size. */
  small?: boolean;
}) {
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

export function vehicleCardStyle(level: ComplianceLevel): string {
  if (level === "red") {
    return "rounded-lg border-2 border-danger bg-danger-tint p-4";
  }

  if (level === "amber") {
    return "rounded-lg border-2 border-warning bg-warning-tint p-4";
  }

  return "rounded-lg border border-line bg-surface p-4 shadow-sm";
}
