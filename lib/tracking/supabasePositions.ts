import type { SupabaseClient } from "@supabase/supabase-js";

import { normaliseTimestamp, type PositionReading, type PositionSource } from "./position";

/* The only implementation of PositionSource that exists today.

   It reads telematics_positions first because that table carries a heading
   column, then falls back to vehicle_locations, which does not. Both are
   read-only from this app's point of view: nothing in this repo writes either
   one, so in practice this returns an empty map and the page renders its
   no-signal state throughout. That is the expected outcome until a feed lands,
   not a bug.

   Both queries go through tenant.filterByTenant, exactly like every other
   query on the page. Do not bypass it. */

type TenantFilter = { filterByTenant: <T>(query: T) => T };

/* Rows to pull before reducing to the newest per vehicle. Supabase has no
   DISTINCT ON, so ordering by recorded_at desc and taking the first row per
   vehicle client-side is the cheap way to do this.

   KNOWN LIMITATION: this bound is fleet-wide, not per-vehicle. A vehicle
   reporting every few seconds can consume the whole budget and starve the
   others, and a long-parked vehicle's newest fix may fall outside it entirely
   and render as "No GPS" rather than "1 d ago". Harmless while nothing writes
   these tables. Before a real feed lands this needs a DISTINCT ON RPC or one
   query per vehicle. */
const ROWS_PER_VEHICLE = 5;

/* Both source tables share these column names, so one row shape covers both
   queries. heading is optional because vehicle_locations does not select it.
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

function firstPerVehicle(rows: PositionRow[]): Map<string, PositionReading> {
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
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.set(id, {
      vehicleId: id,
      lat,
      lng,
      // speed carries no documented unit and nothing writes this column yet,
      // so kph is assumed rather than verified, the same kind of assumption
      // position.ts makes about recorded_at being UTC. If the real feed turns
      // out to report mph, speeds will read low, so treat this field as
      // best-effort until a real feed lands.
      //
      // An absent speed is deliberately left non-finite so speedLabel reports
      // it as unknown. Coercing it instead would render a confident
      // "Stationary" for a vehicle the source told us nothing about, which is
      // a positive claim we have no basis for. The explicit null check is
      // load-bearing: Number(null) is 0, not NaN, so `Number(row.speed)` alone
      // would still turn a NULL column into a stationary vehicle. Loose
      // `== null` catches an undefined field in the same test.
      speedKph: row.speed == null ? NaN : Number(row.speed),
      headingDeg: row.heading == null ? null : Number(row.heading),
      recordedAt: normaliseTimestamp(String(row.recorded_at)),
    });
  }
  return out;
}

export function createSupabasePositionSource(
  supabase: SupabaseClient,
  tenant: TenantFilter,
): PositionSource {
  return {
    async getPositions(vehicleIds: string[]): Promise<Map<string, PositionReading>> {
      if (vehicleIds.length === 0) return new Map();
      const limit = vehicleIds.length * ROWS_PER_VEHICLE;

      const { data: telematics, error: telematicsError } = await tenant
        .filterByTenant(
          supabase
            .from("telematics_positions")
            .select("vehicle_id, latitude, longitude, speed, heading, recorded_at"),
        )
        .in("vehicle_id", vehicleIds)
        .order("recorded_at", { ascending: false })
        .limit(limit);
      if (telematicsError) throw new Error(`positions: ${telematicsError.message}`);

      if (telematics && telematics.length > 0) {
        return firstPerVehicle(telematics as PositionRow[]);
      }

      /* Reaching here means telematics_positions returned zero rows for this
         tenant's vehicles, not that it returned some. A fleet mid-migration,
         some vehicles on telematics and some still on the legacy table, gets
         only the telematics rows: this is an either-or fallback, not a merge,
         so vehicles that only ever appear in vehicle_locations show no GPS
         once even one vehicle has a telematics row. A real migration window
         would need both tables queried and merged, preferring the newer
         reading per vehicle. */
      const { data: legacy, error: legacyError } = await tenant
        .filterByTenant(
          supabase
            .from("vehicle_locations")
            .select("vehicle_id, latitude, longitude, speed, recorded_at"),
        )
        .in("vehicle_id", vehicleIds)
        .order("recorded_at", { ascending: false })
        .limit(limit);
      if (legacyError) throw new Error(`positions: ${legacyError.message}`);

      return firstPerVehicle((legacy ?? []) as PositionRow[]);
    },
  };
}
