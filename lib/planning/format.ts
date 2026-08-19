/* Display strings for route metrics. Kept out of the components so the lane
   header, the top bar and the per-leg chips cannot drift apart on rounding. */

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} km` : `${rounded.toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  // A 29-second trip rendered as "0 m" reads as no data; the floor is 1 minute.
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}
