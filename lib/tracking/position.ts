/* THE ENTIRE TOMTOM SURFACE.

   Every GPS-dependent thing on /tracking reads a PositionReading and nothing
   else. Today the only implementation of PositionSource is the Supabase
   adapter in ./supabasePositions.ts, which finds no rows because nothing in
   this repo writes a position table. A TomTom adapter later implements the
   same interface and no component changes.

   Staleness is deliberately a first-class state rather than a detail. The
   design mockup renders a pulsing green "Live GPS" pill, and showing that over
   a three-hour-old fix is the page lying to a dispatcher. */

export type PositionReading = {
  vehicleId: string;
  lat: number;
  lng: number;
  speedKph: number;
  headingDeg: number | null;
  recordedAt: string;
};

export type PositionSource = {
  getPositions(vehicleIds: string[]): Promise<Map<string, PositionReading>>;
};

export type SignalState = "none" | "stale" | "live";

/** Minutes after which a reading is stale rather than live. */
export const STALE_AFTER_MINUTES = 10;

/* telematics_positions.recorded_at is `timestamp without time zone`, so
   Supabase returns "2026-08-14T09:41:00" with no offset and new Date() reads
   it as LOCAL time. The rows are stored in UTC, so we say so explicitly rather
   than letting the server's zone decide how old every fix looks.
   vehicle_locations.recorded_at IS timezone-aware and already carries an
   offset, which this leaves untouched. */
export function normaliseTimestamp(raw: string): string {
  return /([Zz]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`;
}

export function readingAgeMinutes(reading: PositionReading, now: Date): number | null {
  const t = new Date(normaliseTimestamp(reading.recordedAt)).getTime();
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 60000;
}

export function signalState(reading: PositionReading | null, now: Date): SignalState {
  if (!reading) return "none";
  const age = readingAgeMinutes(reading, now);
  // An unparseable stamp is not a fix. Treating it as live would put a green
  // pulsing pill over a reading we cannot date.
  if (age === null) return "none";
  return age > STALE_AFTER_MINUTES ? "stale" : "live";
}

export function isLive(reading: PositionReading | null, now: Date): boolean {
  return signalState(reading, now) === "live";
}

export function pingLabel(reading: PositionReading | null, now: Date): string {
  const age = reading ? readingAgeMinutes(reading, now) : null;
  if (age === null) return "No GPS";
  // A negative age means the device clock is ahead of ours. "just now" is the
  // least wrong thing to say about a fix from the near future.
  if (age < 1) return "just now";
  if (age < 60) return `${Math.floor(age)} min ago`;
  if (age < 1440) return `${Math.floor(age / 60)} h ago`;
  return `${Math.floor(age / 1440)} d ago`;
}
