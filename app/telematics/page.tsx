"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import MessageBanner from "../../components/MessageBanner";
import Skeleton from "../../components/Skeleton";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";

type Position = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  recorded_at: string | null;
};

export default function TelematicsPage() {
  const supabase = useMemo(() => createClient(), []);
  const tenant = useTenant();

  const [positions, setPositions] = useState<Position[]>([]);
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

  const loadPositions = useCallback(async () => {
    if (tenant.status !== "ready") return;

    setLoading(true);
    setErrorMessage("");

    /* telematics_positions is writes_closed in rls_03: the feed owns the rows,
       the console only reads them. filterByTenant is defence in depth on top of
       that policy, and it is also what makes the admin tenant selector mean
       something on this page. */
    const { data, error } = await tenant
      .filterByTenant(
        supabase
          .from("telematics_positions")
          .select("id, latitude, longitude, speed, recorded_at"),
      )
      .order("recorded_at", { ascending: false })
      .limit(20);

    if (error) {
      setErrorMessage(error.message);
      setPositions([]);
    } else {
      setPositions((data as Position[]) ?? []);
      setDataTenantId(tenant.activeTenantId);
    }

    setLoading(false);
    setHasLoaded(true);
  }, [supabase, tenant]);

  useEffect(() => {
    void loadPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId]);

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-4">
            <div className="text-kicker uppercase text-ink-3">Compliance</div>

            <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
              Telematics
            </h1>

            <p className="m-0 text-sm text-ink-3">
              Vehicle GPS tracking and performance data
            </p>
          </header>

          <MessageBanner tone="danger">{errorMessage}</MessageBanner>

          {showSkeleton ? (
            <div aria-busy className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <span className="sr-only" role="status">
                Loading vehicle positions
              </span>

              {[0, 1, 2, 3, 4, 5].map((index) => (
                <PositionCard key={`position-skeleton-${index}`} loading />
              ))}
            </div>
          ) : positions.length === 0 ? (
            <div className="rounded-lg bg-surface-2 p-8 text-center text-sm text-ink-3">
              No vehicle positions have been received yet.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {positions.map((position) => (
                <PositionCard key={position.id} position={position} />
              ))}
            </div>
          )}
        </main>
      </div>
    </TenantGate>
  );
}

/* One layout definition for both states, the AssetCard/CustomerCard contract.
   The four labels carry no data, so they render for real in both. */
function PositionCard({
  position,
  loading = false,
}: {
  position?: Position;
  loading?: boolean;
}) {
  return (
    <article
      aria-busy={loading}
      className="rounded-lg border border-line bg-surface p-4 shadow-sm"
    >
      <strong className="text-sm font-semibold text-ink">Vehicle Position</strong>

      <p className="font-mono text-sm text-ink-2">
        Latitude:{" "}
        {loading ? (
          <Skeleton display="inline-block" w="7ch" h="0.75rem" />
        ) : (
          (position?.latitude ?? "—")
        )}
      </p>

      <p className="font-mono text-sm text-ink-2">
        Longitude:{" "}
        {loading ? (
          <Skeleton display="inline-block" w="7ch" h="0.75rem" />
        ) : (
          (position?.longitude ?? "—")
        )}
      </p>

      <p className="font-mono text-sm text-ink-2">
        Speed:{" "}
        {loading ? (
          <Skeleton display="inline-block" w="5ch" h="0.75rem" />
        ) : (
          `${position?.speed ?? "—"} km/h`
        )}
      </p>

      <p className="font-mono text-sm text-ink-2">
        {loading ? (
          <Skeleton display="inline-block" w="14ch" h="0.75rem" />
        ) : position?.recorded_at ? (
          new Date(position.recorded_at).toLocaleString()
        ) : (
          "—"
        )}
      </p>
    </article>
  );
}
