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
   have loaded company_profiles.timezone should use operatorDayInTimeZone. */
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
