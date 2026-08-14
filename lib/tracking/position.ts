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
  /** As the source returned it, so it MAY be naive. Never pass this to new Date()
      directly: go through readingAgeMinutes, or normalise it first. */
  recordedAt: string;
};

export type PositionSource = {
  getPositions(vehicleIds: string[]): Promise<Map<string, PositionReading>>;
};

export type SignalState = "none" | "stale" | "live";

/** Minutes after which a reading is stale rather than live. */
export const STALE_AFTER_MINUTES = 10;

/* A fix a few seconds in the future is clock drift and still counts as live. A
   fix hours ahead is a broken device clock, and calling that live would pin a
   green pill to a vehicle that may not have reported in days. lib/pod/queue.ts
   made the same call about negative POD ages for the same reason. */
export const FUTURE_TOLERANCE_MINUTES = 2;

/* telematics_positions.recorded_at is `timestamp without time zone`, so
   Supabase returns "2026-08-14T09:41:00" with no offset and new Date() reads
   it as LOCAL time. The rows are assumed to be stored in UTC. Nothing in this
   repo writes this table, so that is unverified until a real feed lands. If
   the feed turns out to write local time, fixes read one hour old in summer
   rather than falsely live, which is the safe direction to be wrong in.
   vehicle_locations.recorded_at IS timezone-aware and already carries an
   offset, which this leaves untouched. */
export function normaliseTimestamp(raw: string): string {
  return /([Zz]|[+-]\d{2}(:?\d{2})?)$/.test(raw) ? raw : `${raw}Z`;
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
  // A reading far enough in the future to exceed clock drift tolerance is a
  // broken device clock, not a live fix. See FUTURE_TOLERANCE_MINUTES.
  if (age < -FUTURE_TOLERANCE_MINUTES) return "stale";
  return age > STALE_AFTER_MINUTES ? "stale" : "live";
}

/* A type predicate rather than a plain boolean, so a caller that has already
   asked "is this live?" does not also have to prove the reading is non-null to
   the narrower before using it. */
export function isLive(reading: PositionReading | null, now: Date): reading is PositionReading {
  return signalState(reading, now) === "live";
}

export function pingLabel(reading: PositionReading | null, now: Date): string {
  const age = reading ? readingAgeMinutes(reading, now) : null;
  if (age === null) return "No GPS";
  // Beyond drift tolerance, a negative age is a broken device clock, not a
  // fix from the near future. Say so rather than claiming "just now" forever.
  if (age < -FUTURE_TOLERANCE_MINUTES) return "clock ahead";
  // A small negative age is clock drift. "just now" is the least wrong thing
  // to say about a fix from the near future.
  if (age < 1) return "just now";
  if (age < 60) return `${Math.floor(age)} min ago`;
  if (age < 1440) return `${Math.floor(age / 60)} h ago`;
  return `${Math.floor(age / 1440)} d ago`;
}

/* Speed vocabulary lives here rather than in each consumer, for the same
   reason pingLabel does. The header tile and the live timeline node render the
   SAME vehicle's speed from the SAME reading on the SAME screen, so two copies
   can only ever disagree in ways a dispatcher can see at once. lib/pod/overdue.ts
   was created for exactly this failure and its header says so.

   Returns null rather than a string for an unusable speed, so each caller can
   word "unknown" to suit its own context. Guarding on the ROUNDED value is
   load-bearing: 0.4 km/h is greater than zero but rounds to zero, and "0 km/h"
   on a truck is the string this vocabulary exists to avoid.

   A NEGATIVE speed is not a stationary vehicle, it is garbage from the source,
   and "Stationary" is a confident positive claim about where a truck is. It
   joins the non-finite case in returning null, so the tile reports unknown
   rather than asserting something it cannot know. */
export function speedLabel(reading: PositionReading): string | null {
  const kph = Math.round(reading.speedKph);
  if (!Number.isFinite(kph)) return null;
  if (kph < 0) return null;
  return kph > 0 ? `${kph} km/h` : "Stationary";
}
