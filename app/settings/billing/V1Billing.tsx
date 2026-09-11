"use client";

/* The v1_immediate billing body: charge in advance every 4 weeks, pro-rata the
   moment a vehicle is added. Split out of page.tsx unchanged when v2 arrived.
   Every company is still on this model.

   Reads platform_charges and vehicle_addon_charges, prices with
   lib/billing/money.ts. Do NOT import anything from ./rateCard or
   ./pricingCopy here: those are v2's pricing shape and mean different things.
   See CLAUDE.md. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
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
  /* "pending" only ever arrives via an addon row (see AddonChargeRow below):
     platform_charges is written succeeded/failed in one step and never goes
     through an intent row, so a cycle charge can never actually be pending.
     It is included here anyway because this is the merged type the table
     renders, and a merged row from either source has to satisfy it. */
  status: "succeeded" | "failed" | "pending";
  failure_code: string | null;
  receipt_url: string | null;
  created_at: string;
  /* Present only on rows merged in from vehicle_addon_charges. A 4-weekly
     cycle charge leaves it undefined and renders exactly as it always has.
     It carries the registration and the days covered, because on a mid-cycle
     charge the cycle date alone tells the customer nothing about why they
     were charged in the middle of a cycle. */
  addon_label?: string;
};

/* The raw vehicle_addon_charges shape, kept local to this file: it exists only
   to be folded into ChargeRow below. PostgREST returns an embedded to-one join
   as an array, hence `vehicles` being a list of at most one row. */
type AddonChargeRow = {
  id: string;
  cycle_date: string;
  attempt: number;
  covers_days: number;
  gross_pence: number;
  /* See docs/sql/billing_05_addon_intent.sql: rows are written 'pending'
     BEFORE the Square call and settled to succeeded/failed after, so a
     replayed request can rebuild the exact same payload instead of risking a
     double charge. A pending row's outcome is genuinely unknown here, not
     "not yet happened" - the card may already have been charged. */
  status: "succeeded" | "failed" | "pending";
  failure_code: string | null;
  receipt_url: string | null;
  created_at: string;
  vehicles?: { registration: string | null }[] | null;
};

/* Which of the three regions failed, so each region withholds only what it
   cannot vouch for: a charge-history failure must not hide a valid card on
   file, and vice versa. `message` is the first error, for the banner.
   `charges` covers BOTH history queries (cycle charges and mid-cycle add-ons):
   they render as one table, so a half-loaded history would read as a complete
   one and quietly hide charges the customer has actually paid. */
type LoadError = {
  message: string;
  billing: boolean;
  charges: boolean;
  licences: boolean;
};

/* Both history queries are limited to this, then merged. See the note in
   `load` about what that means for a company with many add-ons. */
const HISTORY_LIMIT = 24;

/* An add-on always covers exactly one vehicle, so the registration is the
   whole story. Falls back to a generic word rather than rendering blank: the
   FK is `on delete cascade`, so a missing vehicle should be impossible, but
   a select the RLS policy does not reach would also land here. */
function addonLabel(row: AddonChargeRow): string {
  const registration = row.vehicles?.[0]?.registration?.trim();
  const days = row.covers_days;
  return `${registration || "Vehicle"} added mid-cycle · ${days} day${days === 1 ? "" : "s"}`;
}

function toChargeRow(row: AddonChargeRow): ChargeRow {
  return {
    id: row.id,
    cycle_date: row.cycle_date,
    attempt: row.attempt,
    /* Not a stored column: an add-on charge is per vehicle by construction
       (vehicle_addon_charges is unique on company/cycle/vehicle/attempt). */
    vehicle_count: 1,
    gross_pence: row.gross_pence,
    status: row.status,
    failure_code: row.failure_code,
    receipt_url: row.receipt_url,
    created_at: row.created_at,
    addon_label: addonLabel(row),
  };
}

