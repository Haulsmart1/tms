import { describe, expect, it } from "vitest";
import { PERIOD_DAYS } from "./rateCard";
import { nextPeriodBounds } from "./period";

describe("nextPeriodBounds", () => {
  it("runs for exactly one period from the given start", () => {
    expect(nextPeriodBounds("2026-03-21")).toEqual({
      periodStartISO: "2026-03-21",
      periodEndISO: "2026-04-18",
    });
  });

  // Periods must abut exactly. A gap would be days nobody is billed for; an
  // overlap would be days billed twice, and the end being exclusive is what
  // makes "the next period starts where the last one ended" correct rather
  // than off by one.
  it("makes consecutive periods abut with no gap or overlap", () => {
    const first = nextPeriodBounds("2026-03-21");
    const second = nextPeriodBounds(first.periodEndISO);
    const third = nextPeriodBounds(second.periodEndISO);

    expect(second.periodStartISO).toBe(first.periodEndISO);
    expect(third.periodStartISO).toBe(second.periodEndISO);
  });

  // The clocks go forward on 29 March 2026 and back on 25 October. A period
  // spanning either is still 28 calendar days: billing dates are plain
  // YYYY-MM-DD and never see a 23- or 25-hour day. This is the property
  // lib/billing/schedule.ts exists to protect, asserted at the period level.
  it("is 28 calendar days across both clock changes", () => {
    for (const start of ["2026-03-15", "2026-10-12", "2026-06-01"]) {
      const bounds = nextPeriodBounds(start);
      const startMs = Date.parse(`${bounds.periodStartISO}T00:00:00Z`);
      const endMs = Date.parse(`${bounds.periodEndISO}T00:00:00Z`);
      expect((endMs - startMs) / 86_400_000).toBe(PERIOD_DAYS);
    }
  });

  it("crosses a month end", () => {
    expect(nextPeriodBounds("2026-01-20").periodEndISO).toBe("2026-02-17");
  });

  it("crosses a leap day", () => {
    expect(nextPeriodBounds("2028-02-10").periodEndISO).toBe("2028-03-09");
  });

  it("rejects a malformed start date", () => {
    expect(() => nextPeriodBounds("20th March")).toThrow(/YYYY-MM-DD/);
  });
});
