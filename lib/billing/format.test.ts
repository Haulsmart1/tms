import { describe, expect, it } from "vitest";
import { billingStatusBadge, formatCycleDate } from "./format";

/* vitest.config.ts pins TZ=Europe/London. Note what that pin does NOT give
   us: London is UTC+0 or UTC+1, so a bare UTC-midnight parse never shifts
   the day here and these cases cannot catch the T00:00:00 suffix being
   removed. That guard protects users west of Greenwich and is documented in
   format.ts; it has no unit test because vitest cannot change the process
   timezone per test. */
describe("formatCycleDate", () => {
  it("formats a YYYY-MM-DD cycle date as dd/mm/yyyy, like the rest of the app", () => {
    expect(formatCycleDate("2026-10-01")).toBe("01/10/2026");
  });

  it("formats dates on the BST transition days without shifting the day", () => {
    expect(formatCycleDate("2026-03-29")).toBe("29/03/2026");
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
