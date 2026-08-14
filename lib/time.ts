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
