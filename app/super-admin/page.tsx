"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Building2, Users, Banknote, FileText, Inbox, type LucideIcon } from "lucide-react";
import { createClient } from "../../lib/supabase/browser";
import { SUPER_ADMIN_ROLE } from "../../lib/roles";
import {
  collectedRevenue,
  platformBillableVehicleCount,
  isMissingRelationError,
  type ChargeSource,
} from "../../lib/superAdmin/summary";
/* format, not money: formatPence is pure presentation. lib/billing/money.ts is
   v1's graduated weekly pricing and must never be applied to a v2 company, so
   importing from it on a page that sums BOTH models would be a standing
   invitation to reach for computeChargeAmounts next. */
import { formatPence } from "../../lib/billing/format";
import Stat from "../../components/Stat";
import MessageBanner from "../../components/MessageBanner";
import Skeleton from "../../components/Skeleton";

// PostgREST caps unscoped selects at 1000 rows by default. lib/billing/server.ts:21
// treats hitting this cap as a live hazard for money (it refuses the charge
// rather than guess). This dashboard has no equivalent guard today and is the
// page that most needs one: a silent cap hit would truncate the vehicle and
// licence reads and undercount every tile that depends on them with no sign
// anything was wrong. Defined locally, not imported, because lib/billing/server.ts
// is server-only (it pulls in the Square SDK and the service-role client) and
// must never end up in a "use client" bundle.
const POSTGREST_ROW_CAP = 1000;

// The v1/v2 charge queries below filter status and created_at server-side so
// PostgREST does not ship the whole charge history to the browser just to
// discard most of it. collectedRevenue re-applies both conditions itself
// (it is the authoritative rule, so the tests still cover it), but the
// server-side filter and collectedRevenue's window must agree, or a charge
// the query already dropped would be missing with no chance for the module
// to report it. Both derive from this one constant.
const COLLECTED_WINDOW_DAYS = 28;

type Totals = {
  companies: number;
  activeSubscriptions: number;
  vehicles: number;
  billableVehicles: number;
  users: number;
  superAdmins: number;
  collectedPence: number;
  payingCompanies: number;
  missingSources: string[];
  zeroRowSources: string[];
};

