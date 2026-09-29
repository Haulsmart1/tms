/*
  Times on the /shifts page are shown and entered in the operator's time zone,
  not the browser's, so an office user on a laptop set to another zone still
  reads and types the times the drivers worked. Pure.
*/

import { resolveTimeZone } from "../time";

function wallParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function offsetMs(ms: number, timeZone: string): number {
  const w = wallParts(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant as a `datetime-local` value ("YYYY-MM-DDTHH:mm") in `timeZone`. */
export function isoToZonedInput(iso: string | Date, timeZone: string): string {
  const ms = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  if (!Number.isFinite(ms)) return "";
  const w = wallParts(ms, resolveTimeZone(timeZone).timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/**
 * A `datetime-local` value read as wall-clock time in `timeZone`, as an ISO
 * instant. Null when the value is not a date and time, or names a wall-clock
 * time the clocks skip (01:30 on the morning they go forward in London).
 */
export function zonedInputToIso(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const zone = resolveTimeZone(timeZone).timeZone;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - offsetMs(wall, zone);
  guess = wall - offsetMs(guess, zone);
  // A skipped wall-clock time does not round-trip.
  if (isoToZonedInput(new Date(guess), zone) !== value.trim()) return null;
  return new Date(guess).toISOString();
}

/** "06:05" in `timeZone`. */
export function clockIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: resolveTimeZone(timeZone).timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** "Tue 29 Sep, 06:05" in `timeZone`. */
export function dateTimeIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: resolveTimeZone(timeZone).timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