/* No widths: DataTable's comment says set them on every column or none. */
const CHARGE_COLUMNS: Column<ChargeRow>[] = [
  {
    header: "Billing date",
    cell: (c) => (
      <div>
        <span className="font-mono">{formatCycleDate(c.cycle_date)}</span>
        {/* Mid-cycle add-ons share the cycle date of the cycle they fall in,
            so without this two rows would show the same date with no hint of
            what the second one was for. */}
        {c.addon_label ? (
          <div className="text-xs text-ink-3">{c.addon_label}</div>
        ) : null}
      </div>
    ),
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
    cell: (c) => {
      if (c.status === "succeeded") return <Badge tone="success">Paid</Badge>;
      /* "pending" means the outcome is unknown, not that nothing happened -
         the card may already be charged (see billing_05_addon_intent.sql).
         Reusing "danger"/Failed here would tell a customer whose money has
         genuinely left their account to go retry a card that may already
         have been charged. warning (amber) is the closest existing tone to
         "still being confirmed": it does not claim success, and unlike
         danger it does not invite a retry. Rows normally clear this state in
         under a second; wording says "still confirming" rather than naming a
         timeout so it does not read as broken for that ordinary case. */
      if (c.status === "pending") {
        return (
          <span className="inline-flex items-center gap-2">
            <Badge tone="warning">Pending</Badge>
            <span className="text-xs text-ink-3">still confirming with your bank</span>
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-2">
          <Badge tone="danger">Failed</Badge>
          <span className="text-xs text-ink-3">{c.failure_code ?? "declined"}</span>
        </span>
      );
    },
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

export default function V1Billing() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [billing, setBilling] = useState<BillingRow | null>(null);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  // The tenant selected when the figures on screen were loaded. Set only when
  // the try block below completes without throwing, never in the catch
  // branch, matching the "do not set on failure" rule in
  // lib/loading/skeletonVisibility.ts.
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);
  const [showCardForm, setShowCardForm] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "warning" } | null>(null);
  const [loadError, setLoadError] = useState<LoadError | null>(null);

  /* `load` is memoized on [supabase] only, deliberately: this data is
     company-wide (see the filterByTenant comment below) and must NOT refetch
     on a tenant switch. Reading tenant.activeTenantId through a ref, rather
     than adding it to load's deps, records which tenant was active when a
     load completed without also making load's identity (and therefore the
     effect that calls it) depend on activeTenantId. */
  const activeTenantIdRef = useRef(tenant.activeTenantId);
  activeTenantIdRef.current = tenant.activeTenantId;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [billingRes, chargesRes, addonRes, licencesRes] = await Promise.all([
        supabase.from("company_billing").select("*").maybeSingle(),
        supabase
          .from("platform_charges")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT),
        /* Company-wide on purpose, no filterByTenant, for the same reason as
           platform_charges above: this is the bill, not an operational view.
           RLS scopes it to the admin's company. Limited to HISTORY_LIMIT like
           the query above, then merged and sliced back down to it; see the
           note on the slice in setCharges for why that is exact. */
        supabase
          .from("vehicle_addon_charges")
          .select("*, vehicles ( registration )")
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT),
        /* Company-wide on purpose, no filterByTenant: this is the bill, not
           an operational view, and the charge spans every tenant under the
           company. RLS scopes it to the admin's company. See the
           count-divergence follow-up in the spec before "fixing" this. */
        supabase.from("vehicle_licences").select("vehicle_id").eq("active", true),
      ]);
      const firstError =
        billingRes.error ?? chargesRes.error ?? addonRes.error ?? licencesRes.error;
      setLoadError(
        firstError
          ? {
              message: firstError.message,
              billing: Boolean(billingRes.error),
              /* No fourth flag: both queries feed the one history table, so
                 either failing means the table cannot be vouched for. */
              charges: Boolean(chargesRes.error) || Boolean(addonRes.error),
              licences: Boolean(licencesRes.error),
            }
          : null
      );
      setBilling((billingRes.data as BillingRow | null) ?? null);
      /* One chronological sequence rather than two tables: a mid-cycle charge
         is a charge, and splitting them would leave the customer reconciling
         two lists against one card statement.

         The slice is what makes the tail of that list honest, and it is exact
         rather than approximate: each query independently returns its own most
         recent HISTORY_LIMIT, so their union always contains the true most
         recent HISTORY_LIMIT of the combined set. Sorting then slicing turns
         two per-table windows into one real "most recent charges" list.
         Without it the list runs to twice the limit and silently omits older
         rows of one kind while showing older rows of the other, which the
         customer has no way to see. */
      setCharges(
        [
          ...((chargesRes.data as ChargeRow[] | null) ?? []),
          ...((addonRes.data as AddonChargeRow[] | null) ?? []).map(toChargeRow),
        ]
          .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
          .slice(0, HISTORY_LIMIT)
      );
      setVehicleCount(
        new Set((licencesRes.data ?? []).map((l) => l.vehicle_id)).size
      );
      setDataTenantId(activeTenantIdRef.current);
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
    activeTenantId: tenant.activeTenantId,
    dataTenantId,
  });

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
    <>
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
            label="4-weekly total"
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
                : `${formatPence(amounts.netPence)} + ${formatPence(amounts.vatPence)} VAT · ${formatPence(amounts.blendedWeeklyPence)}/vehicle/week`
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
    </>
  );
}

/* Attached to the component rather than exported separately so the shell gets
   the body and its header sentence from one import and they cannot fall out of
   step. v1 copy stays hardcoded here: lib/billing/pricingCopy.ts is v2 only. */
V1Billing.Description = function V1Description() {
  return (
    <>
      £10 per active licensed vehicle per week, plus VAT, and less per vehicle
      as the fleet grows. Charged to your card every 4 weeks.
    </>
  );
};
