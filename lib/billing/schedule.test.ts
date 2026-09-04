import { describe, expect, it } from "vitest";
import {
  addDays,
  computeNextChargeOn,
  CYCLE_DAYS,
  londonDateISO,
  nextRetryOn,
} from "./schedule";

describe("londonDateISO", () => {
  it("formats a UTC instant as a London calendar date", () => {
    expect(londonDateISO(new Date("2026-08-26T10:00:00Z"))).toBe("2026-08-26");
  });

  it("rolls to the next day when London (BST) is ahead of UTC at midnight", () => {
    // 23:30 UTC in August is 00:30 next day in London.
    expect(londonDateISO(new Date("2026-08-26T23:30:00Z"))).toBe("2026-08-27");
  });

  it("matches UTC in winter (GMT)", () => {
    expect(londonDateISO(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-15");
  });
});

describe("addDays", () => {
  it("adds days within a month", () => {
    expect(addDays("2026-08-01", 2)).toBe("2026-08-03");
  });

  it("crosses month boundaries", () => {
    expect(addDays("2026-08-30", 4)).toBe("2026-09-03");
  });
});

describe("computeNextChargeOn", () => {
  it("advances a fixed 28 days", () => {
    expect(CYCLE_DAYS).toBe(28);
    expect(computeNextChargeOn("2026-08-26")).toBe("2026-09-23");
  });

  it("crosses a month boundary", () => {
    expect(computeNextChargeOn("2026-09-20")).toBe("2026-10-18");
  });

  it("crosses the year boundary", () => {
    expect(computeNextChargeOn("2026-12-15")).toBe("2027-01-12");
  });

  it("crosses a 28-day February", () => {
    expect(computeNextChargeOn("2027-02-10")).toBe("2027-03-10");
  });

  it("crosses a leap-year February", () => {
    expect(computeNextChargeOn("2028-02-10")).toBe("2028-03-09");
  });

  // 28 days is exactly 4 weeks, so the billing weekday never drifts. This is
  // the property that replaced anchor-day clamping.
  it("keeps successive cycles exactly 28 days apart", () => {
    const first = computeNextChargeOn("2026-08-26");
    const second = computeNextChargeOn(first);
    expect(second).toBe(addDays("2026-08-26", 56));
  });
});

describe("nextRetryOn", () => {
  // Attempts land on days 1, 3, 5, 7 of the cycle: retry two days after the
  // cycle date per failed attempt.
  it("schedules the second attempt two days after the cycle date", () => {
    expect(nextRetryOn("2026-08-26", 1)).toBe("2026-08-28");
  });

  it("schedules the third attempt four days after the cycle date", () => {
    expect(nextRetryOn("2026-08-26", 2)).toBe("2026-08-30");
  });

  it("schedules the fourth attempt six days after the cycle date", () => {
    expect(nextRetryOn("2026-08-26", 3)).toBe("2026-09-01");
  });

  it("returns null after the fourth failure (dunning exhausted)", () => {
    expect(nextRetryOn("2026-08-26", 4)).toBeNull();
  });
});
