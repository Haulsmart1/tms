"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Truck, Users, Banknote, FileText, Inbox, type LucideIcon } from "lucide-react";
import { createClient } from "../../lib/supabase/browser";
import { collectedRevenue, isMissingRelationError, type ChargeSource } from "../../lib/superAdmin/summary";
/* format, not money: formatPence is pure presentation. lib/billing/money.ts is
   v1's graduated weekly pricing and must never be applied to a v2 company, so
   importing from it on a page that sums BOTH models would be a standing
   invitation to reach for computeChargeAmounts next. */
import { formatPence } from "../../lib/billing/format";
import { extractRoleName } from "../../lib/roles";
import Stat from "../../components/Stat";
import MessageBanner from "../../components/MessageBanner";
import Skeleton from "../../components/Skeleton";

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
};

export default function SuperAdminPage() {
  const supabase = createClient();

  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  /* Each charge source is read on its own and allowed to fail on its own.
     Several billing_0* migrations are written but not applied on this project,
     so a table that does not exist yet must reduce the tile to "what I could
     count, and what I could not", never to a confident zero. */
  const loadChargeSource = useCallback(
    async (table: string, key: ChargeSource["key"], label: string): Promise<ChargeSource> => {
      const { data, error } = await supabase
        .from(table)
        .select("company_id, gross_pence, status, created_at");

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

    try {
      const [
        companyCount,
        billingRows,
        vehicleRows,
        licenceRows,
        userCount,
        superAdminRows,
        v1Cycle,
        v1Addon,
        v2Period,
      ] = await Promise.all([
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("company_billing").select("company_id, status"),
        // No company_id on vehicles; selecting one fails with 42703.
        supabase.from("vehicles").select("id, tenant_id"),
        supabase.from("vehicle_licences").select("vehicle_id, active"),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id, roles ( name )"),
        loadChargeSource("platform_charges", "v1_cycle", "v1 cycles"),
        loadChargeSource("vehicle_addon_charges", "v1_addon", "v1 mid-cycle additions"),
        loadChargeSource("period_charges", "v2_period", "v2 periods"),
      ]);

      if (companyCount.error) throw companyCount.error;
      if (vehicleRows.error) throw vehicleRows.error;
      if (licenceRows.error) throw licenceRows.error;
      if (userCount.error) throw userCount.error;

      const vehicles = (vehicleRows.data ?? []) as { id: string; tenant_id: string | null }[];
      const licences = (licenceRows.data ?? []) as { vehicle_id: string; active: boolean | null }[];

      /* Platform-wide billable count. Not a per-company sum: the caller wants
         "how many vehicles on the platform are billable", and a vehicle with
         two active compliance licences is still one vehicle. */
      const activeVehicleIds = new Set(
        licences.filter((l) => l.active).map((l) => l.vehicle_id),
      );
      const billableVehicles = vehicles.filter((v) => activeVehicleIds.has(v.id)).length;

      const revenue = collectedRevenue([v1Cycle, v1Addon, v2Period], new Date());

      const superAdmins = ((superAdminRows.data ?? []) as { roles: unknown }[]).filter(
        (row) => extractRoleName(row.roles) === "super_admin",
      ).length;

      const activeSubscriptions = ((billingRows.data ?? []) as { status: string | null }[]).filter(
        (row) => row.status === "active",
      ).length;

      setTotals({
        companies: companyCount.count ?? 0,
        activeSubscriptions,
        vehicles: vehicles.length,
        billableVehicles,
        users: userCount.count ?? 0,
        superAdmins,
        collectedPence: revenue.totalPence,
        payingCompanies: revenue.companyCount,
        missingSources: revenue.missingSources,
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

  // Only ever renders a Skeleton while loading; never a bare "0" before the
  // first fetch resolves, which would read as a confident (and wrong) figure.
  const tileValue = (value: string) => (loading ? <Skeleton w="5ch" h="1.5rem" /> : value);

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

        <div className="mb-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat
            label="Companies"
            value={tileValue(String(totals?.companies ?? 0))}
            sub={totals ? `${totals.activeSubscriptions} with an active subscription` : undefined}
          />

          <Stat
            label="Vehicles"
            value={tileValue(String(totals?.vehicles ?? 0))}
            sub={totals ? `${totals.billableVehicles} billable` : undefined}
          />

          <Stat
            label="Users"
            value={tileValue(String(totals?.users ?? 0))}
            sub={totals ? `${totals.superAdmins} super admins` : undefined}
          />

          <Stat
            label="Collected (28d)"
            value={tileValue(formatPence(totals?.collectedPence ?? 0))}
            sub={totals ? `across ${totals.payingCompanies} companies` : undefined}
          />
        </div>

        {/* Names what could not be counted. A tile that silently reported zero
            for an unapplied migration would be worse than the hardcoded
            placeholder this dashboard replaced: it would look authoritative. */}
        {totals && totals.missingSources.length > 0 ? (
          <div className="mb-6 text-xs font-medium text-warning-strong">
            Collected (28d) excludes {totals.missingSources.join(" and ")}: not available on this
            database.
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
