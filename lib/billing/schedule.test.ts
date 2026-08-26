import { describe, expect, it } from "vitest";
import {
  addDays,
  computeNextChargeOn,
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
  it("advances one month on the anchor day", () => {
    expect(computeNextChargeOn("2026-08-26", 26)).toBe("2026-09-26");
  });

  it("clamps a 31st anchor into a 30-day month", () => {
    expect(computeNextChargeOn("2026-08-31", 31)).toBe("2026-09-30");
  });

  it("clamps a 31st anchor into February", () => {
    expect(computeNextChargeOn("2027-01-31", 31)).toBe("2027-02-28");
  });

  it("clamps into a leap-year February", () => {
    expect(computeNextChargeOn("2028-01-31", 31)).toBe("2028-02-29");
  });

  it("recovers the anchor day after a clamped month", () => {
    // Charged 28 Feb with a 31 anchor: next charge is 31 March, not 28 March.
    expect(computeNextChargeOn("2027-02-28", 31)).toBe("2027-03-31");
  });

  it("crosses the year boundary", () => {
    expect(computeNextChargeOn("2026-12-15", 15)).toBe("2027-01-15");
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
