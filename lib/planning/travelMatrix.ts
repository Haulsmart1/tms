import type { LatLng } from "./types";

export type TravelMatrixLocation = {
  id: string;
  point: LatLng;
};

export type TravelCostLoader = (
  origins: LatLng[],
  destinations: LatLng[],
) => Promise<number[][] | null>;

export type DriverTravelMatrix = {
  travelSecondsBetween: (
    fromLocationId: string,
    toLocationId: string,
  ) => number | null;
};

const MATRIX_CHUNK_SIZE = 10;

type PhysicalLocation = {
  key: string;
  point: LatLng;
};

function pointKey(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

function validPoint(point: LatLng): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng)
  );
}

function validTravelSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function physicalLocations(
  locations: TravelMatrixLocation[],
): PhysicalLocation[] {
  const physical = new Map<string, PhysicalLocation>();

  for (const location of locations) {
    const key = pointKey(location.point);

    if (!physical.has(key)) {
      physical.set(key, {
        key,
        point: {
          lat: location.point.lat,
          lng: location.point.lng,
        },
      });
    }
  }

  return [...physical.values()];
}

export async function buildDriverTravelMatrix(
  locations: TravelMatrixLocation[],
  loadCosts: TravelCostLoader,
): Promise<DriverTravelMatrix | null> {
  if (typeof loadCosts !== "function") {
    return null;
  }

  const idToPhysicalKey = new Map<string, string>();

  for (const location of locations) {
    if (
      typeof location.id !== "string" ||
      location.id.length === 0 ||
      idToPhysicalKey.has(location.id) ||
      !validPoint(location.point)
    ) {
      return null;
    }

    idToPhysicalKey.set(
      location.id,
      pointKey(location.point),
    );
  }

  const physical = physicalLocations(locations);
  const costs = new Map<string, Map<string, number>>();

  for (const location of physical) {
    costs.set(
      location.key,
      new Map([[location.key, 0]]),
    );
  }

  for (
    let originOffset = 0;
    originOffset < physical.length;
    originOffset += MATRIX_CHUNK_SIZE
  ) {
    const origins = physical.slice(
      originOffset,
      originOffset + MATRIX_CHUNK_SIZE,
    );

    for (
      let destinationOffset = 0;
      destinationOffset < physical.length;
      destinationOffset += MATRIX_CHUNK_SIZE
    ) {
      const destinations = physical.slice(
        destinationOffset,
        destinationOffset + MATRIX_CHUNK_SIZE,
      );

      let matrix: number[][] | null;

      try {
        matrix = await loadCosts(
          origins.map((location) => ({ ...location.point })),
          destinations.map((location) => ({ ...location.point })),
        );
      } catch {
        return null;
      }

      if (
        !matrix ||
        matrix.length !== origins.length
      ) {
        return null;
      }

      for (
        let originIndex = 0;
        originIndex < origins.length;
        originIndex++
      ) {
        const row = matrix[originIndex];

        if (
          !Array.isArray(row) ||
          row.length !== destinations.length
        ) {
          return null;
        }

        const origin = origins[originIndex];
        const originCosts = costs.get(origin.key);

        if (!originCosts) {
          return null;
        }

        for (
          let destinationIndex = 0;
          destinationIndex < destinations.length;
          destinationIndex++
        ) {
          const destination = destinations[destinationIndex];

          if (origin.key === destination.key) {
            originCosts.set(destination.key, 0);
            continue;
          }

          const value = row[destinationIndex];

          if (!validTravelSeconds(value)) {
            return null;
          }

          originCosts.set(destination.key, value);
        }
      }
    }
  }

  return {
    travelSecondsBetween(
      fromLocationId: string,
      toLocationId: string,
    ): number | null {
      const fromKey = idToPhysicalKey.get(fromLocationId);
      const toKey = idToPhysicalKey.get(toLocationId);

      if (fromKey === undefined || toKey === undefined) {
        return null;
      }

      if (fromKey === toKey) {
        return 0;
      }

      return costs.get(fromKey)?.get(toKey) ?? null;
    },
  };
}
