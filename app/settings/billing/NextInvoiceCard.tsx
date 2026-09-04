import type { ReactNode } from "react";
import Card from "../../../components/Card";
import Skeleton from "../../../components/Skeleton";
import { cn } from "../../../lib/cn";
import { formatCycleDate } from "../../../lib/billing/format";
import {
  formatPence,
  tierBreakdown,
  WEEKS_PER_CYCLE,
  type ChargeAmounts,
  type TierLine,
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

  // One row per band the fleet reaches. A fleet of 10 or fewer, which is the
  // common case, still renders as a single row, so the card does not get
  // heavier for small customers.
  //
  // Annotated rather than inferred: the ternary would otherwise infer
  // never[] | TierLine[] and the label helper below loses its parameter type.
  const lines: TierLine[] =
    loading || unavailable ? [] : tierBreakdown(amounts.vehicleCount);

  const lineLabel = (line: TierLine): string =>
    lines.length === 1
      ? `${line.vehiclesInBand} ${line.vehiclesInBand === 1 ? "vehicle" : "vehicles"} × ${formatPence(line.weeklyPence)}/week × ${WEEKS_PER_CYCLE} weeks`
      : `Vehicles ${line.fromVehicle}-${line.toVehicle} × ${formatPence(line.weeklyPence)}/week × ${WEEKS_PER_CYCLE} weeks`;

  return (
    <Card kicker="Next invoice">
      {lines.length === 0 ? (
        <Row
          label={`Vehicles × weekly rate × ${WEEKS_PER_CYCLE} weeks`}
          value={money(amounts.netPence, "6ch")}
        />
      ) : (
        lines.map((line) => (
          <Row
            key={line.fromVehicle}
            label={lineLabel(line)}
            value={money(line.bandNetPence * WEEKS_PER_CYCLE, "6ch")}
          />
        ))
      )}
      {lines.length > 1 ? (
        <Row label="Net" value={money(amounts.netPence, "6ch")} />
      ) : null}
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
        The vehicle count is taken on the billing date, so this can change
        before then. Charged every {WEEKS_PER_CYCLE} weeks.
      </p>
    </Card>
  );
}
