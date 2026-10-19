"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Stat from "../../components/Stat";
import TodayJobsTable, { type TodayJobRow } from "../../components/dashboard/TodayJobsTable";
import Button, { buttonClasses } from "../../components/Button";
import { ArrowUpRight, RefreshCw, Route, ScanLine, Truck } from "lucide-react";
import { buildNeedsAttention, type AttentionItem, type RevenueDay } from "../../lib/dashboard/aggregate";
import { buildRevenueForDays, lastNDayKeys, NON_COLLECTABLE_STATUS_FILTER } from "../../lib/dashboard/days";
import { fleetAttention, fleetTiles, type FleetTiles } from "../../lib/dashboard/fleetReadiness";
import { loadCompanyTimeZone } from "../../lib/planning/companyTimeZone";
import { loadFleetInput } from "../../lib/shifts/fleetQuery";
import { operatorDay, operatorDayInTimeZone } from "../../lib/time";
import { isAwaitingPod } from "../../lib/pod/overdue";
import Skeleton from "../../components/Skeleton";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
import GettingStartedPanel from "../../components/dashboard/GettingStartedPanel";
import type { GettingStartedCounts } from "../../lib/dashboard/gettingStarted";

type Kpis = {
  jobsToday: number;
  unassigned: number;
  onTheRoad: number;
  podsAwaiting: number;
  overdueInvoicesTotal: number;
};

