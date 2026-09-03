import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCompliance, mostUrgent } from "./expiry";
import type { ComplianceResult } from "./expiry";

/* Frozen so "today" cannot drift under the test. Europe/London is pinned in
   vitest.config.ts on purpose (see CLAUDE.md): these are day-boundary
   comparisons, and a UTC runner would let an off-by-one pass unnoticed.

   2026-09-03 is inside BST, and so are every offset asserted below (+31 lands
   on 2026-10-04, three weeks before the clocks go back), so nothing here is
   quietly relying on a DST transition to cancel out an error. */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-03T12:00:00"));
});
afterEach(() => vi.useRealTimers());

describe("getCompliance", () => {
  it("treats a missing expiry date as amber, not ok", () => {
    const result = getCompliance(null);

    /* SubcontractorCard depends on this being amber: it skips deriving
       compliance entirely while loading precisely because a card of null
       expiries would otherwise show a real amber badge over placeholder data.
       Changing this to "ok" would silently make undocumented paperwork look
       compliant. */
    expect(result.level).toBe("amber");
    expect(result.label).toBe("DATE NEEDED");
    expect(result.days).toBeNull();
  });

  it("reports an expiry in the past as red, counting days elapsed", () => {
    const result = getCompliance("2026-08-31");

    expect(result.level).toBe("red");
    expect(result.days).toBe(-3);
    expect(result.label).toBe("EXPIRED 3d");
  });

  it("treats an expiry of today as still valid today, not yet expired", () => {
    const result = getCompliance("2026-09-03");

    /* Day 0 falls on the NOT-expired side: days === 0 is red and labelled
       "EXPIRES TODAY" rather than "EXPIRED 0d". That is the right reading for
       a licence or an insurance policy, which run to the end of their expiry
       date: cover exists all day and lapses at midnight. Red (not amber) is
       still correct because there is no remaining slack. */
    expect(result.level).toBe("red");
    expect(result.days).toBe(0);
    expect(result.label).toBe("EXPIRES TODAY");
  });

  it("reports tomorrow as red with a day remaining", () => {
    const result = getCompliance("2026-09-04");

    expect(result.level).toBe("red");
    expect(result.days).toBe(1);
    expect(result.label).toBe("NEEDS ATTENTION • 1d");
  });

  /* The 7-day edge, asserted on the boundary day and the day either side. */
  it("keeps day 6 red, just inside the 7-day window", () => {
    const result = getCompliance("2026-09-09");

    expect(result.level).toBe("red");
    expect(result.days).toBe(6);
    expect(result.label).toBe("NEEDS ATTENTION • 6d");
  });

  it("keeps day 7 red: the threshold is inclusive", () => {
    const result = getCompliance("2026-09-10");

    expect(result.level).toBe("red");
    expect(result.days).toBe(7);
    expect(result.label).toBe("NEEDS ATTENTION • 7d");
  });

  it("turns amber at day 8, the first day past the red window", () => {
    const result = getCompliance("2026-09-11");

    expect(result.level).toBe("amber");
    expect(result.days).toBe(8);
    expect(result.label).toBe("EXPIRING SOON • 8d");
  });

  /* The 30-day edge, likewise asserted either side. */
  it("keeps day 29 amber, just inside the 30-day window", () => {
    const result = getCompliance("2026-10-02");

    expect(result.level).toBe("amber");
    expect(result.days).toBe(29);
    expect(result.label).toBe("EXPIRING SOON • 29d");
  });

  it("keeps day 30 amber: the threshold is inclusive", () => {
    const result = getCompliance("2026-10-03");

    expect(result.level).toBe("amber");
    expect(result.days).toBe(30);
    expect(result.label).toBe("EXPIRING SOON • 30d");
  });

  it("goes ok at day 31, the first day past the amber window", () => {
    const result = getCompliance("2026-10-04");

    expect(result.level).toBe("ok");
    expect(result.days).toBe(31);
    expect(result.label).toBe("VALID • 31d");
  });

  it("is unaffected by the time of day the check runs", () => {
    /* today is normalised to midnight, so a check late in the evening must not
       shave a day off a boundary and flip amber to red. */
    vi.setSystemTime(new Date("2026-09-03T23:59:00"));

    expect(getCompliance("2026-09-11").level).toBe("amber");
    expect(getCompliance("2026-09-11").days).toBe(8);
  });
});

describe("mostUrgent", () => {
  /* Literals, not getCompliance() calls. Anything in a describe body runs at
     collection time, BEFORE beforeEach installs the fake timers, so fixtures
     built by calling getCompliance here would be computed against the real
     clock and would start failing on a date in the near future.

     Literals also keep these tests about mostUrgent alone: it only ever reads
     .level, so coupling them to getCompliance's output bought nothing.

     The values are the ones the boundary cases above assert, so they stay
     honest about what getCompliance actually produces. */
  const ok: ComplianceResult = { level: "ok", days: 31, label: "VALID • 31d" };
  const amber: ComplianceResult = {
    level: "amber",
    days: 30,
    label: "EXPIRING SOON • 30d",
  };
  const red: ComplianceResult = {
    level: "red",
    days: 1,
    label: "NEEDS ATTENTION • 1d",
  };

  it("returns the worst level in a mixed list", () => {
    expect(mostUrgent([ok, amber, red]).level).toBe("red");
  });

  it("returns the same result whichever order the list arrives in", () => {
    /* reduce keeps the incumbent on a tie, so a wrong comparison would still
       pass in one order and fail in the other. Assert both. */
    expect(mostUrgent([red, amber, ok]).level).toBe("red");
    expect(mostUrgent([ok, amber, red])).toEqual(mostUrgent([red, amber, ok]));
  });

  it("picks amber over ok when nothing is red", () => {
    expect(mostUrgent([ok, amber]).level).toBe("amber");
    expect(mostUrgent([amber, ok]).level).toBe("amber");
  });

  it("returns the single member of a one-item list", () => {
    expect(mostUrgent([amber])).toEqual(amber);
  });

  it("throws on an empty list rather than inventing a level", () => {
    expect(() => mostUrgent([])).toThrow(
      "mostUrgent requires at least one compliance result"
    );
  });
});
