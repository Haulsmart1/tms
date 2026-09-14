"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";
import Stat from "../../../components/Stat";
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";
import { billingModelForRow } from "../../../lib/billing/rateCard";
import { countBillableVehicles } from "../../../lib/billing/vehicleCount";
import { shouldShowSkeleton } from "../../../lib/loading/skeletonVisibility";
import { chunk, fetchAllRows } from "../../../lib/loading/paginate";
import { companyIdFromTenantRow, companyLookupTenantId } from "../../../lib/tenant/companyScope";

type BillingModel = "v1_immediate" | "v2_period";

/* Ids per .in() request. 100 uuids keep the URL well under proxy limits. */
const IDS_PER_REQUEST = 100;

export default function BillingPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [count, setCount] = useState(0);
  const [model, setModel] = useState<BillingModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState("");
  const loadSeqRef = useRef(0);

  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: hasLoaded,
    activeTenantId: tenant.activeTenantId,
    dataTenantId,
  });

  const load = useCallback(async () => {
    if (tenant.status !== "ready") return;

    const seq = ++loadSeqRef.current;
    const requestedTenantId = tenant.activeTenantId;

    setLoading(true);
    setErrorMessage("");

    const finish = (message: string) => {
      if (seq !== loadSeqRef.current) return;
      setErrorMessage(message);
      setLoading(false);
      setHasLoaded(true);
    };

    /* A super admin on "All tenants" spans every company; a per-company
       figure has no meaning there. */
    const lookupTenantId = companyLookupTenantId({
      role: tenant.role,
      activeTenantId: requestedTenantId,
      writeTenantId: tenant.writeTenantId,
      tenants: tenant.tenants,
    });
    if (!lookupTenantId) {
      setCount(0);
      setModel(null);
      finish("Pick a tenant to see its licensed vehicles.");
      return;
    }

    /* SCOPED THROUGH vehicles, NOT through vehicle_licences.tenant_id.
       lib/billing/vehicleCount.ts is the single definition of billable (a
       company vehicle with at least one active licence); this page only
       feeds it. SET-21: every read is paginated, and licences are fetched
       in id chunks rather than one .in() of every vehicle id. */
    const vehiclesResult = await fetchAllRows((from, to) =>
      tenant
        .filterByTenant(supabase.from("vehicles").select("id, tenant_id"))
        .order("id")
        .range(from, to),
    );

    if (vehiclesResult.error || vehiclesResult.truncated) {
      setCount(0);
      finish(vehiclesResult.error ? vehiclesResult.error.message : "Too many vehicles to count here.");
      return;
    }

    const vehicles = (vehiclesResult.data as { id: string; tenant_id: string | null }[]).map((vehicle) => ({
      id: String(vehicle.id),
      tenant_id: vehicle.tenant_id,
    }));

    const licences: { vehicle_id: string; active: boolean | null }[] = [];
    for (const ids of chunk(vehicles.map((vehicle) => vehicle.id), IDS_PER_REQUEST)) {
      const page = await fetchAllRows((from, to) =>
        supabase
          .from("vehicle_licences")
          .select("id, vehicle_id, active")
          .eq("active", true)
          .in("vehicle_id", ids)
          .order("id")
          .range(from, to),
      );
      if (page.error) {
        setCount(0);
        finish(page.error.message);
        return;
      }
      for (const row of page.data as { vehicle_id: string; active: boolean | null }[]) {
        licences.push({ vehicle_id: String(row.vehicle_id), active: row.active });
      }
    }

    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("company_id")
      .eq("id", lookupTenantId)
      .maybeSingle();
    const companyId = companyIdFromTenantRow(tenantRow);

    /* The pricing copy depends on the company's billing model (v1 graduated
       bands versus v2 period billing in arrears); the two must never be
       mixed. Only an admin can read exactly one company_billing row; a
       super admin sees every company's rows, so no model is claimed. */
    let nextModel: BillingModel | null = null;
    if (tenant.role === "admin") {
      const { data: billingRow, error: billingError } = await supabase
        .from("company_billing")
        .select("*")
        .maybeSingle();
      if (!billingError) {
        nextModel = billingModelForRow(billingRow as { billing_model?: string | null } | null);
      }
    }

    if (seq !== loadSeqRef.current) return;

    setCount(
      countBillableVehicles({
        companyId: companyId ?? "",
        companyTenantIds: tenant.tenants.map((option) => option.id),
        vehicles,
        licences,
      }),
    );
    setModel(nextModel);
    setDataTenantId(requestedTenantId);
    setLoading(false);
    setHasLoaded(true);
  }, [supabase, tenant]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId]);

  const scopeText = tenant.activeTenantId
    ? "Licensed vehicles for the selected tenant."
    : "Licensed vehicles across all tenants you can see.";

  const pricingText =
    model === "v1_immediate"
      ? " Priced on the graduated weekly bands."
      : model === "v2_period"
        ? " Billed in arrears when each 28-day period closes; Settings, Billing shows the estimate."
        : "";

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
              {scopeText}
              {pricingText}
            </p>
          </header>

          <MessageBanner tone="danger">{errorMessage}</MessageBanner>

          <div
            aria-busy={showSkeleton || undefined}
            className="grid grid-cols-2 gap-2.5 lg:grid-cols-4"
          >
            {showSkeleton ? (
              <>
                <span className="sr-only" role="status">
                  Loading licensed vehicles
                </span>

                <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <Skeleton w="8ch" h="0.75rem" />
                  <div className="mt-2">
                    <Skeleton w="6ch" h="1.5rem" />
                  </div>
                  <div className="mt-2">
                    <Skeleton w="12ch" h="0.75rem" />
                  </div>
                </div>
              </>
            ) : model === "v1_immediate" ? (
              <Stat
                label="4-Weekly Charge"
                value={formatPence(computeChargeAmounts(count).grossPence)}
                sub={`${count} licensed vehicles here, inc VAT`}
              />
            ) : (
              <Stat
                label="Licensed Vehicles"
                value={String(count)}
                sub="Vehicles with at least one active licence"
              />
            )}
          </div>
        </main>
      </div>
    </TenantGate>
  );
}