function money(value: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export default function DashboardPage() {
  const supabase = createClient();
  const tenant = useTenant();
  const router = useRouter();

  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [refreshKey, setRefreshKey] = useState(0);
  const [kpis, setKpis] = useState<Kpis>({
    jobsToday: 0, unassigned: 0, onTheRoad: 0, podsAwaiting: 0, overdueInvoicesTotal: 0,
  });
  const [todayJobs, setTodayJobs] = useState<TodayJobRow[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [revenue, setRevenue] = useState<RevenueDay[]>([]);
  /* Self-serve signup's first-run panel (decision 2 in the signup spec).
     Loaded separately from the KPIs so a count failure cannot take the
     dashboard down; a failed count reads as zero and the panel errs toward
     showing. Admin only: staff cannot add a card, a vehicle or a driver. */
  const [gettingStarted, setGettingStarted] = useState<GettingStartedCounts | null>(null);
  /* Shifts/walkaround tiles and attention items. Loaded and failed
     independently of the KPIs above, same reasoning as gettingStarted: the
     shifts_* SQL may not be applied in every environment yet, and a failure
     here must hide this row rather than take the whole dashboard down.
     fleet stays null on any failure, which is also what hides the row. */
  const [fleet, setFleet] = useState<FleetTiles | null>(null);
  const [fleetItems, setFleetItems] = useState<AttentionItem[]>([]);
  // The tenant the KPIs/rows on screen were loaded FOR. Set only when the
  // load below reaches "ready", never on "error". See
  // lib/loading/skeletonVisibility.ts.
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    /* This guard fixes an existing bug rather than preventing a new one.
       TenantGate is an element inside this component's own JSX, not a wrapper
       around it, so it only ever gated the rendered DOM: DashboardPage mounts
       and this effect fires while status is still "loading", and has always
       done so. Every query below therefore ran with activeTenantId === null on
       each cold load. RLS is the isolation boundary (see CLAUDE.md), so that
       was a wasted round trip returning nothing, not a leak, which is why it
       went unnoticed.

       Returning BEFORE setState("loading") also stops a token refresh flashing
       a skeleton over a populated page: resolve() re-enters "loading" on every
       auth event, and this effect must not reset the page for that. */
    if (tenant.status !== "ready") return;

    let cancelled = false;

    async function load() {
      /* The effect above already returned for this case. Repeated here because
         a narrowing does not cross a function boundary: batch 1's guard sat in
         the effect while these queries sit in here, so it never reached them
         and this page kept querying unscoped. */
      if (tenant.status !== "ready") return;

      setState("loading");
      /* SET-14: the operator's calendar day (lib/time.ts), not the UTC date,
         which is still yesterday between 00:00 and 01:00 BST. The revenue
         chart and its query share the same day keys. */
      const today = operatorDay(new Date());
      const revenueDays = lastNDayKeys(today, 7);
      const sevenDaysAgo = revenueDays[0];

      const jobsTodayQuery = tenant.filterByTenant(
        supabase.from("jobs").select("id, reference, status, vehicle_id, driver_id, customer_id, customers(name)"),
      ).eq("scheduled_date", today);

      const overduePodStopsQuery = tenant.filterByTenant(
        supabase
          .from("job_stops")
          .select("id, planned_at, pod_status, jobs ( reference, status )")
          .eq("type", "delivery")
          // NULL-safe on purpose. PostgREST compiles .neq() to SQL <>, and
          // NULL <> 'delivered' is NULL, which WHERE discards: a plain .neq
          // silently drops every stop whose pod_status is NULL, even though an
          // undelivered stop is exactly what this query is looking for. That
          // made /dashboard and /pod disagree about the same rows despite
          // sharing isAwaitingPod. The filter stays server-side rather than
          // being dropped so the query does not fetch every delivered stop in
          // the tenant's history on each load.
          .or("pod_status.is.null,pod_status.neq.delivered"),
      );

      const overdueInvoicesQuery = tenant
        .filterByTenant(supabase.from("invoices").select("id, invoice_number, due_date, total, status"))
        // Void, credited, cancelled and draft invoices are not money owed.
        .not("status", "in", NON_COLLECTABLE_STATUS_FILTER)
        .lt("due_date", today);

      const paidInvoicesQuery = tenant
        .filterByTenant(supabase.from("invoices").select("issue_date, total, status"))
        .eq("status", "paid")
        .gte("issue_date", sevenDaysAgo);

      const [
        { data: jobsTodayData, error: jobsTodayError },
        { data: overduePodStopsRaw, error: podError },
        { data: overdueInvoices, error: invoiceError },
        { data: paidInvoices, error: revenueError },
      ] = await Promise.all([jobsTodayQuery, overduePodStopsQuery, overdueInvoicesQuery, paidInvoicesQuery]);

      // The query already restricts to delivery stops that are not delivered;
      // isAwaitingPod re-states the whole predicate in one place so /pod and
      // this page cannot drift apart. Kept client-side rather than as a
      // PostgREST embedded-relation filter, matching this codebase's existing
      // convention (see app/invoices/page.tsx).
      const overduePodStops = (overduePodStopsRaw ?? []).filter((r: any) =>
        isAwaitingPod({
          // "delivery" is a literal, not a read: the query above already filters
          // .eq("type", "delivery") and does not select the column. Re-select
          // type if this block is ever reused without that server-side filter.
          type: "delivery",
          pod_status: r.pod_status ?? null,
          jobStatus: r.jobs?.status ?? null,
        }),
      );

      if (cancelled) return;

      if (jobsTodayError || podError || invoiceError || revenueError) {
        setState("error");
        return;
      }

      const jobsToday = jobsTodayData ?? [];
      const unassigned = jobsToday.filter(
        (j) => j.status === "planned" && (!j.vehicle_id || !j.driver_id),
      ).length;
      // Stand-in until TomTom tracking lands (see docs/superpowers/specs/
      // 2026-08-11-console-design-system-phase1-2-design.md): "rostered today",
      // not live vehicle position.
      const onTheRoad = jobsToday.filter((j) => j.status === "planned" && j.vehicle_id).length;

      const overduePodsForAttention = overduePodStops
        .filter((r: any) => r.planned_at)
        .map((r: any) => ({ stopId: r.id, jobRef: r.jobs?.reference ?? "?", plannedAt: r.planned_at as string }));

      const invoiceRows = overdueInvoices ?? [];
      const overdueInvoicesTotal = invoiceRows.reduce((sum, inv) => sum + Number(inv.total), 0);

      setKpis({
        jobsToday: jobsToday.length,
        unassigned,
        onTheRoad,
        podsAwaiting: overduePodStops.length,
        overdueInvoicesTotal,
      });

      setTodayJobs(
        jobsToday.slice(0, 8).map((j) => ({
          id: j.id,
          reference: j.reference,
          customerName: (j.customers as unknown as { name: string } | null)?.name ?? "—",
          status: j.status,
        })),
      );

      setAttention(
        buildNeedsAttention(
          overduePodsForAttention,
          invoiceRows.map((i) => ({
            id: i.id, invoiceNumber: i.invoice_number, dueDate: i.due_date, total: Number(i.total),
          })),
          new Date(),
        ),
      );

      setRevenue(
        buildRevenueForDays(
          (paidInvoices ?? []).map((i) => ({ issueDate: i.issue_date, total: Number(i.total) })),
          revenueDays,
        ),
      );

      setDataTenantId(tenant.activeTenantId);
      setState("ready");
    }

    async function loadGettingStarted() {
      if (tenant.status !== "ready" || tenant.role !== "admin") {
        setGettingStarted(null);
        return;
      }
      /* Head-only counts. company_billing is company-scoped and its RLS
         policy shows an admin exactly their own company's row, so no tenant
         filter applies there. */
      const [vehicles, drivers, card] = await Promise.all([
        tenant.filterByTenant(supabase.from("vehicles").select("id", { count: "exact", head: true })),
        tenant.filterByTenant(supabase.from("drivers").select("id", { count: "exact", head: true })),
        supabase.from("company_billing").select("company_id", { count: "exact", head: true }),
      ]);
      if (cancelled) return;
      setGettingStarted({
        vehicleCount: vehicles.error ? 0 : vehicles.count ?? 0,
        driverCount: drivers.error ? 0 : drivers.count ?? 0,
        cardCount: card.error ? 0 : card.count ?? 0,
      });
    }

    async function loadFleet() {
      if (tenant.status !== "ready") return;
      try {
        const ids = tenant.activeTenantId ? [tenant.activeTenantId] : tenant.tenants.map((t) => t.id);
        const zone = await loadCompanyTimeZone(supabase, ids);
        const now = new Date();
        const today = operatorDayInTimeZone(now, zone.timeZone);
        const input = await loadFleetInput(supabase, tenant.activeTenantId, today, now, zone.timeZone);
        if (cancelled) return;
        setFleet(fleetTiles(input));
        setFleetItems(fleetAttention(input));
      } catch (error) {
        // Fails closed: hides the fleet tiles/attention items rather than the
        // whole dashboard. Most likely cause today is the shifts_* SQL not
        // being applied yet in this environment.
        console.error("[dashboard] fleet load failed", error);
        if (cancelled) return;
        setFleet(null);
        setFleetItems([]);
      }
    }

    load();
    void loadGettingStarted();
    void loadFleet();
    return () => { cancelled = true; };
  }, [tenant.activeTenantId, tenant.status, refreshKey]);

  const maxRevenue = Math.max(1, ...revenue.map((d) => d.total));

  // fleetItems first: dangerous defects and pending objections must never be
  // pushed off the list by older, less urgent items before the slice below.
  const combinedAttention = [...fleetItems, ...attention];

  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: state === "loading",
    hasData: state === "ready",
    activeTenantId: tenant.activeTenantId,
    dataTenantId,
  });

  return (
    <TenantGate>
      {/* The full-bleed element carries `ds` and the background so the canvas
          reaches the sidebar; the inner <main> carries only the width
          constraint. Putting both on one element paints the canvas only inside
          max-w-6xl and leaves the page background showing either side. Same
          shape as app/jobs/page.tsx:249-250. */}
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <header className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">TMS Wizard · Operations</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Operations overview</h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-2">Plan the work. Follow the evidence. Keep every movement connected.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" aria-label="Refresh overview" disabled={state === "loading"} onClick={() => setRefreshKey((key) => key + 1)}><RefreshCw size={16} aria-hidden />{state === "loading" ? "Loading…" : "Refresh overview"}</Button>
                <Link href="/jobs" className={buttonClasses("primary")}><Truck size={17} aria-hidden />Open jobs board<ArrowUpRight size={16} aria-hidden /></Link>
              </div>
            </div>
            <nav aria-label="Operations shortcuts" className="mt-5 grid gap-2 border-t border-line pt-4 sm:grid-cols-3">
              {[{ href: "/planning", label: "Plan & dispatch", detail: "Allocate vehicles and drivers", Icon: Route }, { href: "/load-transfer", label: "Transfer a load", detail: "Keep movements traceable", Icon: Truck }, { href: "/pod", label: "Review POD evidence", detail: "Check recorded delivery evidence", Icon: ScanLine }].map(({ href, label, detail, Icon }) => <Link key={href} href={href} className="flex min-h-16 items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><Icon size={20} className="shrink-0 text-primary" aria-hidden /><span><span className="block text-sm font-semibold text-ink">{label}</span><span className="mt-0.5 block text-xs text-ink-2">{detail}</span></span><ArrowUpRight size={15} className="ml-auto shrink-0 text-ink-2" aria-hidden /></Link>)}
            </nav>
          </header>

          {gettingStarted ? <GettingStartedPanel {...gettingStarted} className="mt-6" /> : null}

          {state === "error" ? (
            <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-border bg-danger-tint p-4 text-sm text-danger-strong">
              <span>Overview unavailable. Open the jobs board or retry; no records have been changed.</span>
              <Button variant="secondary" onClick={() => setRefreshKey((key) => key + 1)}>Retry overview</Button>
            </div>
          ) : null}

          {state !== "error" ? <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5" aria-busy={showSkeleton}>
            {/* One announcement for the whole page, not one per skeleton bar.
                Replaces the announcement the old "Loading..." text gave free. */}
            {showSkeleton ? <span className="sr-only" role="status">Loading dashboard</span> : null}
            <Stat
              label="Jobs today"
              value={showSkeleton ? <Skeleton display="inline-block" w="2.5ch" h="1.25rem" /> : String(kpis.jobsToday)}
            />
            <Stat
              label="Unassigned"
              value={showSkeleton ? <Skeleton display="inline-block" w="2.5ch" h="1.25rem" /> : String(kpis.unassigned)}
              sub={kpis.unassigned > 0 ? "needs a vehicle/driver" : undefined}
              subTone="warning"
            />
            <Stat
              label="Jobs with a vehicle"
              value={showSkeleton ? <Skeleton display="inline-block" w="2.5ch" h="1.25rem" /> : String(kpis.onTheRoad)}
              sub="rostered today"
            />
            <Stat
              label="PODs awaiting"
              value={showSkeleton ? <Skeleton display="inline-block" w="2.5ch" h="1.25rem" /> : String(kpis.podsAwaiting)}
              sub={kpis.podsAwaiting > 0 ? "open delivery stops" : undefined}
              subTone="warning"
            />
            <Stat
              label="Overdue invoices"
              value={showSkeleton ? <Skeleton display="inline-block" w="6ch" h="1.25rem" /> : money(kpis.overdueInvoicesTotal)}
              sub={kpis.overdueInvoicesTotal > 0 ? "past due" : undefined}
              subTone="danger"
            />
          </div> : null}

          {/* Own-fleet shifts and walkaround checks. Absent (not skeletoned)
              until the fleet load above succeeds, same as GettingStartedPanel
              above: the shifts_* SQL may not be applied in every environment
              yet, and this row simply does not appear rather than blocking
              the rest of the dashboard on it. */}
          {fleet ? (
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat
                label="On shift now"
                value={String(fleet.onShift)}
                sub={`of ${fleet.activeDrivers} drivers`}
                onClick={() => router.push("/shifts")}
              />
              <Stat
                label="Walkarounds today"
                value={String(fleet.vehiclesChecked)}
                sub={fleet.vehiclesOutUnchecked > 0 ? `${fleet.vehiclesOutUnchecked} on jobs unchecked` : undefined}
                subTone="warning"
                onClick={() => router.push("/shifts")}
              />
              <Stat
                label="Open defects"
                value={String(fleet.openDefects)}
                sub={fleet.dangerousDefects > 0 ? `${fleet.dangerousDefects} dangerous` : undefined}
                subTone="danger"
                onClick={() => router.push("/maintenance?tab=walkaround")}
              />
              <Stat
                label="Objections"
                value={String(fleet.pendingObjections)}
                sub="awaiting approval"
                onClick={() => router.push("/maintenance?tab=walkaround")}
              />
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Today's jobs</h2>
                <Link href="/jobs" className="text-sm font-semibold text-primary hover:underline">
                  View all
                </Link>
              </div>
              <TodayJobsTable
                rows={todayJobs}
                state={showSkeleton ? "loading" : state === "error" ? "error" : todayJobs.length ? "ready" : "empty"}
                onRetry={() => setRefreshKey((key) => key + 1)}
              />
            </section>

            <section className="flex flex-col gap-4">
              <div className="rounded-lg border border-line bg-surface p-4 shadow-sm" aria-busy={showSkeleton}>
                <h2 className="mb-2 text-sm font-semibold text-ink">Needs attention</h2>
                {showSkeleton ? (
                  <ul className="flex flex-col gap-2">
                    {[0, 1, 2].map((i) => (
                      <li key={`attention-skeleton-${i}`} className="px-2 py-1.5 -mx-2">
                        <Skeleton w="70%" h="0.875rem" className="mb-1.5" />
                        <Skeleton w="45%" h="0.75rem" />
                      </li>
                    ))}
                  </ul>
                ) : state === "error" ? (
                  <p className="text-sm text-ink-2">Attention checks are unavailable. Review jobs and evidence before making allocations.</p>
                ) : combinedAttention.length === 0 ? (
                  <p className="text-sm text-ink-2">No attention items found in this overview.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {combinedAttention.slice(0, 5).map((item) => (
                      <li key={item.id}>
                        <Link href={item.href} className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-surface-hover">
                          <span className="block text-sm font-medium text-ink">{item.title}</span>
                          <span className="block text-xs text-ink-3">{item.meta}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {state !== "error" ? <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  Revenue · last 7 days
                </h2>
                <div className="flex h-16 items-end gap-1.5" aria-busy={showSkeleton}>
                  {showSkeleton
                    ? [0, 1, 2, 3, 4, 5, 6].map((i) => (
                        // Fixed heights, not random: a skeleton that reshuffles
                        // on every render reads as data arriving when it is not.
                        <div key={`revenue-skeleton-${i}`} className="flex-1">
                          <Skeleton w="100%" h={`${[40, 65, 30, 80, 55, 70, 45][i]}%`} />
                        </div>
                      ))
                    : revenue.map((d) => (
                        <div key={d.date} className="flex-1" title={`${d.label}: ${money(d.total)}`}>
                          <div
                            className="w-full rounded-t bg-primary"
                            style={{ height: `${Math.max(4, (d.total / maxRevenue) * 100)}%` }}
                          />
                        </div>
                      ))}
                </div>
              </div> : null}
            </section>
          </div>
        </main>
      </div>
    </TenantGate>
  );
}
