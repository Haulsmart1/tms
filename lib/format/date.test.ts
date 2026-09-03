import { describe, it, expect } from "vitest";
import { formatDateGB } from "./date";

/* These pin the behaviour that app/vehicles and app/subcontractors already
   had, and ONLY those two. The six copies still under app/ are variants, not
   near-copies (see the module header: app/pod parses as UTC, app/drivers has
   no NaN guard, app/invoices also formats date-times), so nothing here says
   anything about what migrating one of those would render.

   They are not a specification of what the formatter ought to do; changing any
   of them is a change to what the two converted pages render. */
describe("formatDateGB", () => {
  it("formats a YYYY-MM-DD date as en-GB day-first", () => {
    expect(formatDateGB("2026-10-01")).toBe("01/10/2026");
  });

  it("keeps the calendar day, rather than shifting it by a timezone offset", () => {
    // The T00:00:00 suffix is what makes this local rather than UTC midnight.
    expect(formatDateGB("2026-01-31")).toBe("31/01/2026");
  });

  it("returns an empty string unchanged rather than 'Invalid Date'", () => {
    expect(formatDateGB("")).toBe("");
  });

  it("returns an unparseable value unchanged", () => {
    expect(formatDateGB("not a date")).toBe("not a date");
  });
});
