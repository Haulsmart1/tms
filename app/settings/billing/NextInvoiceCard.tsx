import type { ReactNode } from "react";
import Card from "../../../components/Card";
import Skeleton from "../../../components/Skeleton";
import { cn } from "../../../lib/cn";
import { formatCycleDate } from "../../../lib/billing/format";
import {
  formatPence,
  NET_PENCE_PER_VEHICLE,
  type ChargeAmounts,
} from "../../../lib/billing/money";

type Props = {
  loading: boolean;
  /** True when the licence count failed to load; the figures are withheld
      rather than shown as a confident £0.00. */
  unavailable?: boolean;
  amounts: ChargeAmounts;
  /** company_billing.next_charge_on, or null when no card is on file. */
  nextChargeOn: string | null;
};

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-1.5 text-sm",
        strong ? "font-semibold text-ink" : "text-ink-2"
      )}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums slashed-zero text-ink">{value}</span>
    </div>
  );
}

export default function NextInvoiceCard({
  loading,
  unavailable = false,
  amounts,
  nextChargeOn,
}: Props) {
  // Skeleton widths are in ch so they roughly match the digits they stand in for.
  const money = (pence: number, w: string): ReactNode =>
    loading ? (
      <Skeleton display="inline-block" w={w} h="0.875rem" />
    ) : unavailable ? (
      "-"
    ) : (
      formatPence(pence)
    );

  // Same wording in both states so only the count changes on load.
  const vehiclesLabel =
    loading || unavailable
      ? `Vehicles × ${formatPence(NET_PENCE_PER_VEHICLE)}`
      : `${amounts.vehicleCount} ${amounts.vehicleCount === 1 ? "vehicle" : "vehicles"} × ${formatPence(NET_PENCE_PER_VEHICLE)}`;

  return (
    <Card kicker="Next invoice">
      <Row label={vehiclesLabel} value={money(amounts.netPence, "6ch")} />
      <Row label={`VAT at ${amounts.vatRate}%`} value={money(amounts.vatPence, "5ch")} />
      <div className="my-1 border-t border-line" />
      <Row label="Total" value={money(amounts.grossPence, "6ch")} strong />

      <p className="mb-1 mt-3 text-sm text-ink-3">
        {loading ? (
          <Skeleton display="inline-block" w="16ch" h="0.875rem" />
        ) : unavailable ? (
          "Unavailable until billing data loads successfully"
        ) : nextChargeOn ? (
          `Charged on ${formatCycleDate(nextChargeOn)}`
        ) : (
          "Charged when you add a card"
        )}
      </p>
      <p className="m-0 text-xs text-ink-3">
        The vehicle count is taken on the billing date, so this can change before then.
      </p>
    </Card>
  );
}
