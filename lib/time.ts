/* The operator's timezone, not the server's.

   Europe/London remains the application-wide fallback while company profile
   timezone plumbing is introduced. Compliance code can already pass the
   tenant's IANA timezone explicitly. */
export const OPERATOR_TIME_ZONE = "Europe/London";

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function operatorDayInTimeZone(now: Date, timeZone: string): string {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/* THE ONE DEFINITION OF THE OPERATOR'S CALENDAR DAY.

   Existing callers retain the operator-wide default. Compliance callers that
   have loaded company_profiles.timezone should use operatorDayInTimeZone.

   That describes tacho/CPC compliance. It does NOT describe lib/compliance/,
   which is subcontractor and vehicle document expiry: that module now compares
   calendar-day labels through calendarDaysBetween below (review SET-23), with
   "today" taken from todayIsoDateInZone. */
export function operatorDay(now: Date): string {
  return operatorDayInTimeZone(now, OPERATOR_TIME_ZONE);
}

export function elapsedMilliseconds(start: Date, end: Date): number {
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new RangeError("Activity timestamps must be valid dates.");
  }

  if (endMs <= startMs) {
    throw new RangeError("Activity end must be after activity start.");
  }

  return endMs - startMs;
}

/* A timezone read from the database (company_profiles.timezone) is free text.
   Intl.DateTimeFormat throws a RangeError on anything that is not a real IANA
   zone, and a throw during render white-screens a page (review PLAN-9). Pages
   that read the stored zone resolve it through here and show a note when
   `fallback` is true, rather than silently using London. */
export type ResolvedTimeZone = {
  timeZone: string;
  /** True when a value was stored but is not a valid IANA zone. */
  fallback: boolean;
  /** The stored value, trimmed; null when nothing was stored. */
  requested: string | null;
};

export function resolveTimeZone(value: unknown): ResolvedTimeZone {
  const requested = typeof value === "string" && value.trim() ? value.trim() : null;

  if (requested && isValidIanaTimeZone(requested)) {
    return { timeZone: requested, fallback: false, requested };
  }

  return { timeZone: OPERATOR_TIME_ZONE, fallback: requested !== null, requested };
}

/* "Today" as YYYY-MM-DD in the given zone (the operator zone by default).
   An invalid zone falls back to the operator zone instead of throwing: callers
   use this for display and filtering, where a crash is worse than a day
   boundary an hour out. `now` is injectable for tests. */
export function todayIsoDateInZone(
  timeZone: string = OPERATOR_TIME_ZONE,
  now: Date = new Date(),
): string {
  return operatorDayInTimeZone(now, resolveTimeZone(timeZone).timeZone);
}

/* Whole calendar days from `from` to `to`, both YYYY-MM-DD. Computed on the
   UTC midnights of the two labels, so a clock change between them cannot add
   or remove an hour and round into an extra day (review SET-23). Returns null
   for anything that is not a real calendar date. */
export function calendarDaysBetween(from: string, to: string): number | null {
  const fromMs = isoDateUtcMs(from);
  const toMs = isoDateUtcMs(to);
  if (fromMs === null || toMs === null) return null;
  return Math.round((toMs - fromMs) / 86_400_000);
}

function isoDateUtcMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return ms;
}

/* The start of the tachograph regulation week containing `instant`.

   EC 561/2006 Art 4(i) defines a week as Monday 00:00 to Sunday 24:00, and
   digital tachographs record in UTC, so enforcement analysis buckets driving
   into UTC weeks. Local Monday midnight would, during BST, count the hour from
   Sunday 23:00 UTC in a different week from the one enforcement counts it in
   (review PLAN-17). Display stays in local time; only regulation buckets use
   this. */
export function utcRegulationWeekStart(instant: Date): Date {
  const ms = instant.getTime();
  if (!Number.isFinite(ms)) {
    throw new RangeError("Week start needs a valid instant.");
  }
  const midnight = Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate(),
  );
  const daysSinceMonday = (instant.getUTCDay() + 6) % 7;
  return new Date(midnight - daysSinceMonday * 86_400_000);
}
