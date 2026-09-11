import type { LatLng } from "./types";

type FastPlotCostLoader = (
  origins: LatLng[],
  destinations: LatLng[]
) => Promise<number[][] | null>;

const MATRIX_CACHE_LIMIT = 256;
const ROUTE_CACHE_LIMIT = 256;

const matrixCache = new Map<string, number[][]>();
const matrixInflight = new Map<
  string,
  Promise<number[][] | null>
>();

const routeCache = new Map<string, number>();
const routeInflight = new Map<
  string,
  Promise<number | null>
>();

function remember<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  limit: number
): void {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);

  while (cache.size > limit) {
    const oldest = cache.keys().next().value as K | undefined;

    if (oldest === undefined) {
      break;
    }

    cache.delete(oldest);
  }
}

function cloneMatrix(matrix: number[][]): number[][] {
  return matrix.map((row) => [...row]);
}

function pointKey(point: LatLng): string {
  return `${point.lat},${point.lng}`;
}

function matrixKey(
  origins: LatLng[],
  destinations: LatLng[]
): string {
  return JSON.stringify({
    origins,
    destinations,
  });
}

function routeKey(
  from: LatLng,
  to: LatLng
): string {
  return `${pointKey(from)}->${pointKey(to)}`;
}

/**
 * Matrix is reserved for Smart Optimize candidate comparison.
 *
 * Successful identical requests are cached and concurrent identical requests
 * share one fetch. Failed requests are deliberately not cached so a temporary
 * upstream problem does not poison the session.
 */
export async function loadCachedFastPlotCosts(
  origins: LatLng[],
  destinations: LatLng[]
): Promise<number[][] | null> {
  if (
    origins.length < 1 ||
    destinations.length < 1 ||
    origins.length * destinations.length > 100
  ) {
    return null;
  }

  const key = matrixKey(
    origins,
    destinations
  );

  const cached = matrixCache.get(key);

  if (cached) {
    return cloneMatrix(cached);
  }

  const existing = matrixInflight.get(key);

  if (existing) {
    const result = await existing;

    return result
      ? cloneMatrix(result)
      : null;
  }

  const request = (async (): Promise<number[][] | null> => {
    try {
      const response = await fetch(
        "/api/tomtom/matrix",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            origins,
            destinations,
          }),
        }
      );

      if (!response.ok) {
        return null;
      }

      const body = await response.json();
      const raw = body?.travelSeconds;

      if (
        !Array.isArray(raw) ||
        raw.length !== origins.length ||
        raw.some(
          (row: unknown) =>
            !Array.isArray(row) ||
            row.length !== destinations.length
        )
      ) {
        return null;
      }

      const parsed = raw.map(
        (row: unknown[]) =>
          row.map((value) =>
            typeof value === "number" &&
            Number.isFinite(value) &&
            value >= 0
              ? value
              : Number.POSITIVE_INFINITY
          )
      );

      remember(
        matrixCache,
        key,
        parsed,
        MATRIX_CACHE_LIMIT
      );

      return parsed;
    } catch {
      return null;
    }
  })();

  matrixInflight.set(key, request);

  try {
    const result = await request;

    return result
      ? cloneMatrix(result)
      : null;
  } finally {
    matrixInflight.delete(key);
  }
}

/**
 * Creates a per-Smart-Optimize hard ceiling.
 *
 * The counter is intentionally based on loader invocations rather than only
 * network misses. That makes the ceiling conservative: cache hits can never
 * accidentally allow additional paid Matrix requests.
 */
export function createBudgetedFastPlotCostLoader(
  maxCalls: number,
  loader: FastPlotCostLoader =
    loadCachedFastPlotCosts
): FastPlotCostLoader {
  if (
    !Number.isInteger(maxCalls) ||
    maxCalls < 0
  ) {
    throw new Error(
      "Matrix request budget must be a non-negative integer."
    );
  }

  let calls = 0;

  return async (
    origins,
    destinations
  ): Promise<number[][] | null> => {
    if (calls >= maxCalls) {
      return null;
    }

    calls += 1;

    return loader(
      origins,
      destinations
    );
  };
}

/**
 * A single A -> B lookup belongs on ordinary Routing, not Matrix.
 *
 * This is used by the driver-hours preview for van -> canonical Drop 1.
 */
export async function loadPointToPointTravelSeconds(
  from: LatLng,
  to: LatLng
): Promise<number | null> {
  if (
    !Number.isFinite(from.lat) ||
    !Number.isFinite(from.lng) ||
    !Number.isFinite(to.lat) ||
    !Number.isFinite(to.lng)
  ) {
    return null;
  }

  if (
    from.lat === to.lat &&
    from.lng === to.lng
  ) {
    return 0;
  }

  const key = routeKey(from, to);
  const cached = routeCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const existing = routeInflight.get(key);

  if (existing) {
    return existing;
  }

  const request = (async (): Promise<number | null> => {
    try {
      const response = await fetch(
        "/api/tomtom/route",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            points: [from, to],
          }),
        }
      );

      if (!response.ok) {
        return null;
      }

      const body = await response.json();
      const seconds =
        body?.totalTravelTimeSeconds;

      if (
        typeof seconds !== "number" ||
        !Number.isFinite(seconds) ||
        seconds < 0
      ) {
        return null;
      }

      remember(
        routeCache,
        key,
        seconds,
        ROUTE_CACHE_LIMIT
      );

      return seconds;
    } catch {
      return null;
    }
  })();

  routeInflight.set(key, request);

  try {
    return await request;
  } finally {
    routeInflight.delete(key);
  }
}

export function clearTomTomCostCachesForTests(): void {
  matrixCache.clear();
  matrixInflight.clear();
  routeCache.clear();
  routeInflight.clear();
}
