"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import MessageBanner from "../../components/MessageBanner";
import Skeleton from "../../components/Skeleton";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";

type Driver = {
  id: string;
  name: string | null;
  driver_type: string | null;
};

type ActivityLog = {
  id: string;
  activity_type: string | null;
  start_time: string | null;
  duration_minutes: number | null;
};

export default function TachographPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  /* TWO regions, two flags. The driver cards and the activity list read
     different data, and skeletonVisibility is explicit that a flag keyed on
     one region reports "not loading" for the other, which would then render
     its empty state as fact. */
  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [hasLoadedDrivers, setHasLoadedDrivers] = useState(false);
  const [driversTenantId, setDriversTenantId] = useState<string | null | undefined>(undefined);

  const [loadingLogs, setLoadingLogs] = useState(true);
  const [hasLoadedLogs, setHasLoadedLogs] = useState(false);
  const [logsTenantId, setLogsTenantId] = useState<string | null | undefined>(undefined);

  const [errorMessage, setErrorMessage] = useState("");

  const showDriverSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loadingDrivers,
    hasData: hasLoadedDrivers,
    activeTenantId: tenant.activeTenantId,
    dataTenantId: driversTenantId,
  });

  const showLogSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loadingLogs,
    hasData: hasLoadedLogs,
    activeTenantId: tenant.activeTenantId,
    dataTenantId: logsTenantId,
  });

  const loadData = useCallback(async () => {
    if (tenant.status !== "ready") return;

    setLoadingDrivers(true);
    setLoadingLogs(true);
    setErrorMessage("");

    const [driverResult, logResult] = await Promise.all([
      tenant
        .filterByTenant(supabase.from("drivers").select("id, name, driver_type"))
        .order("name", { ascending: true }),
      tenant
        .filterByTenant(
          supabase
            .from("driver_activity_logs")
            .select("id, activity_type, start_time, duration_minutes"),
        )
        .order("start_time", { ascending: false })
        .limit(20),
    ]);

    if (driverResult.error) {
      setErrorMessage(driverResult.error.message);
      setDrivers([]);
    } else {
      setDrivers((driverResult.data as Driver[]) ?? []);
      setDriversTenantId(tenant.activeTenantId);
    }

    if (logResult.error) {
      const logMessage = logResult.error.message;
      setErrorMessage((current) => (current ? `${current} | ${logMessage}` : logMessage));
      setLogs([]);
    } else {
      setLogs((logResult.data as ActivityLog[]) ?? []);
      setLogsTenantId(tenant.activeTenantId);
    }

    setLoadingDrivers(false);
    setHasLoadedDrivers(true);
    setLoadingLogs(false);
    setHasLoadedLogs(true);
  }, [supabase, tenant]);

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId]);

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Compliance</div>

            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Tachograph
            </h1>

            <p className="m-0 text-sm text-ink-3">EU Drivers Hours &amp; WTD compliance</p>
          </header>

          <MessageBanner tone="danger">{errorMessage}</MessageBanner>

          {showDriverSkeleton ? (
            <div aria-busy className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <span className="sr-only" role="status">
                Loading drivers
              </span>

              {[0, 1, 2, 3, 4, 5].map((index) => (
                <article
                  key={`driver-skeleton-${index}`}
                  className="rounded-lg border border-line bg-surface p-4 shadow-sm"
                >
                  <h3 className="mb-1 text-md font-semibold text-ink">
                    <Skeleton display="inline-block" w="10ch" h="1rem" />
                  </h3>

                  <p className="text-sm text-ink-3">
                    <Skeleton display="inline-block" w="6ch" h="0.75rem" />
                  </p>
                </article>
              ))}
            </div>
          ) : drivers.length === 0 ? (
            <div className="mb-6 rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
              No drivers have been added yet.
            </div>
          ) : (
            <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {drivers.map((driver) => (
                <article
                  key={driver.id}
                  className="rounded-lg border border-line bg-surface p-4 shadow-sm"
                >
                  <h3 className="mb-1 text-md font-semibold text-ink">{driver.name}</h3>

                  <p className="text-sm text-ink-3">{driver.driver_type}</p>
                </article>
              ))}
            </div>
          )}

          <h2 className="mb-2 mt-6 text-md font-semibold text-ink">Recent Activity</h2>

          {showLogSkeleton ? (
            <div aria-busy className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <span className="sr-only" role="status">
                Loading recent activity
              </span>

              {[0, 1, 2, 3, 4, 5].map((index) => (
                <ActivityCard key={`log-skeleton-${index}`} loading />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
              No activity has been recorded yet.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {logs.map((log) => (
                <ActivityCard key={log.id} log={log} />
              ))}
            </div>
          )}
        </main>
      </div>
    </TenantGate>
  );
}

function ActivityCard({ log, loading = false }: { log?: ActivityLog; loading?: boolean }) {
  return (
    <article
      aria-busy={loading}
      className="rounded-lg border border-line bg-surface p-4 shadow-sm"
    >
      <strong className="text-sm font-semibold text-ink">
        {loading ? <Skeleton display="inline-block" w="8ch" h="0.875rem" /> : log?.activity_type}
      </strong>

      <p className="font-mono text-sm text-ink-2">
        {loading ? (
          <Skeleton display="inline-block" w="14ch" h="0.75rem" />
        ) : log?.start_time ? (
          new Date(log.start_time).toLocaleString()
        ) : (
          "—"
        )}
      </p>

      <p className="font-mono text-sm text-ink-2">
        {loading ? (
          <Skeleton display="inline-block" w="6ch" h="0.75rem" />
        ) : (
          `${Math.round(log?.duration_minutes || 0)} mins`
        )}
      </p>
    </article>
  );
}
