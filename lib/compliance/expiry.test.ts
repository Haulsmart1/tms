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

  it("reports the day after expiry as expired by one day", () => {
    const result = getCompliance("2026-09-02");

    /* The direct partner to the day-0 case above: one day either side of the
       lapse, so the moment cover actually ends is pinned from both directions. */
    expect(result.level).toBe("red");
    expect(result.days).toBe(-1);
    expect(result.label).toBe("EXPIRED 1d");
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

  /* The two cases below pin a FAIL-OPEN, not a desired behaviour. An expiry
     string Date cannot parse yields NaN, and every band comparison against NaN
     is false, so the input falls through `days < 0`, `days <= 7` and
     `days <= 30` alike and lands on the final return: a green VALID badge on
     data nobody could read.

     Note days: NaN satisfies the declared `number | null`, so the type gives no
     protection and nothing downstream catches it either.

     It is unreachable today only because all five expiry columns are Postgres
     `date`, which Supabase serves as a bare YYYY-MM-DD. Migrating any one of
     them to `timestamptz` would start sending the second form below, and every
     card on the page would turn green. That is exactly why these exist. */
  it("fails open to a green VALID badge on an unparseable date", () => {
    const result = getCompliance("not-a-date");

    expect(result.level).toBe("ok");
    expect(result.days).toBeNaN();
    expect(result.label).toBe("VALID • NaNd");
  });

  it("fails open the same way on a timestamp-shaped value", () => {
    /* What a timestamptz column would serve. The function appends T00:00:00 to
       whatever it is given, so this becomes a double-timestamp string. */
    const result = getCompliance("2026-09-03T00:00:00+00:00");

    expect(result.level).toBe("ok");
    expect(result.days).toBeNaN();
    expect(result.label).toBe("VALID • NaNd");
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

  it("returns the worst member of a mixed list, object and all", () => {
    /* Assert the whole object, not just .level. SubcontractorCard hands this
       return value straight to StatusBadge, which renders result.label, so
       returning the right level on the wrong object is a visible defect. */
    expect(mostUrgent([ok, amber, red])).toEqual(red);
  });

  it("is order independent when the levels are all distinct", () => {
    /* Only true because these three fixtures have distinct levels; see the tie
       case below for what happens when two share one. */
    expect(mostUrgent([red, amber, ok])).toEqual(red);
    expect(mostUrgent([ok, amber, red])).toEqual(mostUrgent([red, amber, ok]));
  });

  it("keeps the FIRST of two equally-ranked results, not the worse one", () => {
    const mildlyExpired: ComplianceResult = {
      level: "red",
      days: -3,
      label: "EXPIRED 3d",
    };
    const longExpired: ComplianceResult = {
      level: "red",
      days: -185,
      label: "EXPIRED 185d",
    };

    /* Pinning current behaviour, NOT endorsing it. reduce keeps the incumbent
       on a tie, and the ranking is by level only, so days never breaks a tie.
       The badge therefore shows the FIRST red in the caller's array rather than
       the worst one: a subcontractor whose motor insurance lapsed 185 days ago
       and whose goods-in-transit lapsed 3 days ago reads "EXPIRED 3d", because
       SubcontractorCard lists goods-in-transit first.

       Changing this is a product decision about what a card should say, not a
       bug fix, so it needs deciding before it is touched. */
    expect(mostUrgent([mildlyExpired, longExpired]).label).toBe("EXPIRED 3d");
    expect(mostUrgent([longExpired, mildlyExpired]).label).toBe("EXPIRED 185d");
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
