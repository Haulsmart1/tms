/* The en-GB display formatter for a YYYY-MM-DD column, extracted from the two
   identical copies in app/vehicles and app/subcontractors, which now import it.

   DO NOT MECHANICALLY SWAP THE SIX REMAINING app/ COPIES FOR THIS. They are
   variants, not near-copies, and each one needs a behavioural diff first:

     - app/pod/page.tsx parses with a bare `new Date(value)`, a UTC parse, so
       west of Greenwich it renders the previous day. Swapping it in FIXES that
       and therefore CHANGES rendered output.
     - app/drivers/page.tsx has no NaN guard, so malformed input renders
       "Invalid Date" where this returns the input unchanged.
     - app/invoices/page.tsx branches on `value.includes("T")` and formats
       date-times; this returns those unchanged.
     - The null fallbacks diverge three ways: "Not set", an em dash, and a
       mojibake em dash in invoices.

   Nothing would stop such a swap at compile time where the local copy also
   took a plain string, which is why this warning is here rather than in a
   plan. Note also that this signature is NON-NULLABLE, where six of the eight
   copies accept `string | null | undefined` and fold the null case in: both
   migrated call sites guard before calling, and a call site that does not will
   at least fail to compile.

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
