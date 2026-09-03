/* The en-GB display formatter for a YYYY-MM-DD column. Nine near-copies of it
   exist under app/; this is the one place it should live from now on. Two of
   those copies (app/vehicles, app/subcontractors) now import it. Collapsing
   the remaining seven is a separate job.

   NOT lib/time.ts, which is about operator calendar days and IANA timezones.
   This does no timezone work at all: it renders a date the database already
   stores as a plain calendar date.

   In lib/ rather than beside a page for the usual reason: vitest reaches lib/
   only, so this is the only location where the parse fallback can be tested. */

/** Formats a YYYY-MM-DD string as en-GB (DD/MM/YYYY). Returns the input
 *  unchanged when it does not parse, so a bad column renders as itself rather
 *  than as "Invalid Date". */
export function formatDateGB(value: string): string {
  /* Parsed as LOCAL midnight. A bare `new Date("2026-10-01")` parses as UTC
     midnight, which west of Greenwich formats as the previous day. */
  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB");
}
