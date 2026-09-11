"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "../../../lib/supabase/browser";
import {
  buildCompanySummaries,
  isMissingColumnError,
  type CompanySummary,
} from "../../../lib/superAdmin/summary";
import { filterBySearch } from "../../../lib/superAdmin/search";
import { billingModelLabel, subscriptionStatusLabel } from "../../../lib/superAdmin/labels";
import DataTable, { type Column, type DataTableState } from "../../../components/DataTable";
import Badge from "../../../components/Badge";
import MessageBanner from "../../../components/MessageBanner";
import SearchInput from "../../../components/SearchInput";

/* PostgREST caps an unscoped select at 1000 rows by default. Mirrors
   POSTGREST_ROW_CAP in lib/billing/server.ts:21, which cannot be imported
   here: that module pulls in the service-role client and the Square SDK,
   neither of which may reach a "use client" bundle. All five reads this page
   depends on (companies, tenants, vehicles, vehicle_licences, profiles) are
   unbounded, and a truncated read is not harmless everywhere: a capped
   tenants list shortens companyTenantIds, which undercounts Tenants and, via
   countBillableVehicles, Billable vehicles too; a capped companies read drops
   whole rows, so a real customer goes missing from both the list and search.
   >=, not ===, so the guard keeps firing if a future .limit() or a raised
   db-max-rows setting moves the exact boundary - lib/billing/server.ts:87
   makes the same choice for the same reason. */
const POSTGREST_ROW_CAP = 1000;

function modelBadge(model: string | null) {
  const label = billingModelLabel(model);
  if (model === "v2_period") return <Badge tone="info">{label}</Badge>;
  if (model === "v1_immediate") return <Badge tone="neutral">{label}</Badge>;
  return <Badge tone="neutral">{label}</Badge>;
}

function statusBadge(status: string | null, degraded: boolean) {
  // "unknown" wins over everything else while the billing read is degraded.
  // subscriptionStatus is null either way, but null-because-the-read-failed
  // and null-because-there-is-genuinely-no-row are different facts, and only
  // the second one is "none" - see lib/superAdmin/labels.ts.
  if (degraded) return <Badge tone="neutral">unknown</Badge>;

  const label = subscriptionStatusLabel(status, false);
  if (status === "active") return <Badge tone="success">{label}</Badge>;
  if (status === "past_due") return <Badge tone="danger">{label}</Badge>;
  if (!status) return <span className="text-ink-3">{label}</span>;
  return <Badge tone="warning">{label}</Badge>;
}

/* Module scope: the only thing that varies between calls is billingDegraded,
   which the component supplies and memoizes, so this is not rebuilt on every
   render the way an inline literal closing over component state would be. */
function buildColumns(billingDegraded: boolean): Column<CompanySummary>[] {
  return [
    {
      header: "Company",
      cell: (row) => (
        <div>
          {/* A real link, not just the row's onRowClick: without one,
              ctrl-click, middle-click, "open in new tab" and the
              status-bar URL preview all do nothing, and an operator
              comparing two companies has no way to open a second tab.
              stopPropagation (not preventDefault) so the link still
              navigates normally; it only stops the row's own onRowClick
              from ALSO firing a redundant push on the same click. */}
          <Link
            href={`/super-admin/companies/${row.id}`}
            onClick={(event) => event.stopPropagation()}
            className="font-medium text-ink hover:underline"
          >
            {row.name || "Unnamed company"}
          </Link>
          <div className="font-mono text-xs text-ink-3">{row.id}</div>
        </div>
      ),
    },
    { header: "Tenants", align: "right", cell: (row) => row.tenantCount },
    { header: "Billable vehicles", align: "right", cell: (row) => row.billableVehicleCount },
    { header: "Users", align: "right", cell: (row) => row.userCount },
    { header: "Model", cell: (row) => modelBadge(row.billingModel) },
    { header: "Subscription", cell: (row) => statusBadge(row.subscriptionStatus, billingDegraded) },
  ];
}

