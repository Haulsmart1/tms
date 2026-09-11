"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/browser";
import { buildCompanySummaries, type CompanySummary } from "../../../lib/superAdmin/summary";
import { filterBySearch } from "../../../lib/superAdmin/search";
import DataTable, { type Column, type DataTableState } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import MessageBanner from "../../../components/MessageBanner";
import SearchInput from "../../../components/SearchInput";

/* PostgREST caps an unscoped select at 1000 rows by default. Mirrors
   POSTGREST_ROW_CAP in lib/billing/server.ts:21, which cannot be imported
   here: that module pulls in the service-role client and the Square SDK,
   neither of which may reach a "use client" bundle. vehicles, vehicle_licences
   and profiles are all read unbounded below; hitting the cap on any of them
   silently undercounts the per-company columns, so this refuses to guess and
   names the query instead. */
const POSTGREST_ROW_CAP = 1000;

function modelBadge(model: string | null) {
  if (model === "v2_period") return <Badge tone="info">v2 period</Badge>;
  if (model === "v1_immediate") return <Badge tone="neutral">v1 immediate</Badge>;
  return <Badge tone="neutral">unknown</Badge>;
}

function statusBadge(status: string | null) {
  if (status === "active") return <Badge tone="success">active</Badge>;
  if (status === "past_due") return <Badge tone="danger">past due</Badge>;
  if (!status) return <span className="text-ink-3">none</span>;
  return <Badge tone="warning">{status}</Badge>;
}

export default function SuperAdminCompaniesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [rows, setRows] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [capWarning, setCapWarning] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    setCapWarning("");

    const [companies, tenants, vehicles, licences, profiles, billing] = await Promise.all([
      supabase.from("companies").select("id, name"),
      supabase.from("tenants").select("id, name, company_id"),
      // vehicles has no company_id column: selecting one fails the whole
      // request with Postgres 42703. A vehicle reaches its company through
      // tenant_id only.
      supabase.from("vehicles").select("id, tenant_id"),
      supabase.from("vehicle_licences").select("vehicle_id, active"),
      /* company_id as well as tenant_id: nothing in the repo writes
         profiles.company_id, so a row carrying one was seeded by hand and is
         plausibly the account holder. Selecting only tenant_id would
         undercount those companies by exactly that person. */
      supabase.from("profiles").select("id, tenant_id, company_id"),
      supabase.from("company_billing").select("company_id, status, billing_model"),
    ]);

    // Every read that this page depends on to render a trustworthy row must
    // be checked. A load that half-failed must show the table's error state,
    // never a plausible-looking but incomplete list.
    const firstError =
      companies.error || tenants.error || vehicles.error || licences.error || profiles.error;

    if (firstError) {
      setMessage(firstError.message);
      setRows([]);
      setLoading(false);
      return;
    }

    /* company_billing carries billing_model and status only once billing_06
       is applied, and that migration may not be live yet. Its failure is
       therefore the one deliberate exception to "check every query's error":
       it degrades to an unknown-model, no-subscription badge per row rather
       than failing a page that is otherwise perfectly useful, and is often
       the page an operator reaches for when something else is already
       broken. Logged rather than surfaced in the UI, since a badge already
       shows the degraded state. */
    if (billing.error) {
      console.warn("super-admin/companies: company_billing read failed, degrading to unknown model", billing.error);
    }
    const billingRows = billing.error ? [] : billing.data ?? [];

    // Guard the row cap on every unbounded read. A count at exactly 1000 is
    // indistinguishable from "there happen to be exactly 1000 rows" and from
    // "there are more we never saw" - report it rather than let the smaller
    // number pass as fact.
    const cappedAt: string[] = [];
    if ((vehicles.data ?? []).length === POSTGREST_ROW_CAP) cappedAt.push("vehicles");
    if ((licences.data ?? []).length === POSTGREST_ROW_CAP) cappedAt.push("vehicle_licences");
    if ((profiles.data ?? []).length === POSTGREST_ROW_CAP) cappedAt.push("profiles");
    if (cappedAt.length > 0) {
      setCapWarning(
        `${cappedAt.join(", ")} returned exactly ${POSTGREST_ROW_CAP} rows, the PostgREST default cap. Counts below may be undercounted.`,
      );
    }

    setRows(
      buildCompanySummaries({
        companies: (companies.data ?? []) as { id: string; name: string | null }[],
        tenants: (tenants.data ?? []) as { id: string; name: string | null; company_id: string | null }[],
        vehicles: (vehicles.data ?? []) as { id: string; tenant_id: string | null }[],
        licences: (licences.data ?? []) as { vehicle_id: string; active: boolean | null }[],
        profiles: (profiles.data ?? []) as { id: string; tenant_id: string | null; company_id: string | null }[],
        billing: billingRows as { company_id: string; status: string | null; billing_model: string | null }[],
      }),
    );

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () =>
      filterBySearch(query, rows, (row) => [
        row.name,
        row.id,
        row.billingModel,
        row.subscriptionStatus,
      ]),
    [query, rows],
  );

  const columns: Column<CompanySummary>[] = [
    {
      header: "Company",
      cell: (row) => (
        <div>
          <div className="font-medium text-ink">{row.name || "Unnamed company"}</div>
          <div className="font-mono text-xs text-ink-3">{row.id}</div>
        </div>
      ),
    },
    { header: "Tenants", align: "right", cell: (row) => row.tenantCount },
    { header: "Billable vehicles", align: "right", cell: (row) => row.billableVehicleCount },
    { header: "Users", align: "right", cell: (row) => row.userCount },
    { header: "Model", cell: (row) => modelBadge(row.billingModel) },
    { header: "Subscription", cell: (row) => statusBadge(row.subscriptionStatus) },
  ];

  // "error" only when a query this page depends on actually failed. A cap
  // warning or a degraded billing read never puts the table behind the error
  // state: the data is real, just possibly short by a fact we have named.
  const state: DataTableState = loading
    ? "loading"
    : message
      ? "error"
      : visible.length === 0
        ? "empty"
        : "ready";

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Platform</div>

          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Companies</h1>

          <p className="m-0 text-sm text-ink-3">
            Every company on the platform. Select one to edit its details.
          </p>
        </header>

        {/* Skeletons are aria-hidden by design, so without this a screen
            reader gets silence for the whole load. */}
        <span className="sr-only" role="status">
          {loading ? "Loading companies" : ""}
        </span>

        <MessageBanner tone="danger">{message}</MessageBanner>
        <MessageBanner tone="warning">{capWarning}</MessageBanner>

        <SearchInput
          id="company-search"
          label="Search companies"
          value={query}
          onChange={setQuery}
          placeholder="Search by name, id, model or status"
          resultHint={!loading && query ? `${visible.length} of ${rows.length} companies` : undefined}
        />

        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          state={state}
          errorMessage={message}
          onRetry={load}
          onRowClick={(row) => router.push(`/super-admin/companies/${row.id}`)}
          /* Says which query matched nothing. The generic "No companies
             found" on a filtered list reads as "you have no customers". */
          emptyTitle={query ? `Nothing matches "${query}"` : "No companies yet"}
          emptyDescription={
            query ? "Clear the search to see every company." : "Companies appear here once provisioned."
          }
        />
      </div>
    </div>
  );
}
