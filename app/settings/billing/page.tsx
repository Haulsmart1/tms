"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import Badge from "../../../components/Badge";
import DataTable, {
  type Column,
  type DataTableState,
} from "../../../components/DataTable";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";
import Stat from "../../../components/Stat";
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";
import { billingStatusBadge, formatCycleDate } from "../../../lib/billing/format";
import { shouldShowSkeleton } from "../../../lib/loading/skeletonVisibility";
import NextInvoiceCard from "./NextInvoiceCard";
import PaymentMethodCard, { type BillingRow } from "./PaymentMethodCard";

type ChargeRow = {
  id: string;
  cycle_date: string;
  attempt: number;
  vehicle_count: number;
  gross_pence: number;
  status: "succeeded" | "failed";
  failure_code: string | null;
  receipt_url: string | null;
  created_at: string;
};

/* Which of the three queries failed, so each region withholds only what it
   cannot vouch for: a charge-history failure must not hide a valid card on
   file, and vice versa. `message` is the first error, for the banner. */
type LoadError = {
  message: string;
  billing: boolean;
  charges: boolean;
  licences: boolean;
};

/* No widths: DataTable's comment says set them on every column or none. */
const CHARGE_COLUMNS: Column<ChargeRow>[] = [
  {
    header: "Billing date",
    cell: (c) => <span className="font-mono">{formatCycleDate(c.cycle_date)}</span>,
  },
  { header: "Attempt", cell: (c) => String(c.attempt) },
  { header: "Vehicles", align: "right", cell: (c) => String(c.vehicle_count) },
  {
    header: "Amount",
    align: "right",
    cell: (c) => (
      <span className="font-mono tabular-nums">{formatPence(c.gross_pence)}</span>
    ),
  },
  {
    header: "Status",
    cell: (c) =>
      c.status === "succeeded" ? (
        <Badge tone="success">Paid</Badge>
      ) : (
        <span className="inline-flex items-center gap-2">
          <Badge tone="danger">Failed</Badge>
          <span className="text-xs text-ink-3">{c.failure_code ?? "declined"}</span>
        </span>
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
          className="text-primary underline"
        >
          View
        </a>
      ) : (
        "-"
      ),
  },
];

/* Shell shared by every branch (admin, non-admin, super-admin), so the header
   never disappears and the role notices sit where the page body would. */
function PageFrame({ children }: { children: ReactNode }) {
  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Admin</div>
            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Billing
            </h1>
            <p className="m-0 text-sm text-ink-3">
              £10 per active licensed vehicle per month, plus VAT, charged to
              your card on your billing date.
            </p>
          </header>
          {children}
        </main>
      </div>
    </TenantGate>
  );
}

