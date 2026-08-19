/* Display strings for route metrics. Kept out of the components so the lane
   header, the top bar and the per-leg chips cannot drift apart on rounding.

   Non-finite or negative input renders as "-", the same absent-value marker
   /jobs uses for money. JSON.parse cannot produce NaN or Infinity from a
   TomTom response, so this is a guard against future arithmetic upstream,
   not an expected path. */

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "-";
  const wholeMeters = Math.round(meters);
  if (wholeMeters < 1000) return `${wholeMeters} m`;
  const km = meters / 1000;
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} km` : `${rounded.toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  // A 29-second trip rendered as "0 m" reads as no data; the floor is 1 minute.
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}