export default function SuperAdminPage() {
  // useMemo, not a plain call: @supabase/ssr happens to cache a browser
  // singleton internally today, which is the only reason a fresh client per
  // render has not caused a refetch loop. Fourteen other pages in this repo
  // (e.g. app/vehicles/page.tsx) already memoize for this reason; relying on
  // a library implementation detail instead is borrowed correctness.
  const supabase = useMemo(() => createClient(), []);

  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [capWarning, setCapWarning] = useState("");

  /* Each charge source is read on its own and allowed to fail on its own.
     Several billing_0* migrations are written but not applied on this project,
     so a table that does not exist yet must reduce the tile to "what I could
     count, and what I could not", never to a confident zero. */
  const loadChargeSource = useCallback(
    async (table: string, key: ChargeSource["key"], label: string, cutoffIso: string): Promise<ChargeSource> => {
      const { data, error } = await supabase
        .from(table)
        .select("company_id, gross_pence, status, created_at")
        .eq("status", "succeeded")
        .gte("created_at", cutoffIso);

      if (error) {
        if (isMissingRelationError(error)) return { key, label, rows: null };
        throw error;
      }

      return { key, label, rows: (data ?? []) as ChargeSource["rows"] };
    },
    [supabase],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    setCapWarning("");

    const now = new Date();
    const cutoffIso = new Date(
      now.getTime() - COLLECTED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    try {
      const [
        companyCount,
        activeSubscriptions,
        vehicleRows,
        licenceRows,
        userCount,
        superAdmins,
        v1Cycle,
        v1Addon,
        v2Period,
      ] = await Promise.all([
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase
          .from("company_billing")
          .select("company_id", { count: "exact", head: true })
          .eq("status", "active"),
        // No company_id on vehicles; selecting one fails with 42703.
        supabase.from("vehicles").select("id, tenant_id"),
        supabase.from("vehicle_licences").select("vehicle_id, active"),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        // roles!inner, not the usual roles(name) embed: the !inner join is what
        // lets .eq("roles.name", ...) filter the OUTER query, turning this into
        // a single head-count round trip instead of pulling every profile's
        // role home to filter in the browser. Verified against this schema
        // (profiles.role_id -> roles.id is a plain foreign key, so the embed is
        // unambiguous) before relying on it here.
        supabase
          .from("profiles")
          .select("id, roles!inner(name)", { count: "exact", head: true })
          .eq("roles.name", SUPER_ADMIN_ROLE),
        loadChargeSource("platform_charges", "v1_cycle", "v1 cycles", cutoffIso),
        loadChargeSource("vehicle_addon_charges", "v1_addon", "v1 mid-cycle additions", cutoffIso),
        loadChargeSource("period_charges", "v2_period", "v2 periods", cutoffIso),
      ]);

      if (companyCount.error) throw companyCount.error;
      if (activeSubscriptions.error) throw activeSubscriptions.error;
      if (vehicleRows.error) throw vehicleRows.error;
      if (licenceRows.error) throw licenceRows.error;
      if (userCount.error) throw userCount.error;
      if (superAdmins.error) throw superAdmins.error;

      const vehicles = (vehicleRows.data ?? []) as { id: string; tenant_id: string | null }[];
      const licences = (licenceRows.data ?? []) as { vehicle_id: string; active: boolean | null }[];

      // Same guard lib/billing/server.ts applies to money: report the cap hit
      // rather than throw the whole page away, since the operator still
      // benefits from every other tile that has nothing to do with vehicles.
      const cappedOn: string[] = [];
      if (vehicles.length >= POSTGREST_ROW_CAP) cappedOn.push("vehicles");
      if (licences.length >= POSTGREST_ROW_CAP) cappedOn.push("vehicle licences");
      if (cappedOn.length > 0) {
        setCapWarning(
          `The ${cappedOn.join(" and ")} query hit the ${POSTGREST_ROW_CAP}-row cap. Vehicle figures below may be undercounted.`,
        );
      }

      // Platform-wide billable count, from the shared module so it stays
      // identical to countBillableVehicles' per-company definition (see
      // lib/superAdmin/summary.ts for why that matters).
      const billableVehicles = platformBillableVehicleCount(vehicles, licences);

      const revenue = collectedRevenue([v1Cycle, v1Addon, v2Period], now, COLLECTED_WINDOW_DAYS);

      setTotals({
        companies: companyCount.count ?? 0,
        activeSubscriptions: activeSubscriptions.count ?? 0,
        vehicles: vehicles.length,
        billableVehicles,
        users: userCount.count ?? 0,
        superAdmins: superAdmins.count ?? 0,
        collectedPence: revenue.totalPence,
        payingCompanies: revenue.companyCount,
        missingSources: revenue.missingSources,
        zeroRowSources: revenue.zeroRowSources,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load platform figures.");
      setTotals(null);
    }

    setLoading(false);
  }, [supabase, loadChargeSource]);

  useEffect(() => {
    load();
  }, [load]);

  // "Unavailable", not a dash (no em-dashes in this repo) and not the ?? 0
  // fallback baked into every value below. A failed load must render as
  // visibly failed, never as a platform that merely has nothing in it: with
  // only `loading` as the gate, every tile fell through to "0" or "£0.00"
  // the moment loading finished, sitting right behind the error banner and
  // reading as a real, empty platform instead of a load that failed.
  const tileValue = (value: string): ReactNode =>
    loading ? <Skeleton w="5ch" h="1.5rem" /> : totals ? value : "Unavailable";

  // Same reasoning, for the sub-line: a Skeleton here (rather than omitting
  // the line while loading) reserves its height, so the tile does not change
  // size the instant real data, or "Unavailable", replaces the placeholder.
  const subValue = (text: (current: Totals) => string): ReactNode =>
    loading ? <Skeleton w="16ch" h="0.75rem" /> : totals ? text(totals) : undefined;

  const links: Array<{ title: string; description: string; href: string; icon: LucideIcon }> = [
    { title: "Companies", description: "View and edit customer companies", href: "/super-admin/companies", icon: Building2 },
    { title: "Users", description: "Every user across every tenant", href: "/super-admin/users", icon: Users },
    { title: "Billing", description: "Vehicle based billing configuration", href: "/super-admin/billing", icon: Banknote },
    { title: "Invoices", description: "Generate and track invoices", href: "/super-admin/invoices", icon: FileText },
    { title: "Requests", description: "Triage landing-page leads", href: "/super-admin/requests", icon: Inbox },
  ];

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-3">Platform</div>

          <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
            Super Admin Dashboard
          </h1>

          <p className="m-0 text-sm text-ink-3">
            Platform management, billing and company overview.
          </p>
        </header>

        <MessageBanner tone="danger">{message}</MessageBanner>
        <MessageBanner tone="warning">{capWarning}</MessageBanner>

        {/* Every Skeleton below is aria-hidden by design (components/Skeleton.tsx),
            so without this a screen reader gets silence while the tiles load.
            One line for the whole region, not one per tile: several grey
            rectangles announced individually is worse than a single status. */}
        {loading ? (
          <span className="sr-only" role="status">
            Loading platform figures
          </span>
        ) : null}

        <div className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label="Companies"
            value={tileValue(String(totals?.companies ?? 0))}
            sub={subValue((t) => `${t.activeSubscriptions} with an active subscription`)}
          />

          <Stat
            label="Vehicles"
            value={tileValue(String(totals?.vehicles ?? 0))}
            sub={subValue((t) => `${t.billableVehicles} billable`)}
          />

          {/* Labelled "User profiles", not "Users": this tile counts
              profiles only. /super-admin/users lists profiles PLUS orphaned
              auth accounts (a half-completed invite -- see
              lib/superAdmin/users.ts), so its total can run ahead of this
              one. Adding the orphan count here would need a second query
              this dashboard does not otherwise make; labelling the tile for
              what it actually counts is the honest fix that does not. */}
          <Stat
            label="User profiles"
            value={tileValue(String(totals?.users ?? 0))}
            sub={subValue((t) => `${t.superAdmins} super admins`)}
          />

          <Stat
            label="Collected (28d, inc VAT)"
            value={tileValue(formatPence(totals?.collectedPence ?? 0))}
            sub={subValue((t) => `across ${t.payingCompanies} companies`)}
          />
        </div>

        {totals && (totals.missingSources.length > 0 || totals.zeroRowSources.length > 0) ? (
          <div className="mb-6 grid gap-1">
            {/* Names what could not be counted. A tile that silently
                reported zero for an unapplied migration would be worse than
                the hardcoded placeholder this dashboard replaced: it would
                look authoritative. */}
            {totals.missingSources.length > 0 ? (
              <div className="text-xs font-medium text-warning-strong">
                Collected (28d, inc VAT) excludes {totals.missingSources.join(" and ")}: not
                available on this database.
              </div>
            ) : null}

            {/* FIX 4: a source that returned zero rows is ambiguous between
                "no charges in 28 days" and "cannot read this table" -- a
                policy without a grant reads as an empty table, not as an
                error (docs/sql/billing_06_period_billing.sql:451). This is a
                real hazard here today: billing_06 is unapplied, so a partial
                application can land exactly this state for period_charges.
                No new API route reaches for the service role to
                disambiguate it (that pattern belongs to
                app/super-admin/requests/page.tsx and is out of scope here);
                naming the source instead gives an operator seeing an
                unexpectedly low figure somewhere concrete to check. */}
            {totals.zeroRowSources.length > 0 ? (
              <div className="text-xs font-medium text-ink-3">
                {totals.zeroRowSources.join(" and ")} contributed nothing in the last 28 days. That
                is consistent with no charges, but also with an unreadable table (for example a
                missing GRANT) -- if this figure looks low, check that source&apos;s read access.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="block rounded-lg border border-line bg-surface p-4 no-underline shadow-sm hover:border-primary-tint-border hover:shadow-md"
            >
              <span className="mb-2 block text-ink-3">
                <card.icon size={28} aria-hidden />
              </span>

              <h2 className="m-0 mb-1 text-md font-semibold text-ink">{card.title}</h2>

              <p className="m-0 text-sm text-ink-3">{card.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
