import type { SupabaseClient } from "@supabase/supabase-js";

import { normaliseTimestamp, type PositionReading, type PositionSource } from "./position";

/* The only implementation of PositionSource that exists today.

   Positions are real data now: app/api/driver/location writes driver phone GPS
   into telematics_positions (review PLAN-14). vehicle_locations is the legacy
   table and may still hold fixes for some vehicles.

   Budget is PER VEHICLE, never fleet-wide. The old read took
   `vehicleIds.length * 5` rows across the whole fleet ordered by time, so one
   phone posting every few seconds filled the budget and every other vehicle
   showed "No GPS" (and Smart Optimize refused to run for it). Now:
     1. latest_telematics_positions / latest_vehicle_locations
        (docs/sql/prodfix_72_latest_positions.sql) return exactly the newest
        row per vehicle with DISTINCT ON;
     2. until that SQL is applied, each vehicle gets its own limit-1 query;
     3. both tables are always read and merged per vehicle, preferring the
        newer fix, so a vehicle that only appears in one table is never hidden
        because the other table has rows for someone else.

   All queries go through tenant.filterByTenant, exactly like every other
   query on the page. Do not bypass it. */

type TenantFilter = { filterByTenant: <T>(query: T) => T };

const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

/* Parallel limit-1 queries per batch in the fallback path. */
const FALLBACK_BATCH = 10;

/* Both source tables share these column names, so one row shape covers both
   queries. heading is optional because vehicle_locations does not have it.
   latitude/longitude/speed are typed to admit string because these columns
   are Postgres numeric, which PostgREST serialises as a JSON string to
   preserve precision that a JSON number would lose. The Number() calls below
   are load-bearing for that reason, not defensive noise. */
type PositionRow = {
  vehicle_id: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  speed: number | string | null;
  heading?: number | string | null;
  recorded_at: string | null;
};

export function firstPerVehicle(rows: PositionRow[]): Map<string, PositionReading> {
  const out = new Map<string, PositionReading>();
  // Rows arrive newest first, so the first row seen for a vehicle is its
  // newest and later rows for the same vehicle are skipped.
  for (const row of rows) {
    const id = row.vehicle_id;
    if (!id || out.has(id)) continue;
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    // A null or unparseable coordinate is not a fix. Number(null) is 0, and
    // setting the vehicle there would draw a confident pin off West Africa.
    // Skipping without marking the vehicle seen lets a later, valid row for
    // the same vehicle still be picked up instead of losing it entirely.
    if (row.latitude == null || row.longitude == null) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.set(id, {
      vehicleId: id,
      lat,
      lng,
      // speed carries no documented unit, so kph is assumed rather than
      // verified. An absent speed is deliberately left non-finite so
      // speedLabel reports it as unknown rather than a confident "Stationary".
      // The explicit null check is load-bearing: Number(null) is 0, not NaN.
      speedKph: row.speed == null ? NaN : Number(row.speed),
      headingDeg: row.heading == null ? null : Number(row.heading),
      recordedAt: normaliseTimestamp(String(row.recorded_at)),
    });
  }
  return out;
}

function readingTime(reading: PositionReading): number {
  const time = new Date(normaliseTimestamp(reading.recordedAt)).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** Newest fix per vehicle across sources; `primary` wins a tie (it carries heading). */
export function mergeLatestReadings(
  primary: Map<string, PositionReading>,
  secondary: Map<string, PositionReading>,
): Map<string, PositionReading> {
  const out = new Map(primary);

  for (const [vehicleId, reading] of secondary) {
    const existing = out.get(vehicleId);
    if (!existing || readingTime(reading) > readingTime(existing)) {
      out.set(vehicleId, reading);
    }
  }

  return out;
}

async function latestFromTable(
  supabase: SupabaseClient,
  tenant: TenantFilter,
  table: "telematics_positions" | "vehicle_locations",
  rpcName: string,
  columns: string,
  vehicleIds: string[],
): Promise<Map<string, PositionReading>> {
  const { data, error } = await tenant.filterByTenant(
    supabase.rpc(rpcName, { p_vehicle_ids: vehicleIds }),
  );

  if (!error) {
    return firstPerVehicle((data ?? []) as PositionRow[]);
  }

  if (!error.code || !MISSING_FUNCTION_CODES.has(error.code)) {
    throw new Error(`positions: ${error.message}`);
  }

  const rows: PositionRow[] = [];

  for (let start = 0; start < vehicleIds.length; start += FALLBACK_BATCH) {
    const batch = vehicleIds.slice(start, start + FALLBACK_BATCH);
    const results = await Promise.all(
      batch.map((vehicleId) =>
        tenant
          .filterByTenant(supabase.from(table).select(columns))
          .eq("vehicle_id", vehicleId)
          .not("latitude", "is", null)
          .not("longitude", "is", null)
          .order("recorded_at", { ascending: false })
          .limit(1),
      ),
    );

    for (const result of results) {
      if (result.error) throw new Error(`positions: ${result.error.message}`);
      rows.push(...((result.data ?? []) as unknown as PositionRow[]));
    }
  }

  return firstPerVehicle(rows);
}

export function createSupabasePositionSource(
  supabase: SupabaseClient,
  tenant: TenantFilter,
): PositionSource {
  return {
    async getPositions(vehicleIds: string[]): Promise<Map<string, PositionReading>> {
      const ids = [...new Set(vehicleIds)];
      if (ids.length === 0) return new Map();

      const [telematics, legacy] = await Promise.all([
        latestFromTable(
          supabase,
          tenant,
          "telematics_positions",
          "latest_telematics_positions",
          "vehicle_id, latitude, longitude, speed, heading, recorded_at",
          ids,
        ),
        latestFromTable(
          supabase,
          tenant,
          "vehicle_locations",
          "latest_vehicle_locations",
          "vehicle_id, latitude, longitude, speed, recorded_at",
          ids,
        ),
      ]);

      return mergeLatestReadings(telematics, legacy);
    },
  };
}
