import { describe, it, expect } from "vitest";
import { formatDateGB } from "./date";

/* These pin the behaviour the nine app-level copies already had. They are not
   a specification of what the formatter ought to do; changing any of them is a
   change to what every converted page renders. */
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
