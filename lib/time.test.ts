import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  elapsedMilliseconds,
  isValidIanaTimeZone,
  OPERATOR_TIME_ZONE,
  operatorDay,
  operatorDayInTimeZone,
  resolveTimeZone,
  todayIsoDateInZone,
  utcRegulationWeekStart,
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

describe("resolveTimeZone", () => {
  it("keeps a valid stored zone", () => {
    expect(resolveTimeZone(" Europe/Dublin ")).toEqual({
      timeZone: "Europe/Dublin",
      fallback: false,
      requested: "Europe/Dublin",
    });
  });

  it("falls back to the operator zone and flags an invalid stored zone", () => {
    for (const bad of ["GMT+1x", "London", "Mars/Olympus"]) {
      const result = resolveTimeZone(bad);
      expect(result.timeZone).toBe(OPERATOR_TIME_ZONE);
      expect(result.fallback).toBe(true);
      expect(result.requested).toBe(bad);
    }
  });

  it("does not flag a missing zone as a fallback", () => {
    expect(resolveTimeZone(null).fallback).toBe(false);
    expect(resolveTimeZone("  ").fallback).toBe(false);
    expect(resolveTimeZone(42).timeZone).toBe(OPERATOR_TIME_ZONE);
  });
});

describe("todayIsoDateInZone", () => {
  it("defaults to the operator zone", () => {
    expect(todayIsoDateInZone(undefined, new Date("2026-08-14T23:30:00Z"))).toBe("2026-08-15");
  });

  it("crosses London midnight correctly around the spring-forward change", () => {
    // 2026-03-29 01:00 UTC is when London moves to BST.
    expect(todayIsoDateInZone("Europe/London", new Date("2026-03-28T23:59:00Z"))).toBe("2026-03-28");
    expect(todayIsoDateInZone("Europe/London", new Date("2026-03-29T00:30:00Z"))).toBe("2026-03-29");
    expect(todayIsoDateInZone("Europe/London", new Date("2026-03-29T22:59:00Z"))).toBe("2026-03-29");
    expect(todayIsoDateInZone("Europe/London", new Date("2026-03-29T23:00:00Z"))).toBe("2026-03-30");
  });

  it("crosses London midnight correctly around the autumn fall-back change", () => {
    // 2026-10-25 01:00 UTC is when London returns to GMT.
    expect(todayIsoDateInZone("Europe/London", new Date("2026-10-24T22:59:00Z"))).toBe("2026-10-24");
    expect(todayIsoDateInZone("Europe/London", new Date("2026-10-24T23:00:00Z"))).toBe("2026-10-25");
    expect(todayIsoDateInZone("Europe/London", new Date("2026-10-25T23:59:00Z"))).toBe("2026-10-25");
    expect(todayIsoDateInZone("Europe/London", new Date("2026-10-26T00:00:00Z"))).toBe("2026-10-26");
  });

  it("uses another zone when asked", () => {
    expect(todayIsoDateInZone("Europe/Paris", new Date("2026-08-14T22:30:00Z"))).toBe("2026-08-15");
  });

  it("falls back to the operator zone rather than throwing on a bad zone", () => {
    expect(todayIsoDateInZone("Not/AZone", new Date("2026-08-14T23:30:00Z"))).toBe("2026-08-15");
  });
});

describe("calendarDaysBetween", () => {
  it("counts whole days across the autumn clock change", () => {
    expect(calendarDaysBetween("2026-10-20", "2026-10-27")).toBe(7);
  });

  it("counts whole days across the spring clock change", () => {
    expect(calendarDaysBetween("2026-03-25", "2026-04-01")).toBe(7);
  });

  it("is negative for past dates and null for invalid ones", () => {
    expect(calendarDaysBetween("2026-09-03", "2026-08-31")).toBe(-3);
    expect(calendarDaysBetween("2026-09-03", "2026-02-30")).toBeNull();
    expect(calendarDaysBetween("2026-09-03", "nope")).toBeNull();
  });
});

describe("utcRegulationWeekStart", () => {
  it("is Monday 00:00 UTC, not London Monday midnight, during BST", () => {
    // Sunday 23:30 UTC is already Monday 00:30 in London, but still the old UTC week.
    expect(utcRegulationWeekStart(new Date("2026-09-13T23:30:00Z")).toISOString()).toBe(
      "2026-09-07T00:00:00.000Z",
    );
    expect(utcRegulationWeekStart(new Date("2026-09-14T00:00:00Z")).toISOString()).toBe(
      "2026-09-14T00:00:00.000Z",
    );
  });
});