export default function BillingSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [billing, setBilling] = useState<BillingRow | null>(null);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "warning" } | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [billingRes, chargesRes, licencesRes] = await Promise.all([
        supabase.from("company_billing").select("*").maybeSingle(),
        supabase
          .from("platform_charges")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(24),
        /* Company-wide on purpose, no filterByTenant: this is the bill, not
           an operational view, and the charge spans every tenant under the
           company. RLS scopes it to the admin's company. See the
           count-divergence follow-up in the spec before "fixing" this. */
        supabase.from("vehicle_licences").select("vehicle_id").eq("active", true),
      ]);
      const firstError = billingRes.error ?? chargesRes.error ?? licencesRes.error;
      setLoadError(
        firstError
          ? {
              message: firstError.message,
              billing: Boolean(billingRes.error),
              charges: Boolean(chargesRes.error),
              licences: Boolean(licencesRes.error),
            }
          : null
      );
      setBilling((billingRes.data as BillingRow | null) ?? null);
      setCharges((chargesRes.data as ChargeRow[] | null) ?? []);
      setVehicleCount(
        new Set((licencesRes.data ?? []).map((l) => l.vehicle_id)).size
      );
    } catch (error) {
      /* A thrown client error, as opposed to a returned .error. Without this
         branch the finally below would flip hasLoaded and the page would
         render a confident zero state with no banner. */
      setLoadError({
        message: error instanceof Error ? error.message : "Unexpected error",
        billing: true,
        charges: true,
        licences: true,
      });
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [supabase]);

  useEffect(() => {
    /* This page mounts during tenant resolution now that TenantGate passes
       through (lib/nav/skeletonReadyRoutes.ts). Wait for "ready" so the
       queries run under a resolved session, and only query for the one role
       that can see this page: super_admin's RLS scope returns every company's
       rows, so maybeSingle() would error and the counts would be platform-wide. */
    if (tenant.status !== "ready" || tenant.role !== "admin") return;
    void load();
  }, [load, tenant.status, tenant.role]);

  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: hasLoaded,
  });

  /* Role gates apply only once status is ready. Before that, role is the
     provider's placeholder and every admin would see the staff notice flash. */
  if (tenant.status === "ready" && tenant.role === "super_admin") {
    return (
      <PageFrame>
        <MessageBanner tone="info">
          Platform billing for all companies lives in the super-admin console.{" "}
          <Link href="/super-admin/billing" className="underline">
            Go to super-admin billing
          </Link>
        </MessageBanner>
      </PageFrame>
    );
  }

  if (tenant.status === "ready" && tenant.role !== "admin") {
    return (
      <PageFrame>
        <MessageBanner tone="info">Billing is managed by your company admin.</MessageBanner>
      </PageFrame>
    );
  }

  /* hasLoaded keeps showSkeleton false on a Retry, which is right for the
     Stat tiles (their last numbers were true a moment ago). The two cards and
     the table read `billing` and `charges`, which after a failed load are
     null and empty until the refetch resolves: without this, a Retry would
     briefly show the "add a card" form and "No charges yet" as fact. */
  const busy = showSkeleton || loading;

  const amounts = computeChargeAmounts(vehicleCount);
  const statusBadge = billingStatusBadge(billing?.status ?? null);
  const tableState: DataTableState = busy
    ? "loading"
    : loadError?.charges
      ? "error"
      : charges.length === 0
        ? "empty"
        : "ready";

  return (
    <PageFrame>
      {/* Banners sit OUTSIDE the aria-busy region below. The success notice
          is set in the same batch as the refetch it describes, and assistive
          tech may defer or drop a live-region update inside a busy container.
          All three stay mounted; MessageBanner renders sr-only when empty,
          which is what keeps its live region announcing. */}
      <MessageBanner tone="danger">
        {loadError ? `Could not load billing data: ${loadError.message}` : ""}
      </MessageBanner>
      <MessageBanner tone="danger">
        {billing?.status === "past_due"
          ? "Your last payment failed. Replace your card below to bring your subscription back up to date."
          : ""}
      </MessageBanner>
      <MessageBanner tone={notice?.tone ?? "success"}>{notice?.text ?? ""}</MessageBanner>

      <div aria-busy={busy || undefined}>
        {/* One announcement for the region, not one per skeleton bar. */}
        {showSkeleton ? (
          <span className="sr-only" role="status">
            Loading billing
          </span>
        ) : null}

        <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label="Licensed vehicles"
            value={
              showSkeleton ? (
                <Skeleton display="inline-block" w="2.5ch" h="1.25rem" />
              ) : loadError?.licences ? (
                "-"
              ) : (
                String(vehicleCount)
              )
            }
            sub="company-wide, counted on each billing date"
          />
          <Stat
            label="Monthly total"
            value={
              showSkeleton ? (
                <Skeleton display="inline-block" w="6ch" h="1.25rem" />
              ) : loadError?.licences ? (
                "-"
              ) : (
                formatPence(amounts.grossPence)
              )
            }
            sub={
              showSkeleton || loadError?.licences
                ? undefined
                : `${formatPence(amounts.netPence)} + ${formatPence(amounts.vatPence)} VAT`
            }
          />
          <Stat
            label="Status"
            value={
              showSkeleton ? (
                <Skeleton display="inline-block" pill w="5ch" h="1.25rem" />
              ) : loadError?.billing ? (
                "-"
              ) : (
                /* font-sans: Stat's value span is font-mono, and a Badge
                   inside it would inherit the mono face. */
                <span className="font-sans">
                  <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
                </span>
              )
            }
          />
          <Stat
            label="Next charge"
            value={
              showSkeleton ? (
                <Skeleton display="inline-block" w="8ch" h="1.25rem" />
              ) : billing?.next_charge_on ? (
                formatCycleDate(billing.next_charge_on)
              ) : (
                "-"
              )
            }
          />
        </div>

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
              if (response.firstCharge) {
                setNotice({
                  tone: "success",
                  text: `Subscription started: ${formatPence(Number(response.grossPence))} charged. Next charge ${formatCycleDate(String(response.nextChargeOn))}.`,
                });
              } else if (response.retried && response.succeeded === false) {
                /* The route answers 200 here: the card was saved, but the
                   outstanding charge it retried was declined again. */
                setNotice({
                  tone: "warning",
                  text: `New card saved, but the outstanding charge was declined (${String(response.failureCode ?? "declined")}). It will be retried automatically.`,
                });
              } else if (response.retried) {
                setNotice({ tone: "success", text: "Card updated and the outstanding charge was taken." });
              } else {
                setNotice({ tone: "success", text: "Card updated." });
              }
              void load();
            }}
          />
          <NextInvoiceCard
            loading={busy}
            unavailable={Boolean(loadError?.licences)}
            amounts={amounts}
            nextChargeOn={billing?.next_charge_on ?? null}
          />
        </div>

        <h2 className="mb-2 mt-0 text-base font-semibold text-ink">Charge history</h2>
        <DataTable
          columns={CHARGE_COLUMNS}
          rows={charges}
          rowKey={(c) => c.id}
          state={tableState}
          errorMessage="Couldn't load charge history."
          onRetry={load}
          emptyTitle="No charges yet"
          emptyDescription="Your first charge appears here after your billing date."
        />
      </div>
    </PageFrame>
  );
}
