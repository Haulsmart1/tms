/*
  When a quotation share link stops working.

  valid_until is a calendar date. The link used to expire at 23:59:59.999 UTC
  on that date, which during BST is 00:59:59 the NEXT day for the operator and
  customer. A quotation is valid through the whole of its last day in the
  operator's own zone (Europe/London by default), so the link now expires at
  the last second of that day there.

  Pure: the routes turn the "invalid" and "expired" outcomes into their 409s.
*/

import { addCalendarDays, isValidYmd } from "../invoices/dates";
import { OPERATOR_TIME_ZONE, resolveTimeZone } from "../time";

export type ShareExpiryResult =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: "invalid_valid_until" | "quotation_expired" };

/* Offset (local wall clock minus UTC) in milliseconds at `utcMs` in `timeZone`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant (ms) of 00:00 on calendar day `ymd` in `timeZone`. */
export function startOfDayInZoneMs(ymd: string, timeZone: string = OPERATOR_TIME_ZONE): number | null {
  if (!isValidYmd(ymd)) return null;
  const zone = resolveTimeZone(timeZone).timeZone;
  const [year, month, day] = ymd.split("-").map(Number);
  const wallMidnight = Date.UTC(year, month - 1, day);
  // Two passes settle the offset even when a clock change sits near midnight.
  let guess = wallMidnight - zoneOffsetMs(wallMidnight, zone);
  guess = wallMidnight - zoneOffsetMs(guess, zone);
  return guess;
}

/**
 * Share-link expiry in epoch seconds: the end of `validUntil` in the operator's
 * zone, capped at `maxLifetimeSeconds` from now when given. With no validUntil
 * the link lives `fallbackLifetimeSeconds`.
 */
export function quotationShareExpiry(input: {
  validUntil: string | null | undefined;
  fallbackLifetimeSeconds: number;
  maxLifetimeSeconds?: number;
  now?: Date;
  timeZone?: string;
}): ShareExpiryResult {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);

  if (!input.validUntil) {
    return { ok: true, expiresAt: nowSeconds + input.fallbackLifetimeSeconds };
  }

  const nextDay = addCalendarDays(input.validUntil, 1);
  const endMs = nextDay ? startOfDayInZoneMs(nextDay, input.timeZone) : null;
  if (endMs === null) {
    return { ok: false, reason: "invalid_valid_until" };
  }

  // Last whole second that is still inside validUntil.
  const expiresAt = Math.floor(endMs / 1000) - 1;
  if (expiresAt <= nowSeconds) {
    return { ok: false, reason: "quotation_expired" };
  }

  return {
    ok: true,
    expiresAt:
      input.maxLifetimeSeconds === undefined ? expiresAt : Math.min(expiresAt, nowSeconds + input.maxLifetimeSeconds),
  };
}
