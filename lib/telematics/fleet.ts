import {
  signalState,
  type PositionReading,
} from "../tracking/position";

export type FleetSignalStatus =
  | "live"
  | "stale"
  | "no_signal";

export type FleetMotionStatus =
  | "moving"
  | "stationary"
  | "unknown";

export type FleetVehicle = {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  driverId: string | null;
  driverName: string | null;
  reading: PositionReading | null;
};

export type FleetVehicleState = FleetVehicle & {
  signalStatus: FleetSignalStatus;
  motionStatus: FleetMotionStatus;
};

export type FleetSummary = {
  total: number;
  live: number;
  moving: number;
  stationary: number;
  stale: number;
  noSignal: number;
};

export function fleetMotionStatus(
  reading: PositionReading | null
): FleetMotionStatus {
  if (!reading) {
    return "unknown";
  }

  if (
    !Number.isFinite(reading.speedKph) ||
    reading.speedKph < 0
  ) {
    return "unknown";
  }

  return reading.speedKph >= 1
    ? "moving"
    : "stationary";
}

export function buildFleetVehicleState(
  vehicle: FleetVehicle,
  now: Date
): FleetVehicleState {
  const rawSignal = signalState(
    vehicle.reading,
    now
  );

  const signalStatus: FleetSignalStatus =
    rawSignal === "none"
      ? "no_signal"
      : rawSignal;

  return {
    ...vehicle,
    signalStatus,
    motionStatus:
      signalStatus === "live"
        ? fleetMotionStatus(vehicle.reading)
        : "unknown",
  };
}

export function summarizeFleet(
  vehicles: FleetVehicleState[]
): FleetSummary {
  return vehicles.reduce<FleetSummary>(
    (summary, vehicle) => {
      summary.total += 1;

      if (vehicle.signalStatus === "live") {
        summary.live += 1;

        if (vehicle.motionStatus === "moving") {
          summary.moving += 1;
        }

        if (
          vehicle.motionStatus ===
          "stationary"
        ) {
          summary.stationary += 1;
        }
      } else if (
        vehicle.signalStatus === "stale"
      ) {
        summary.stale += 1;
      } else {
        summary.noSignal += 1;
      }

      return summary;
    },
    {
      total: 0,
      live: 0,
      moving: 0,
      stationary: 0,
      stale: 0,
      noSignal: 0,
    }
  );
}

export function sortFleetVehicles(
  vehicles: FleetVehicleState[]
): FleetVehicleState[] {
  const signalRank: Record<
    FleetSignalStatus,
    number
  > = {
    live: 0,
    stale: 1,
    no_signal: 2,
  };

  const motionRank: Record<
    FleetMotionStatus,
    number
  > = {
    moving: 0,
    stationary: 1,
    unknown: 2,
  };

  return [...vehicles].sort((a, b) => {
    const signalDelta =
      signalRank[a.signalStatus] -
      signalRank[b.signalStatus];

    if (signalDelta !== 0) {
      return signalDelta;
    }

    const motionDelta =
      motionRank[a.motionStatus] -
      motionRank[b.motionStatus];

    if (motionDelta !== 0) {
      return motionDelta;
    }

    return a.registration.localeCompare(
      b.registration,
      "en-GB",
      {
        sensitivity: "base",
      }
    );
  });
}
