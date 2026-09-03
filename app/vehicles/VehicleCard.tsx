import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import { cn } from "../../lib/cn";
import { getCompliance } from "../../lib/compliance/expiry";
import {
  ComplianceItem,
  StatusBadge,
  insuranceExpiryOf,
  vehicleCardCompliance,
  vehicleCardStyle,
} from "./compliance";
import type { FleetInsurancePolicy, Vehicle } from "./types";

type Props = {
  vehicle: Vehicle;
  /** The only value that cannot be derived here: it needs the page's
   *  fleetPolicies state. Null when this vehicle is not on a fleet policy. */
  policy: FleetInsurancePolicy | null;
  isAdmin: boolean;
  loading?: boolean;
  onEdit: (vehicle: Vehicle) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
};

/* ONE layout definition for both states, per the batch 1 decision. A separate
   skeleton component mirroring these class names drifts the first time anyone
   edits the real card, and no test in this repo would catch it.

   Only data-bearing leaves become skeletons. Labels, structure and the three
   buttons render for real. */
export default function VehicleCard({
  vehicle,
  policy,
  isAdmin,
  loading = false,
  onEdit,
  onDelete,
  onToggle,
}: Props) {
  /* Derived here rather than passed in. As props alongside `loading` they were
     states that cannot both hold, and the border and the badges then disagreed
     about which one to believe.

     Behind the loading branch on purpose: every placeholder expiry is null and
     getCompliance(null) is amber, so deriving unconditionally would put an
     amber alarm border and three amber badges on every skeleton card. */
  const cardCompliance = loading ? null : vehicleCardCompliance(vehicle, policy);
  const insuranceExpiry = loading ? null : insuranceExpiryOf(vehicle, policy);
  const mot = loading ? null : getCompliance(vehicle.mot_expiry);
  const tax = loading ? null : getCompliance(vehicle.tax_expiry);
  const insurance = loading ? null : getCompliance(insuranceExpiry);

  return (
    <div
      /* While loading there is no compliance level, so the card takes the calm
         "ok" border rather than flashing an alarm border the data may not
         justify, and it is not dimmed as inactive before we know that it is. */
      className={cn(
        vehicleCardStyle(cardCompliance?.level ?? "ok"),
        !loading && !vehicle.active && "opacity-70",
      )}
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="m-0 font-mono text-md font-semibold text-ink">
            {loading ? (
              <Skeleton display="inline-block" w="8ch" h="1rem" />
            ) : (
              vehicle.registration
            )}
          </h3>

          <div className="text-sm text-ink-2">
            {loading ? (
              <Skeleton display="inline-block" w="14ch" h="0.75rem" />
            ) : (
              <>
                {vehicle.vehicle_type || "No type"} • {vehicle.make || "-"}{" "}
                {vehicle.model || ""}
              </>
            )}
          </div>
        </div>

        {loading || !cardCompliance ? (
          <Skeleton w="4.5rem" h="1.375rem" pill />
        ) : (
          <StatusBadge result={cardCompliance} />
        )}
      </div>

      <div className="my-3 grid gap-2 sm:grid-cols-3">
        <ComplianceItem
          label="MOT"
          expiry={vehicle.mot_expiry}
          result={mot}
          loading={loading}
        />

        <ComplianceItem
          label="Tax"
          expiry={vehicle.tax_expiry}
          result={tax}
          loading={loading}
        />

        <ComplianceItem
          label="Insurance"
          expiry={insuranceExpiry}
          result={insurance}
          loading={loading}
          extra={
            vehicle.insurance_type === "fleet"
              ? policy
                ? `Fleet • ${policy.provider}${
                    policy.auto_renew ? " • Auto renew" : ""
                  }`
                : "Fleet policy not selected"
              : vehicle.insurance_provider || "Individual policy"
          }
        />
      </div>

      <div className="text-sm text-ink-2">
        {/* "Status:" is a static label, so only the value it introduces is a
            skeleton. */}
        Status:{" "}
        {loading ? (
          <Skeleton display="inline-block" w="5ch" h="0.75rem" />
        ) : vehicle.active ? (
          "Active"
        ) : (
          "Inactive"
        )}
      </div>

      {/* Real buttons, disabled. Fixed size and no data, so this is both more
          faithful than a grey rectangle and more honest about being inert. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {isAdmin ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              disabled={loading}
              onClick={() => onEdit(vehicle)}
            >
              Edit
            </Button>

            <Button
              variant="danger"
              size="sm"
              type="button"
              disabled={loading}
              onClick={() => onDelete(vehicle.id)}
            >
              Delete
            </Button>
          </>
        ) : null}

        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={loading}
          onClick={() => onToggle(vehicle.id, Boolean(vehicle.active))}
        >
          {/* "Deactivate" while loading: it is the wider of the two labels, so
              the button does not resize when the real state arrives. */}
          {loading || vehicle.active ? "Deactivate" : "Activate"}
        </Button>
      </div>
    </div>
  );
}
