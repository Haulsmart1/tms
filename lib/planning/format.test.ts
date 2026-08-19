import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration } from "./format";

describe("formatDistance", () => {
  it("renders kilometres to one decimal", () => {
    expect(formatDistance(92_400)).toBe("92.4 km");
  });

  it("renders short hops in metres", () => {
    expect(formatDistance(850)).toBe("850 m");
  });

  it("drops a trailing .0", () => {
    expect(formatDistance(92_000)).toBe("92 km");
  });

  it("rounds before choosing the unit, so 999.9 m does not render as 1000 m", () => {
    expect(formatDistance(999.9)).toBe("1 km");
  });

  it("renders non-finite or negative input as the absent-value marker", () => {
    expect(formatDistance(Number.NaN)).toBe("-");
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatDistance(-5)).toBe("-");
  });
});

describe("formatDuration", () => {
  it("renders hours and minutes", () => {
    expect(formatDuration(9_660)).toBe("2 h 41 m");
  });

  it("renders minutes only under an hour", () => {
    expect(formatDuration(1_740)).toBe("29 m");
  });

  it("rounds seconds to the nearest minute and never shows 0 m for a real trip", () => {
    expect(formatDuration(29)).toBe("1 m");
  });

  it("renders non-finite or negative input as the absent-value marker", () => {
    expect(formatDuration(Number.NaN)).toBe("-");
    expect(formatDuration(-1)).toBe("-");
  });
});
