import { describe, expect, it } from "vitest";
import { billingStatusBadge, formatCycleDate } from "./format";

/* vitest.config.ts pins TZ=Europe/London. The DST cases below are only
   meaningful under that pin; do not "fix" a failure by changing it. */
describe("formatCycleDate", () => {
  it("formats a YYYY-MM-DD cycle date as dd/mm/yyyy, like the rest of the app", () => {
    expect(formatCycleDate("2026-10-01")).toBe("01/10/2026");
  });

  it("does not shift the day across the spring DST boundary", () => {
    // BST begins 2026-03-29 at 01:00 local time.
    expect(formatCycleDate("2026-03-29")).toBe("29/03/2026");
  });

  it("does not shift the day across the autumn DST boundary", () => {
    // BST ends 2026-10-25 at 02:00 local time.
    expect(formatCycleDate("2026-10-25")).toBe("25/10/2026");
  });

  it("returns an unparseable input unchanged rather than 'Invalid Date'", () => {
    expect(formatCycleDate("not-a-date")).toBe("not-a-date");
    expect(formatCycleDate("")).toBe("");
  });
});

describe("billingStatusBadge", () => {
  it("maps active to a success badge", () => {
    expect(billingStatusBadge("active")).toEqual({ tone: "success", label: "Active" });
  });

  it("maps past_due to a danger badge", () => {
    expect(billingStatusBadge("past_due")).toEqual({ tone: "danger", label: "Past due" });
  });

  it("maps canceled to a warning badge with UK spelling", () => {
    expect(billingStatusBadge("canceled")).toEqual({ tone: "warning", label: "Cancelled" });
  });

  it("maps a missing billing row to a neutral 'Not set up' badge", () => {
    expect(billingStatusBadge(null)).toEqual({ tone: "neutral", label: "Not set up" });
    expect(billingStatusBadge(undefined)).toEqual({ tone: "neutral", label: "Not set up" });
  });
});
