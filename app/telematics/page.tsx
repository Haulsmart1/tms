"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import MessageBanner from "../../components/MessageBanner";
import Skeleton from "../../components/Skeleton";
import {
  pingLabel,
  speedLabel,
  type PositionReading,
} from "../../lib/tracking/position";
import {
  createSupabasePositionSource,
} from "../../lib/tracking/supabasePositions";
import {
  buildFleetVehicleState,
  sortFleetVehicles,
  summarizeFleet,
  type FleetVehicle,
  type FleetVehicleState,
} from "../../lib/telematics/fleet";
import {
  createClient,
} from "../../lib/supabase/browser";
import TenantGate from "../components/TenantGate";
import {
  useTenant,
} from "../components/TenantProvider";
import TelematicsFleetMap from "./TelematicsFleetMap";

const POLL_MS = 30_000;
const HISTORY_LIMIT = 12;

type VehicleRow = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  active: boolean;
};

type DriverRow = {
  id: string;
  name: string;
};

type AssignmentRow = {
  vehicle_id: string | null;
  driver_id: string | null;
};

type HistoryRow = {
  id: string;
  latitude: number | string | null;
  longitude: number | string | null;
  speed: number | string | null;
  heading: number | string | null;
  recorded_at: string | null;
};

function finiteNumber(
  value: unknown
): number | null {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function historyReading(
  vehicleId: string,
  row: HistoryRow
): PositionReading | null {
  const lat = finiteNumber(row.latitude);
  const lng = finiteNumber(row.longitude);
  const speedKph = finiteNumber(row.speed);

  if (
    lat === null ||
    lng === null ||
    speedKph === null ||
    !row.recorded_at
  ) {
    return null;
  }

  const heading =
    row.heading === null
      ? null
      : finiteNumber(row.heading);

  return {
    vehicleId,
    lat,
    lng,
    speedKph,
    headingDeg: heading,
    recordedAt:
      row.recorded_at.endsWith("Z") ||
      /[+-]\d\d:\d\d$/.test(row.recorded_at)
        ? row.recorded_at
        : `${row.recorded_at}Z`,
  };
}

function signalLabel(
  vehicle: FleetVehicleState
): string {
  if (
    vehicle.signalStatus ===
    "no_signal"
  ) {
    return "No signal";
  }

  if (
    vehicle.signalStatus === "stale"
  ) {
    return "Stale";
  }

  if (
    vehicle.motionStatus === "moving"
  ) {
    return "Moving";
  }

  if (
    vehicle.motionStatus ===
    "stationary"
  ) {
    return "Stationary";
  }

  return "Live";
}

function headingLabel(
  heading: number | null
): string {
  if (
    heading === null ||
    !Number.isFinite(heading)
  ) {
    return "?";
  }

  const normalized =
    ((heading % 360) + 360) % 360;

  return `${Math.round(normalized)}?`;
}

export default function TelematicsPage() {
  const supabase =
    useMemo(() => createClient(), []);

  const tenant = useTenant();

  const [fleet, setFleet] =
    useState<FleetVehicleState[]>([]);

  const [
    selectedVehicleId,
    setSelectedVehicleId,
  ] = useState<string | null>(null);

  const [history, setHistory] =
    useState<PositionReading[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [
    refreshFailed,
    setRefreshFailed,
  ] = useState(false);

  const [
    lastLoadedAt,
    setLastLoadedAt,
  ] = useState<Date | null>(null);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  const loadFleet =
    useCallback(
      async (
        showLoading: boolean
      ) => {
        if (
          tenant.status !== "ready"
        ) {
          return;
        }

        if (showLoading) {
          setLoading(true);
        }

        try {
          const now = new Date();

          const [
            vehiclesResult,
            assignmentsResult,
            driversResult,
          ] = await Promise.all([
            tenant
              .filterByTenant(
                supabase
                  .from("vehicles")
                  .select(
                    "id, registration, make, model, active"
                  )
              )
              .eq("active", true)
              .order(
                "registration",
                {
                  ascending: true,
                }
              ),

            tenant
              .filterByTenant(
                supabase
                  .from(
                    "vehicle_assignments"
                  )
                  .select(
                    "vehicle_id, driver_id"
                  )
              )
              .eq("active", true),

            tenant
              .filterByTenant(
                supabase
                  .from("drivers")
                  .select("id, name")
              )
              .eq("active", true)
              .order("name"),
          ]);

          if (vehiclesResult.error) {
            throw vehiclesResult.error;
          }

          if (
            assignmentsResult.error
          ) {
            throw assignmentsResult.error;
          }

          if (driversResult.error) {
            throw driversResult.error;
          }

          const vehicles =
            (vehiclesResult.data ??
              []) as VehicleRow[];

          const assignments =
            (assignmentsResult.data ??
              []) as AssignmentRow[];

          const drivers =
            (driversResult.data ??
              []) as DriverRow[];

          const driverById =
            new Map(
              drivers.map(
                (driver) => [
                  driver.id,
                  driver.name,
                ]
              )
            );

          const assignmentByVehicle =
            new Map<
              string,
              string
            >();

          for (
            const assignment of assignments
          ) {
            if (
              assignment.vehicle_id &&
              assignment.driver_id
            ) {
              assignmentByVehicle.set(
                assignment.vehicle_id,
                assignment.driver_id
              );
            }
          }

          const vehicleIds =
            vehicles.map(
              (vehicle) =>
                vehicle.id
            );

          const source =
            createSupabasePositionSource(
              supabase,
              tenant
            );

          const positions =
            await source.getPositions(
              vehicleIds
            );

          const nextFleet =
            sortFleetVehicles(
              vehicles.map(
                (
                  vehicle
                ): FleetVehicleState => {
                  const driverId =
                    assignmentByVehicle.get(
                      vehicle.id
                    ) ?? null;

                  const base:
                    FleetVehicle = {
                      id: vehicle.id,
                      registration:
                        vehicle.registration,
                      make: vehicle.make,
                      model: vehicle.model,
                      driverId,
                      driverName:
                        driverId
                          ? (
                              driverById.get(
                                driverId
                              ) ?? null
                            )
                          : null,
                      reading:
                        positions.get(
                          vehicle.id
                        ) ?? null,
                    };

                  return buildFleetVehicleState(
                    base,
                    now
                  );
                }
              )
            );

          setFleet(nextFleet);

          setSelectedVehicleId(
            (current) => {
              if (
                current &&
                nextFleet.some(
                  (vehicle) =>
                    vehicle.id === current
                )
              ) {
                return current;
              }

              return (
                nextFleet[0]?.id ??
                null
              );
            }
          );

          setRefreshFailed(false);
          setErrorMessage("");
          setLastLoadedAt(now);
        } catch (error) {
          setRefreshFailed(true);

          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to load telematics."
          );
        } finally {
          setLoading(false);
        }
      },
      [supabase, tenant]
    );

  useEffect(() => {
    if (
      tenant.status !== "ready"
    ) {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    async function refresh(
      initial: boolean
    ) {
      if (
        cancelled ||
        inFlight
      ) {
        return;
      }

      inFlight = true;

      try {
        await loadFleet(initial);
      } finally {
        inFlight = false;
      }
    }

    void refresh(true);

    const timer = setInterval(
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          void refresh(false);
        }
      },
      POLL_MS
    );

    function onVisibility() {
      if (
        document.visibilityState ===
        "visible"
      ) {
        void refresh(false);
      }
    }

    document.addEventListener(
      "visibilitychange",
      onVisibility
    );

    return () => {
      cancelled = true;
      clearInterval(timer);

      document.removeEventListener(
        "visibilitychange",
        onVisibility
      );
    };
  }, [
    tenant.status,
    tenant.activeTenantId,
    loadFleet,
  ]);

  useEffect(() => {
    if (
      tenant.status !== "ready" ||
      !selectedVehicleId
    ) {
      setHistory([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      const { data, error } =
        await tenant
          .filterByTenant(
            supabase
              .from(
                "telematics_positions"
              )
              .select(
                "id, latitude, longitude, speed, heading, recorded_at"
              )
          )
          .eq(
            "vehicle_id",
            selectedVehicleId
          )
          .order(
            "recorded_at",
            {
              ascending: false,
            }
          )
          .limit(HISTORY_LIMIT);

      if (cancelled) {
        return;
      }

      if (error) {
        setHistory([]);
        return;
      }

      setHistory(
        (
          (data ?? []) as HistoryRow[]
        )
          .map((row) =>
            historyReading(
              selectedVehicleId,
              row
            )
          )
          .filter(
            (
              reading
            ): reading is PositionReading =>
              reading !== null
          )
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [
    supabase,
    tenant.status,
    tenant.activeTenantId,
    selectedVehicleId,
  ]);

  const summary =
    useMemo(
      () =>
        summarizeFleet(fleet),
      [fleet]
    );

  const selected =
    useMemo(
      () =>
        fleet.find(
          (vehicle) =>
            vehicle.id ===
            selectedVehicleId
        ) ??
        fleet[0] ??
        null,
      [
        fleet,
        selectedVehicleId,
      ]
    );

  const now =
    lastLoadedAt ??
    new Date();

  return (
    <TenantGate>
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
          <header className="mb-5">
            <div className="text-kicker uppercase text-ink-3">
              Fleet Operations
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">
                  Telematics
                </h1>

                <p className="m-0 text-sm text-ink-3">
                  Live vehicle positions,
                  movement and signal
                  health
                </p>
              </div>

              <div className="text-xs text-ink-3">
                Auto-refresh 30 s
                {lastLoadedAt
                  ? ` ? updated ${lastLoadedAt.toLocaleTimeString(
                      "en-GB",
                      {
                        hour:
                          "2-digit",
                        minute:
                          "2-digit",
                      }
                    )}`
                  : ""}
                {refreshFailed
                  ? " ? refresh failed, showing last known data"
                  : ""}
              </div>
            </div>
          </header>

          <MessageBanner tone="danger">
            {errorMessage}
          </MessageBanner>

          {loading &&
          fleet.length === 0 ? (
            <TelematicsSkeleton />
          ) : (
            <>
              <section
                aria-label="Fleet summary"
                className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
              >
                <SummaryTile
                  label="Fleet"
                  value={summary.total}
                />
                <SummaryTile
                  label="Live"
                  value={summary.live}
                />
                <SummaryTile
                  label="Moving"
                  value={summary.moving}
                />
                <SummaryTile
                  label="Stationary"
                  value={summary.stationary}
                />
                <SummaryTile
                  label="Stale"
                  value={summary.stale}
                />
                <SummaryTile
                  label="No signal"
                  value={summary.noSignal}
                />
              </section>

              {fleet.length === 0 ? (
                <div className="rounded-lg border border-line bg-surface p-8 text-center shadow-sm">
                  <p className="m-0 text-sm font-semibold text-ink">
                    No active vehicles
                  </p>

                  <p className="mb-0 mt-1 text-sm text-ink-3">
                    Active fleet vehicles
                    will appear here.
                  </p>
                </div>
              ) : (
                <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                  <aside className="grid max-h-[720px] gap-2 overflow-y-auto pr-1">
                    {fleet.map(
                      (vehicle) => (
                        <VehicleRailCard
                          key={vehicle.id}
                          vehicle={vehicle}
                          selected={
                            vehicle.id ===
                            selected?.id
                          }
                          now={now}
                          onSelect={
                            setSelectedVehicleId
                          }
                        />
                      )
                    )}
                  </aside>

                  <div className="grid min-w-0 gap-4">
                    <TelematicsFleetMap
                      vehicles={fleet}
                      selectedVehicleId={
                        selected?.id ??
                        null
                      }
                      onSelect={
                        setSelectedVehicleId
                      }
                    />

                    {selected ? (
                      <VehicleDetail
                        vehicle={selected}
                        history={history}
                        now={now}
                      />
                    ) : null}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </TenantGate>
  );
}

function SummaryTile({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">
        {label}
      </div>

      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">
        {value}
      </div>
    </div>
  );
}

function VehicleRailCard({
  vehicle,
  selected,
  now,
  onSelect,
}: {
  vehicle: FleetVehicleState;
  selected: boolean;
  now: Date;
  onSelect: (
    vehicleId: string
  ) => void;
}) {
  const speed =
    vehicle.reading &&
    vehicle.signalStatus === "live"
      ? (
          speedLabel(
            vehicle.reading
          ) ?? "Speed unknown"
        )
      : null;

  return (
    <button
      type="button"
      onClick={() =>
        onSelect(vehicle.id)
      }
      className={[
        "w-full rounded-lg border bg-surface p-3 text-left shadow-sm transition",
        selected
          ? "border-ink"
          : "border-line hover:border-line-strong hover:bg-surface-hover",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-sm font-semibold text-ink">
            {vehicle.registration}
          </div>

          <div className="mt-0.5 text-xs text-ink-3">
            {[
              vehicle.make,
              vehicle.model,
            ]
              .filter(Boolean)
              .join(" ") ||
              "Vehicle"}
          </div>
        </div>

        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-2">
          {signalLabel(vehicle)}
        </span>
      </div>

      <div className="mt-3 grid gap-1 text-xs text-ink-2">
        <div>
          Driver:{" "}
          {vehicle.driverName ??
            "Unassigned"}
        </div>

        <div>
          {speed ??
            (vehicle.reading
              ? pingLabel(
                  vehicle.reading,
                  now
                )
              : "No position reported")}
        </div>
      </div>
    </button>
  );
}

function VehicleDetail({
  vehicle,
  history,
  now,
}: {
  vehicle: FleetVehicleState;
  history: PositionReading[];
  now: Date;
}) {
  const reading =
    vehicle.reading;

  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-3">
            Selected vehicle
          </div>

          <h2 className="mb-0 mt-1 font-mono text-lg font-semibold text-ink">
            {vehicle.registration}
          </h2>

          <p className="mb-0 mt-1 text-sm text-ink-2">
            {vehicle.driverName
              ? `Driver: ${vehicle.driverName}`
              : "No active driver assignment"}
          </p>
        </div>

        <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink">
          {signalLabel(vehicle)}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <DetailTile
          label="Speed"
          value={
            reading &&
            vehicle.signalStatus === "live"
              ? (
                  speedLabel(
                    reading
                  ) ?? "Unknown"
                )
              : "?"
          }
        />

        <DetailTile
          label="Heading"
          value={
            reading
              ? headingLabel(
                  reading.headingDeg
                )
              : "?"
          }
        />

        <DetailTile
          label="Last ping"
          value={
            reading
              ? pingLabel(
                  reading,
                  now
                )
              : "No signal"
          }
        />

        <DetailTile
          label="Position"
          value={
            reading
              ? `${reading.lat.toFixed(
                  5
                )}, ${reading.lng.toFixed(
                  5
                )}`
              : "?"
          }
        />
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-semibold text-ink">
            Recent GPS positions
          </h3>

          <span className="text-xs text-ink-3">
            Latest {HISTORY_LIMIT}
          </span>
        </div>

        {history.length === 0 ? (
          <div className="rounded-md bg-surface-2 p-4 text-sm text-ink-3">
            No recent telematics
            history is available for
            this vehicle.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-surface-2 text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-semibold">
                    Time
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    Speed
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    Heading
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    Position
                  </th>
                </tr>
              </thead>

              <tbody>
                {history.map(
                  (
                    item,
                    index
                  ) => (
                    <tr
                      key={`${item.recordedAt}-${index}`}
                      className="border-t border-line"
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-ink-2">
                        {new Date(
                          item.recordedAt
                        ).toLocaleString(
                          "en-GB"
                        )}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2 text-ink-2">
                        {speedLabel(
                          item
                        ) ??
                          "Unknown"}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2 text-ink-2">
                        {headingLabel(
                          item.headingDeg
                        )}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2 font-mono text-ink-2">
                        {item.lat.toFixed(5)}
                        ,{" "}
                        {item.lng.toFixed(5)}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function DetailTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md bg-surface-2 p-3">
      <div className="text-xs text-ink-3">
        {label}
      </div>

      <div className="mt-1 break-words text-sm font-semibold text-ink">
        {value}
      </div>
    </div>
  );
}

function TelematicsSkeleton() {
  return (
    <div aria-busy>
      <span
        className="sr-only"
        role="status"
      >
        Loading fleet telematics
      </span>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map(
          (index) => (
            <div
              key={index}
              className="rounded-lg border border-line bg-surface p-4 shadow-sm"
            >
              <Skeleton
                w="7ch"
                h="0.7rem"
              />

              <div className="mt-2">
                <Skeleton
                  w="3ch"
                  h="1.6rem"
                />
              </div>
            </div>
          )
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="grid gap-2">
          {[0, 1, 2, 3].map(
            (index) => (
              <div
                key={index}
                className="rounded-lg border border-line bg-surface p-4 shadow-sm"
              >
                <Skeleton
                  w="10ch"
                  h="0.9rem"
                />

                <div className="mt-3">
                  <Skeleton
                    w="18ch"
                    h="0.7rem"
                  />
                </div>
              </div>
            )
          )}
        </div>

        <div className="rounded-lg border border-line bg-surface p-2 shadow-sm">
          <Skeleton
            w="100%"
            h="28rem"
          />
        </div>
      </div>
    </div>
  );
}
