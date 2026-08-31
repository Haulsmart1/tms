import { describe, expect, it } from "vitest";
import {
  elapsedMilliseconds,
  isValidIanaTimeZone,
  OPERATOR_TIME_ZONE,
  operatorDay,
  operatorDayInTimeZone,
} from "./time";

describe("operatorDay", () => {
  it("returns the London day after the BST midnight boundary", () => {
    expect(operatorDay(new Date("2026-08-14T23:30:00Z"))).toBe("2026-08-15");
  });

  it("returns the London day before the BST midnight boundary", () => {
    expect(operatorDay(new Date("2026-08-14T22:30:00Z"))).toBe("2026-08-14");
  });

  it("agrees with UTC in winter", () => {
    expect(operatorDay(new Date("2026-01-14T23:30:00Z"))).toBe("2026-01-14");
  });

  it("zero-pads to YYYY-MM-DD", () => {
    expect(operatorDay(new Date("2026-01-05T09:00:00Z"))).toBe("2026-01-05");
  });
});

describe("operatorDayInTimeZone", () => {
  it("accepts a tenant IANA timezone", () => {
    expect(
      operatorDayInTimeZone(
        new Date("2026-08-14T23:30:00Z"),
        "Europe/London",
      ),
    ).toBe("2026-08-15");
  });

  it("supports a timezone different from the operator fallback", () => {
    expect(
      operatorDayInTimeZone(
        new Date("2026-08-15T02:30:00Z"),
        "America/New_York",
      ),
    ).toBe("2026-08-14");
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() =>
      operatorDayInTimeZone(new Date(), "Not/A_Timezone"),
    ).toThrow(RangeError);
  });
});

describe("isValidIanaTimeZone", () => {
  it("recognises valid and invalid zones", () => {
    expect(isValidIanaTimeZone("Europe/London")).toBe(true);
    expect(isValidIanaTimeZone("UTC")).toBe(true);
    expect(isValidIanaTimeZone("")).toBe(false);
    expect(isValidIanaTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("elapsedMilliseconds", () => {
  it("uses absolute instants across the autumn DST rollback", () => {
    expect(
      elapsedMilliseconds(
        new Date("2026-10-25T00:30:00Z"),
        new Date("2026-10-25T02:30:00Z"),
      ),
    ).toBe(2 * 60 * 60 * 1000);
  });

  it("uses absolute instants across the spring DST change", () => {
    expect(
      elapsedMilliseconds(
        new Date("2026-03-29T00:30:00Z"),
        new Date("2026-03-29T02:30:00Z"),
      ),
    ).toBe(2 * 60 * 60 * 1000);
  });

  it("rejects reversed periods", () => {
    expect(() =>
      elapsedMilliseconds(
        new Date("2026-08-14T11:00:00Z"),
        new Date("2026-08-14T10:00:00Z"),
      ),
    ).toThrow(RangeError);
  });
});

describe("OPERATOR_TIME_ZONE", () => {
  it("remains Europe/London as the current fallback", () => {
    expect(OPERATOR_TIME_ZONE).toBe("Europe/London");
  });
});
