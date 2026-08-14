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

/* Rows per vehicle to pull before reducing to the newest. Supabase has no
   DISTINCT ON, so ordering by recorded_at desc and taking the first row per
   vehicle client-side is the cheap way to do this. Five gives headroom for a
   vehicle that reported several times in the window without fetching the
   unbounded history the old page fetched. */
const ROWS_PER_VEHICLE = 5;

function firstPerVehicle(
  rows: any[],
  vehicleKey: string,
  latKey: string,
  lngKey: string,
): Map<string, PositionReading> {
  const out = new Map<string, PositionReading>();
  // Rows arrive newest first, so the first row seen for a vehicle is its
  // newest and later rows for the same vehicle are skipped.
  for (const row of rows) {
    const id = row[vehicleKey];
    if (!id || out.has(id)) continue;
    out.set(id, {
      vehicleId: id,
      lat: Number(row[latKey]),
      lng: Number(row[lngKey]),
      speedKph: Number(row.speed ?? 0),
      headingDeg: row.heading == null ? null : Number(row.heading),
      recordedAt: normaliseTimestamp(String(row.recorded_at)),
    });
  }
  return out;
}

export function createSupabasePositionSource(
  supabase: any,
  tenant: TenantFilter,
): PositionSource {
  return {
    async getPositions(vehicleIds: string[]): Promise<Map<string, PositionReading>> {
      if (vehicleIds.length === 0) return new Map();
      const limit = vehicleIds.length * ROWS_PER_VEHICLE;

      const { data: telematics } = await tenant
        .filterByTenant(
          supabase
            .from("telematics_positions")
            .select("vehicle_id, latitude, longitude, speed, heading, recorded_at"),
        )
        .in("vehicle_id", vehicleIds)
        .order("recorded_at", { ascending: false })
        .limit(limit);

      if (telematics && telematics.length > 0) {
        return firstPerVehicle(telematics, "vehicle_id", "latitude", "longitude");
      }

      const { data: legacy } = await tenant
        .filterByTenant(
          supabase
            .from("vehicle_locations")
            .select("vehicle_id, latitude, longitude, speed, recorded_at"),
        )
        .in("vehicle_id", vehicleIds)
        .order("recorded_at", { ascending: false })
        .limit(limit);

      return firstPerVehicle(legacy ?? [], "vehicle_id", "latitude", "longitude");
    },
  };
}
