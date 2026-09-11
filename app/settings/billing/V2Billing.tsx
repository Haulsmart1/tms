"use client";

/* The v2_period billing body: bills in ARREARS when a 28-day period closes.
   Adding a vehicle mid-period moves no money.

   Designed as an instrument as much as a bill. The v2 path had never charged
   when this was written, and all four early exits in the activation route
   return ok:true with no charge, which is indistinguishable from success. So
   the no-period state is a designed screen carrying the diagnostic, not an
   empty table.

   Prices with lib/billing/rateCard.ts via the preview endpoint. Do NOT import
   lib/billing/money.ts here: that is v1's graduated weekly shape. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import Badge from "../../../components/Badge";
import Card from "../../../components/Card";
import DataTable, {
  type Column,
  type DataTableState,
} from "../../../components/DataTable";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";
import Stat from "../../../components/Stat";
import { formatPence, formatCycleDate } from "../../../lib/billing/format";
import { londonDateISO } from "../../../lib/billing/schedule";
import {
  MID_PERIOD_ADDITION_NOTE,
  NO_PERIOD_REASONS,
  periodProgress,
  pricingExplanation,
  type PreviewLine,
} from "../../../lib/billing/periodView";
import {
  BILLING_BASIS_SENTENCE,
  pricingHeadline,
} from "../../../lib/billing/pricingCopy";
import PaymentMethodCard, { type BillingRow } from "./PaymentMethodCard";

type PreviewPeriod = {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  prepaid_pence: number;
  attempt_count: number;
  retry_on: string | null;
};

type PreviewResponse = {
  ok: true;
  unavailable?: "migration";
  period?: PreviewPeriod | null;
  lines?: PreviewLine[];
  vehicleCount?: number;
  discountPercent?: number;
  subtotalPence?: number;
  netPence?: number;
  vatPence?: number;
  grossPence?: number;
  minimumPence?: number;
};

/* A settled charge attempt against a period. Distinct from a projection: this
   is money that moved, or tried to. */
type PeriodCharge = {
  id: string;
  billing_period_id: string;
  kind: "minimum" | "balance";
  attempt: number;
  gross_pence: number;
  status: "pending" | "succeeded" | "failed" | "refunded";
  failure_code: string | null;
  receipt_url: string | null;
  created_at: string;
};

/* Each region withholds only what it cannot vouch for: a failed charge history
   must not hide a valid card, and a failed preview must not hide a charge the
   customer has actually paid. */
type LoadError = {
  message: string;
  billing: boolean;
  preview: boolean;
  charges: boolean;
};

const HISTORY_LIMIT = 24;

const CHARGE_TONE: Record<PeriodCharge["status"], "success" | "danger" | "warning" | "neutral"> = {
  succeeded: "success",
  failed: "danger",
  pending: "warning",
  refunded: "neutral",
};

const CHARGE_LABEL: Record<PeriodCharge["status"], string> = {
  succeeded: "Paid",
  failed: "Failed",
  pending: "Pending",
  /* Distinct from failed on purpose: a refunded charge DID collect and was
     then given back under cooling-off. Calling it "failed" would describe a
     period that never collected. */
  refunded: "Refunded",
};

const CHARGE_COLUMNS: Column<PeriodCharge>[] = [
  {
    header: "Date",
    cell: (c) => (
      <span className="font-mono">{formatCycleDate(c.created_at.slice(0, 10))}</span>
    ),
  },
  {
    header: "For",
    cell: (c) => (
      <div>
        <span>{c.kind === "minimum" ? "Period minimum" : "Period balance"}</span>
        {c.attempt > 1 ? (
          <span className="ml-2 text-xs text-ink-3">attempt {c.attempt}</span>
        ) : null}
      </div>
    ),
  },
  {
    header: "Amount",
    align: "right",
    cell: (c) => (
      <span className="font-mono tabular-nums">{formatPence(c.gross_pence)}</span>
    ),
  },
  {
    header: "Status",
    cell: (c) => (
      <div>
        <Badge tone={CHARGE_TONE[c.status]}>{CHARGE_LABEL[c.status]}</Badge>
        {c.failure_code ? (
          <div className="mt-0.5 text-xs text-ink-3">{c.failure_code}</div>
        ) : null}
      </div>
    ),
  },
  {
    header: "Receipt",
    cell: (c) =>
      c.receipt_url ? (
        <a
          href={c.receipt_url}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View
        </a>
      ) : (
        <span className="text-ink-3">-</span>
      ),
  },
];

function LineRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-start justify-between gap-4 py-1.5 text-sm",
        strong ? "font-semibold text-ink" : muted ? "text-ink-3" : "text-ink-2",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums slashed-zero text-ink">{value}</span>
    </div>
  );
}

export default function V2Billing() {
  const supabase = useMemo(() => createClient(), []);

  const [billing, setBilling] = useState<BillingRow | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [charges, setCharges] = useState<PeriodCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "warning" } | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      /* No filterByTenant on either query. This is the bill, not an
         operational view: the period spans every tenant under the company, and
         RLS scopes both tables to the admin's own company. */
      const [billingRes, chargesRes, previewRes] = await Promise.all([
        supabase.from("company_billing").select("*").maybeSingle(),
        supabase
          .from("period_charges")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT),
        fetch("/api/billing/preview", { cache: "no-store" }),
      ]);

      let previewBody: PreviewResponse | null = null;
      let previewFailed = false;
      if (previewRes.ok) {
        previewBody = (await previewRes.json()) as PreviewResponse;
      } else {
        previewFailed = true;
      }

      const firstError = billingRes.error ?? chargesRes.error;
      setLoadError(
        firstError || previewFailed
          ? {
              message:
                firstError?.message ??
                `The period preview could not be loaded (${previewRes.status}).`,
              billing: Boolean(billingRes.error),
              preview: previewFailed,
              charges: Boolean(chargesRes.error),
            }
          : null
      );

      setBilling((billingRes.data as BillingRow | null) ?? null);
      setCharges((chargesRes.data as PeriodCharge[] | null) ?? []);
      setPreview(previewBody);
    } catch (error) {
      /* A thrown client error rather than a returned .error. Without this the
         finally below flips hasLoaded and the page renders a confident zero
         state with no banner. */
      setLoadError({
        message: error instanceof Error ? error.message : "Unexpected error",
        billing: true,
        preview: true,
        charges: true,
      });
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = loading || !hasLoaded;
  const period = preview?.period ?? null;
  const lines = preview?.lines ?? [];
  const migrationMissing = preview?.unavailable === "migration";

  const progress = period
    ? periodProgress({
        periodStartISO: period.period_start,
        periodEndISO: period.period_end,
        todayISO: londonDateISO(new Date()),
      })
    : null;

  const explanation =
    period && preview
      ? pricingExplanation({
          lines,
          vehicleCount: preview.vehicleCount ?? 0,
          minimumPence: preview.minimumPence ?? 0,
          discountPercent: preview.discountPercent ?? 0,
        })
      : null;

  /* Withheld, never rendered as £0.00. A confident zero on a billing page is a
     lie with financial consequences. */
  const money = (pence: number | undefined): string =>
    loadError?.preview || pence === undefined ? "-" : formatPence(pence);

  const tableState: DataTableState = busy
    ? "loading"
    : loadError?.charges
      ? "error"
      : charges.length === 0
        ? "empty"
        : "ready";

  return (
    <>
      <MessageBanner tone="danger">
        {loadError ? `Could not load billing data: ${loadError.message}` : ""}
      </MessageBanner>
      <MessageBanner tone="warning">
        {migrationMissing
          ? "Period billing tables are not present in this database yet. Apply docs/sql/billing_06_period_billing.sql."
          : ""}
      </MessageBanner>
      <MessageBanner tone="danger">
        {billing?.status === "past_due"
          ? "Your last payment failed. Replace your card below to bring your account back up to date."
          : ""}
      </MessageBanner>
      <MessageBanner tone={notice?.tone ?? "success"}>{notice?.text ?? ""}</MessageBanner>

      <div aria-busy={busy || undefined}>
        {busy ? (
          <span className="sr-only" role="status">
            Loading billing
          </span>
        ) : null}

        <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label="Current period"
            value={
              busy ? (
                <Skeleton display="inline-block" w="16ch" h="1.25rem" />
              ) : period ? (
                `${formatCycleDate(period.period_start)} to ${formatCycleDate(period.period_end)}`
              ) : (
                "None open"
              )
            }
          />
          <Stat
            label="Progress"
            value={
              busy ? (
                <Skeleton display="inline-block" w="10ch" h="1.25rem" />
              ) : (
                progress?.label ?? "-"
              )
            }
            sub={progress ? `${progress.daysRemaining} days remaining` : undefined}
          />
          <Stat
            label="Vehicles counted"
            value={
              busy ? (
                <Skeleton display="inline-block" w="2.5ch" h="1.25rem" />
              ) : loadError?.preview || !period ? (
                "-"
              ) : (
                String(preview?.vehicleCount ?? 0)
              )
            }
            sub={period ? "billable so far this period" : undefined}
          />
          <Stat
            label="Projected total"
            value={
              busy ? (
                <Skeleton display="inline-block" w="8ch" h="1.25rem" />
              ) : period ? (
                money(preview?.grossPence)
              ) : (
                "-"
              )
            }
            sub={period ? "inc VAT, if it closed today" : undefined}
          />
        </div>

        {!busy && !period && !migrationMissing ? (
          <Card kicker="No open period" className="mb-6">
            <p className="m-0 text-sm text-ink-2">
              Nothing is being billed right now. A period opens when the first
              vehicle is activated for billing, so if you expected a charge, one
              of these is the reason:
            </p>
            <ul className="mb-0 mt-2 list-disc pl-5 text-sm text-ink-2">
              {NO_PERIOD_REASONS.map((reason) => (
                <li key={reason} className="py-0.5">
                  {reason}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {!busy && period ? (
          <Card kicker="This period, if it closed today" className="mb-6">
            <p className="m-0 text-xs text-ink-3">
              A projection, not an invoice. These figures are produced by the
              same calculation that will run when the period closes.
            </p>

            <div className="mt-3 border-t border-line pt-1">
              {lines.map((line, index) => (
                <LineRow
                  key={`${line.kind}-${line.vehicleId ?? index}`}
                  label={line.description}
                  value={formatPence(line.netPence)}
                  muted={line.kind !== "vehicle"}
                />
              ))}
            </div>

            <div className="mt-1 border-t border-line pt-1">
              <LineRow label="Net" value={money(preview?.netPence)} />
              <LineRow label="VAT" value={money(preview?.vatPence)} />
              <LineRow label="Total" value={money(preview?.grossPence)} strong />
            </div>

            {explanation ? (
              <p className="mb-0 mt-3 text-sm text-ink-2">{explanation}</p>
            ) : null}
            <p className="mb-0 mt-1 text-xs text-ink-3">{MID_PERIOD_ADDITION_NOTE}</p>
          </Card>
        ) : null}

        <div className="mb-6 grid gap-3 md:grid-cols-2">
          <PaymentMethodCard
            loading={busy}
            billing={billing}
            loadError={Boolean(loadError?.billing)}
            showForm={showCardForm}
            onReplace={() => {
              setNotice(null);
              setShowCardForm(true);
            }}
            onCancel={() => setShowCardForm(false)}
            onComplete={(response) => {
              setShowCardForm(false);
              /* No firstCharge branch. v2 takes no money when a card is saved:
                 the period is charged when it closes. A "subscription started,
                 £X charged" notice here would announce a payment that did not
                 happen. */
              setNotice(
                response.retried && response.succeeded === false
                  ? {
                      tone: "warning",
                      text: `New card saved, but the outstanding charge was declined (${String(response.failureCode ?? "declined")}). It will be retried automatically.`,
                    }
                  : { tone: "success", text: "Card updated." }
              );
              void load();
            }}
          />
          <Card kicker="Your plan">
            <p className="m-0 text-sm text-ink-2">{pricingHeadline().summary}</p>
            <p className="mb-0 mt-1 text-sm text-ink-3">{BILLING_BASIS_SENTENCE}</p>
          </Card>
        </div>

        <h2 className="mb-2 mt-0 text-base font-semibold text-ink">
          Charge history
        </h2>
        <DataTable
          columns={CHARGE_COLUMNS}
          rows={charges}
          rowKey={(c) => c.id}
          state={tableState}
          errorMessage="Couldn't load charge history."
          onRetry={load}
          emptyTitle="No charges yet"
          emptyDescription="Your first charge appears here after a period closes."
        />
      </div>
    </>
  );
}

V2Billing.Description = function V2Description() {
  const headline = pricingHeadline();
  return (
    <>
      {headline.fromLabel} per {headline.periodDays} days, including your first{" "}
      {headline.includedVehicles} vehicles, then {headline.perVehicleLabel} per
      vehicle. Billed at the end of each period, plus VAT.
    </>
  );
};
