import { describe, expect, it } from "vitest";
import { PERIOD_DAYS, PERIOD_VEHICLE_PENCE } from "./rateCard";
import { prorateLine } from "./invoiceLine";

// A whole standard period: 28 days, 21 March to 18 April exclusive. Every
// case below uses these unless it is specifically about a shortened period.
const PERIOD_START = "2026-03-21";
const PERIOD_END = "2026-04-18";

function line(
  coverageStartISO: string,
  overrides: Partial<Parameters<typeof prorateLine>[0]> = {}
) {
  return prorateLine({
    periodStartISO: PERIOD_START,
    periodEndISO: PERIOD_END,
    coverageStartISO,
    unitAmountPence: PERIOD_VEHICLE_PENCE,
    minBillDays: 1,
    ...overrides,
  });
}

describe("PERIOD_DAYS", () => {
  it("pins the period at 28 days", () => {
    expect(PERIOD_DAYS).toBe(28);
  });
});

describe("prorateLine", () => {
  it("bills a vehicle present for the whole period at the full rate", () => {
    expect(line(PERIOD_START)).toEqual({
      actualDays: 28,
      billableDays: 28,
      amountPence: 6450,
    });
  });

  // Day 20 of the period is 9 April: the 21st is day 1, so nine days remain
  // including the day of activation.
  it("prorates a vehicle added part way through to the end of the period", () => {
    expect(line("2026-04-09")).toEqual({
      actualDays: 9,
      billableDays: 9,
      amountPence: 2073,
    });
  });

  // The partial first day rounds up, so a licence activated at 23:00 still
  // buys that whole day. Coverage is a date, so this is really a statement
  // about how the close job derives that date, asserted here because this is
  // where the day count is decided.
  it("counts the day of activation as a whole day", () => {
    expect(line("2026-04-17").actualDays).toBe(1);
    expect(line("2026-04-17").amountPence).toBe(230);
  });

  it("charges nothing for a vehicle whose coverage starts at the period end", () => {
    expect(line(PERIOD_END)).toEqual({
      actualDays: 0,
      billableDays: 0,
      amountPence: 0,
    });
  });

  // Entirely inside a grace window that outlasts the period. The close job
  // drops these rather than writing a zero line, but the arithmetic has to
  // agree that nothing is owed.
  it("charges nothing for coverage starting after the period end", () => {
    expect(line("2026-05-01")).toEqual({
      actualDays: 0,
      billableDays: 0,
      amountPence: 0,
    });
  });

  // A vehicle carried over from the previous period. The close job clamps
  // coverage to the period, and this is the belt to that braces: an
  // unclamped coverage_start must never bill more than a full period.
  it("clamps coverage starting before the period to the period start", () => {
    expect(line("2026-01-01")).toEqual({
      actualDays: 28,
      billableDays: 28,
      amountPence: 6450,
    });
  });
});

describe("prorateLine minimum billable days", () => {
  // Rule 6. Two days of actual coverage, but the floor lifts it to seven, so
  // the customer is billed a week. actualDays is reported unchanged so the
  // invoice can still say what really happened.
  it("lifts a short coverage up to the minimum", () => {
    expect(line("2026-04-16", { minBillDays: 7 })).toEqual({
      actualDays: 2,
      billableDays: 7,
      amountPence: 1613,
    });
  });

  it("leaves a coverage longer than the minimum alone", () => {
    expect(line("2026-04-09", { minBillDays: 7 }).billableDays).toBe(9);
  });

  // The floor may never bill more than the period holds, or a vehicle added
  // on the last day of a period would cost more than one present throughout.
  it("caps the minimum at the length of the period", () => {
    expect(line("2026-04-17", { minBillDays: 40 })).toEqual({
      actualDays: 1,
      billableDays: 28,
      amountPence: 6450,
    });
  });

  // The floor is a floor on real coverage, not a way to bill a vehicle that
  // was never there. Without this a vehicle still inside its grace window
  // would be charged seven days for being absent.
  it("does not lift zero coverage off the floor", () => {
    expect(line(PERIOD_END, { minBillDays: 7 }).billableDays).toBe(0);
  });
});

describe("prorateLine on a period cut short by cancellation", () => {
  // Cancellation closes the period early. A day still costs 1/28 of the rate,
  // which is what keeps the per-day price identical whether or not a customer
  // cancels. The shortened length only caps how many days can be billed.
  const CANCELLED_END = "2026-04-01"; // 11 days in

  it("bills only the days that elapsed before cancellation", () => {
    expect(
      line(PERIOD_START, { periodEndISO: CANCELLED_END })
    ).toEqual({
      actualDays: 11,
      billableDays: 11,
      amountPence: 2534,
    });
  });

  // The point of holding the denominator at 28: eleven days costs the same
  // whether the period was cut short at eleven days or ran the full 28. If
  // the denominator followed the shortened length instead, cancelling on day
  // 11 would cost a full period's money for eleven days of service.
  it("charges the same for eleven days however the period ended", () => {
    const cancelled = line(PERIOD_START, { periodEndISO: CANCELLED_END });
    const elevenDaysOfAFullPeriod = line("2026-04-07");

    expect(elevenDaysOfAFullPeriod.billableDays).toBe(11);
    expect(cancelled.amountPence).toBe(elevenDaysOfAFullPeriod.amountPence);
  });

  it("caps the minimum at the shortened length, not at 28", () => {
    expect(
      line("2026-03-30", { periodEndISO: CANCELLED_END, minBillDays: 20 })
    ).toEqual({
      actualDays: 2,
      billableDays: 11,
      amountPence: 2534,
    });
  });
});

describe("prorateLine validation", () => {
  it("rejects a period that ends before it starts", () => {
    expect(() => line(PERIOD_START, { periodEndISO: "2026-03-01" })).toThrow(
      /periodEndISO must be after periodStartISO/
    );
  });

  it("rejects a period of zero length", () => {
    expect(() => line(PERIOD_START, { periodEndISO: PERIOD_START })).toThrow(
      /periodEndISO must be after periodStartISO/
    );
  });

  it("rejects a negative minimum", () => {
    expect(() => line(PERIOD_START, { minBillDays: -1 })).toThrow(
      /minBillDays must be a non-negative integer/
    );
  });

  it("rejects a fractional unit amount", () => {
    expect(() => line(PERIOD_START, { unitAmountPence: 64.5 })).toThrow(
      /unitAmountPence must be a non-negative integer/
    );
  });
});
