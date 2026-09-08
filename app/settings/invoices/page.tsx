"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";
import Skeleton from "../../../components/Skeleton";
import Stat from "../../../components/Stat";
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";
import { shouldShowSkeleton } from "../../../lib/loading/skeletonVisibility";

export default function BillingPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState("");

  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: hasLoaded,
    activeTenantId: tenant.activeTenantId,
    dataTenantId,
  });

  const load = useCallback(async () => {
    if (tenant.status !== "ready") return;

    setLoading(true);
    setErrorMessage("");

    /* SCOPED THROUGH vehicles, NOT through vehicle_licences.tenant_id.
       billing_03 is explicit that countBillableVehicles reads vehicles.tenant_id
       and never the licence's own tenant_id; filtering the licence table here
       would introduce a second, quietly different billable rule, which is the
       one thing CLAUDE.md forbids around this number. So: take the vehicles the
       active tenant owns, then keep those with at least one active licence. */
    const { data: vehicles, error: vehicleError } = await tenant.filterByTenant(
      supabase.from("vehicles").select("id"),
    );

    if (vehicleError) {
      setErrorMessage(vehicleError.message);
      setCount(0);
      setLoading(false);
      setHasLoaded(true);
      return;
    }

    const vehicleIds = (vehicles ?? []).map((vehicle) => String(vehicle.id));

    if (vehicleIds.length === 0) {
      setCount(0);
      setDataTenantId(tenant.activeTenantId);
      setLoading(false);
      setHasLoaded(true);
      return;
    }

    const { data: licences, error: licenceError } = await supabase
      .from("vehicle_licences")
      .select("vehicle_id")
      .eq("active", true)
      .in("vehicle_id", vehicleIds);

    if (licenceError) {
      setErrorMessage(licenceError.message);
      setCount(0);
    } else {
      setCount(new Set((licences ?? []).map((licence) => licence.vehicle_id)).size);
      setDataTenantId(tenant.activeTenantId);
    }

    setLoading(false);
    setHasLoaded(true);
  }, [supabase, tenant]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId]);

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
              {tenant.activeTenantId
                ? "Licensed vehicles for the selected tenant, priced on the graduated weekly bands."
                : "Licensed vehicles across all tenants you can see, priced on the graduated weekly bands."}
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
                  Loading the 4-weekly charge
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
            ) : (
              <Stat
                label="4-Weekly Charge"
                value={formatPence(computeChargeAmounts(count).grossPence)}
                sub={`${count} licensed vehicles here, inc VAT`}
              />
            )}
          </div>
        </main>
      </div>
    </TenantGate>
  );
}
