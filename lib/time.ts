/* The operator's timezone, not the server's.

   lib/pod/kpis.ts used to compare getFullYear/getMonth/getDate, which resolve
   in whatever timezone the runtime happens to be set to. Vercel and most
   containers run as UTC, so a delivery at 23:30 UTC on the 12th counts as the
   13th to a UK dispatcher but as the 12th to the server, and "Delivered today"
   quietly undercounts every late-evening drop. The bug is invisible on a
   developer machine set to UK time, which is exactly why it needs pinning.

   It lives in lib/ rather than beside its first caller because it now has more
   than one: lib/tracking/journey.ts formats stop dates and times against the
   same operator calendar, and a second copy of the string is a second thing to
   miss on the day this becomes per-tenant.

   Hardcoded rather than per-tenant even though the field exists:
   company_profiles.timezone is in the schema and app/settings/company/page.tsx
   both reads and writes it, defaulting to "Europe/London". Nothing in the
   console reads that field yet, so this constant remains the operator-wide
   default until it is plumbed through. When it is, this is the single place
   that has to change. */
export const OPERATOR_TIME_ZONE = "Europe/London";

/* THE ONE DEFINITION OF THE OPERATOR'S CALENDAR DAY.

   en-CA formats as YYYY-MM-DD, which compares correctly as a plain string.

   A runtime's own local day is NOT this. getFullYear/getMonth/getDate resolve
   in whatever zone the machine happens to be set to, so a dispatcher on a UTC
   laptop between midnight and 01:00 London time in summer computes yesterday,
   and every job scheduled for the real today drops out of the rail for that
   hour while the card beside it stamps its events with the correct day. Two
   private copies of this used to exist, in lib/pod/kpis.ts and
   lib/tracking/onTheRoad.ts, and they disagreed on exactly that hour. Anything
   asking "what day is it for the operator?" calls this. */
export function operatorDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATOR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