export default function SuperAdminCompaniesPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [rows, setRows] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [capWarning, setCapWarning] = useState("");
  const [billingDegraded, setBillingDegraded] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    setCapWarning("");
    setBillingDegraded(false);

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

    /* billing_06 adds billing_model to an EXISTING table, so its absence is a
       missing column (42703 / PGRST204), not a missing table. Only that one
       specific failure degrades gracefully. An RLS denial, a network blip,
       or anything else on this read is indistinguishable from "we do not
       know whether this company is subscribed", which is not a fact this
       page may hide - it fails the whole page like the other five reads. */
    const billingIsUnappliedMigration = billing.error ? isMissingColumnError(billing.error) : false;

    const firstError =
      companies.error ||
      tenants.error ||
      vehicles.error ||
      licences.error ||
      profiles.error ||
      (billing.error && !billingIsUnappliedMigration ? billing.error : null);

    if (firstError) {
      setMessage(firstError.message);
      setRows([]);
      setLoading(false);
      return;
    }

    if (billingIsUnappliedMigration) {
      console.warn(
        "super-admin/companies: company_billing.billing_model is missing (billing_06 not applied), degrading Model/Subscription to unknown",
        billing.error,
      );
    }
    setBillingDegraded(billingIsUnappliedMigration);
    const billingRows = billingIsUnappliedMigration ? [] : billing.data ?? [];

    // Guard the row cap on every unbounded read this page depends on. A
    // count sitting at the cap is indistinguishable from "there happen to be
    // exactly that many rows" and from "there are more we never saw" -
    // report it rather than let the smaller number pass as fact. tenants and
    // companies are not exempt from this: see the POSTGREST_ROW_CAP comment
    // above for why a capped read on either of those is not harmless.
    const cappedAt: string[] = [];
    if ((companies.data ?? []).length >= POSTGREST_ROW_CAP) cappedAt.push("companies");
    if ((tenants.data ?? []).length >= POSTGREST_ROW_CAP) cappedAt.push("tenants");
    if ((vehicles.data ?? []).length >= POSTGREST_ROW_CAP) cappedAt.push("vehicles");
    if ((licences.data ?? []).length >= POSTGREST_ROW_CAP) cappedAt.push("vehicle_licences");
    if ((profiles.data ?? []).length >= POSTGREST_ROW_CAP) cappedAt.push("profiles");
    if (cappedAt.length > 0) {
      setCapWarning(
        `${cappedAt.join(", ")} returned ${POSTGREST_ROW_CAP} or more rows, the PostgREST default cap. Counts below may be undercounted, and some companies may be missing entirely.`,
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
        // The display string, not the raw value: search must match what the
        // operator can see, and "Unnamed company" is what renders when name
        // is null.
        row.name || "Unnamed company",
        row.id,
        billingModelLabel(row.billingModel),
        subscriptionStatusLabel(row.subscriptionStatus, billingDegraded),
      ]),
    [query, rows, billingDegraded],
  );

  const columns = useMemo(() => buildColumns(billingDegraded), [billingDegraded]);

  // "error" only when a read this page depends on actually failed. A cap
  // warning or a degraded billing read never puts the table behind the error
  // state: the data is real, just possibly short by a fact named above it.
  const state: DataTableState = loading
    ? "loading"
    : message
      ? "error"
      : visible.length === 0
        ? "empty"
        : "ready";

  return (
    /* Matches /super-admin/requests, the first page in this area to move onto
       the design system. The photo background and dark scrim that used to
       live here are gone on purpose: the console has one surface language
       and this area was the only thing outside it. */
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

        {/* No separate danger banner for a load failure: the table's own
            error state below carries the same message plus a Retry button,
            and showing both said the same thing twice. These two banners are
            warnings about data that DID load, which the table's error state
            has no way to say. */}
        <MessageBanner tone="warning">
          {billingDegraded
            ? 'Billing model and subscription status are unavailable (billing_06 has not been applied yet). Showing "unknown" until it is.'
            : ""}
        </MessageBanner>
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
