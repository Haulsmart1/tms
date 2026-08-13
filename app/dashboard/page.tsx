"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Stat from "../../components/Stat";
import DataTable, { type Column } from "../../components/DataTable";
import { buildNeedsAttention, buildRevenueLast7Days, type AttentionItem, type RevenueDay } from "../../lib/dashboard/aggregate";
import { isAwaitingPod } from "../../lib/pod/overdue";

type Kpis = {
  jobsToday: number;
  unassigned: number;
  onTheRoad: number;
  podsAwaiting: number;
  overdueInvoicesTotal: number;
};

type TodayJobRow = {
  id: string;
  reference: string;
  customerName: string;
  status: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export default function DashboardPage() {
  const supabase = createClient();
  const tenant = useTenant();

  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [kpis, setKpis] = useState<Kpis>({
    jobsToday: 0, unassigned: 0, onTheRoad: 0, podsAwaiting: 0, overdueInvoicesTotal: 0,
  });
  const [todayJobs, setTodayJobs] = useState<TodayJobRow[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [revenue, setRevenue] = useState<RevenueDay[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      const today = todayIso();

      const sevenDaysAgo = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        return d.toISOString().slice(0, 10);
      })();

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
        .neq("status", "paid")
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
        buildRevenueLast7Days(
          (paidInvoices ?? []).map((i) => ({ issueDate: i.issue_date, total: Number(i.total) })),
          new Date(),
        ),
      );

      setState("ready");
    }

    load();
    return () => { cancelled = true; };
  }, [tenant.activeTenantId]);

  const jobColumns: Column<TodayJobRow>[] = [
    { header: "Reference", cell: (r) => <span className="font-mono text-sm font-medium text-ink">{r.reference}</span> },
    { header: "Customer", cell: (r) => r.customerName },
    {
      header: "Status",
      cell: (r) => (
        <span className="inline-flex items-center rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-semibold text-primary-deep">
          {r.status}
        </span>
      ),
    },
  ];

  const maxRevenue = Math.max(1, ...revenue.map((d) => d.total));

  return (
    <TenantGate>
      {/* The full-bleed element carries `ds` and the background so the canvas
          reaches the sidebar; the inner <main> carries only the width
          constraint. Putting both on one element paints the canvas only inside
          max-w-6xl and leaves the page background showing either side. Same
          shape as app/jobs/page.tsx:249-250. */}
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-6xl px-6 py-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>

          {state === "error" ? (
            <div className="mt-6 rounded-lg border border-danger-border bg-danger-tint p-4 text-sm text-danger-strong">
              Couldn't load the dashboard. Refresh to try again.
            </div>
          ) : null}

          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Jobs today" value={state === "loading" ? "—" : String(kpis.jobsToday)} />
            <Stat
              label="Unassigned"
              value={state === "loading" ? "—" : String(kpis.unassigned)}
              sub={kpis.unassigned > 0 ? "needs a vehicle/driver" : undefined}
              subTone="warning"
            />
            <Stat label="On the road" value={state === "loading" ? "—" : String(kpis.onTheRoad)} sub="rostered today" />
            <Stat
              label="PODs awaiting"
              value={state === "loading" ? "—" : String(kpis.podsAwaiting)}
              sub={kpis.podsAwaiting > 0 ? "open delivery stops" : undefined}
              subTone="warning"
            />
            <Stat
              label="Overdue invoices"
              value={state === "loading" ? "—" : money(kpis.overdueInvoicesTotal)}
              sub={kpis.overdueInvoicesTotal > 0 ? "past due" : undefined}
              subTone="danger"
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">Today's jobs</h2>
                <Link href="/jobs" className="text-sm font-semibold text-primary hover:underline">
                  View all
                </Link>
              </div>
              <DataTable
                columns={jobColumns}
                rows={todayJobs}
                rowKey={(r) => r.id}
                state={state === "loading" ? "loading" : state === "error" ? "error" : todayJobs.length ? "ready" : "empty"}
                emptyTitle="No jobs scheduled today"
              />
            </section>

            <section className="flex flex-col gap-4">
              <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-ink">Needs attention</h2>
                {attention.length === 0 ? (
                  <p className="text-sm text-ink-3">Nothing needs attention right now.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {attention.slice(0, 5).map((item) => (
                      <li key={item.id}>
                        <Link href={item.href} className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-surface-2">
                          <span className="block text-sm font-medium text-ink">{item.title}</span>
                          <span className="block text-xs text-ink-3">{item.meta}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
                  Revenue · last 7 days
                </h2>
                <div className="flex h-16 items-end gap-1.5">
                  {revenue.map((d) => (
                    <div key={d.date} className="flex-1" title={`${d.label}: ${money(d.total)}`}>
                      <div
                        className="w-full rounded-t bg-primary"
                        style={{ height: `${Math.max(4, (d.total / maxRevenue) * 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </TenantGate>
  );
}
