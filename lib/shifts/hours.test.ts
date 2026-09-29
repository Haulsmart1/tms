import { describe, expect, it } from "vitest";
import { formatMinutes, summariseShift, validateBreakEnd, validateBreakStart } from "./hours";

const now = new Date("2026-09-29T18:00:00Z");

describe("summariseShift", () => {
  it("computes duty, breaks, worked and mileage for a closed shift", () => {
    const s = summariseShift(
      {
        startedAt: "2026-09-29T05:00:00Z",
        endedAt: "2026-09-29T14:12:00Z",
        breaks: [
          { startedAt: "2026-09-29T09:00:00Z", endedAt: "2026-09-29T09:30:00Z" },
          { startedAt: "2026-09-29T12:00:00Z", endedAt: "2026-09-29T12:15:00Z" },
        ],
        periods: [
          { startOdometer: 1000, endOdometer: 1100 },
          { startOdometer: 5000, endOdometer: 5050 },
        ],
      },
      now,
    );
    expect(s).toEqual({ dutyMinutes: 552, breakMinutes: 45, workedMinutes: 507, mileage: 150, flags: [] });
  });

  it("uses now for an open shift and an open break", () => {
    const s = summariseShift(
      { startedAt: "2026-09-29T17:00:00Z", endedAt: null, breaks: [{ startedAt: "2026-09-29T17:40:00Z", endedAt: null }], periods: [{ startOdometer: 10, endOdometer: null }] },
      now,
    );
    expect(s).toEqual({ dutyMinutes: 60, breakMinutes: 20, workedMinutes: 40, mileage: null, flags: [] });
  });

  it("counts real elapsed time across the October clock change", () => {
    // 00:30 BST (23:30Z) to 05:30 GMT (05:30Z) is six hours, not five.
    const s = summariseShift({ startedAt: "2026-10-25T00:30:00+01:00", endedAt: "2026-10-25T05:30:00Z", breaks: [], periods: [] }, now);
    expect(s.dutyMinutes).toBe(360);
  });

  it("counts real elapsed time across the March clock change", () => {
    const s = summariseShift({ startedAt: "2026-03-29T00:30:00Z", endedAt: "2026-03-29T05:30:00+01:00", breaks: [], periods: [] }, now);
    expect(s.dutyMinutes).toBe(240);
  });

  it("flags long duty and a stale open shift", () => {
    const long = summariseShift({ startedAt: "2026-09-29T04:00:00Z", endedAt: "2026-09-29T17:30:00Z", breaks: [], periods: [] }, now);
    expect(long.flags).toEqual(["over_13h"]);
    const stale = summariseShift({ startedAt: "2026-09-28T20:00:00Z", endedAt: null, breaks: [], periods: [] }, now);
    expect(stale.flags).toEqual(["over_13h", "open_over_16h"]);
  });

  it("flags an odometer that went backwards and reports no mileage", () => {
    const s = summariseShift({ startedAt: "2026-09-29T05:00:00Z", endedAt: "2026-09-29T06:00:00Z", breaks: [], periods: [{ startOdometer: 500, endOdometer: 400 }] }, now);
    expect(s.mileage).toBeNull();
    expect(s.flags).toContain("odometer_decrease");
  });

  it("clamps a break that runs past the shift end", () => {
    const s = summariseShift(
      { startedAt: "2026-09-29T05:00:00Z", endedAt: "2026-09-29T06:00:00Z", breaks: [{ startedAt: "2026-09-29T05:30:00Z", endedAt: "2026-09-29T07:00:00Z" }], periods: [] },
      now,
    );
    expect(s.breakMinutes).toBe(30);
  });
});

describe("validateBreakStart", () => {
  const shift = { startedAt: "2026-09-29T05:00:00Z", endedAt: null, breaks: [{ startedAt: "2026-09-29T08:00:00Z", endedAt: "2026-09-29T08:30:00Z" }] };

  it("accepts a break after the last one", () => {
    expect(validateBreakStart(shift, "2026-09-29T10:00:00Z")).toEqual({ ok: true });
  });

  it("refuses before the shift, inside an earlier break, while one runs, or after the shift ended", () => {
    expect(validateBreakStart(shift, "2026-09-29T04:00:00Z").ok).toBe(false);
    expect(validateBreakStart(shift, "2026-09-29T08:10:00Z").ok).toBe(false);
    expect(validateBreakStart({ ...shift, breaks: [{ startedAt: "2026-09-29T09:00:00Z", endedAt: null }] }, "2026-09-29T10:00:00Z").ok).toBe(false);
    expect(validateBreakStart({ ...shift, endedAt: "2026-09-29T09:00:00Z" }, "2026-09-29T10:00:00Z").ok).toBe(false);
  });
});

describe("validateBreakEnd", () => {
  it("needs a running break and a later time", () => {
    expect(validateBreakEnd(null, "2026-09-29T10:00:00Z").ok).toBe(false);
    expect(validateBreakEnd({ startedAt: "2026-09-29T10:00:00Z", endedAt: null }, "2026-09-29T09:59:00Z").ok).toBe(false);
    expect(validateBreakEnd({ startedAt: "2026-09-29T10:00:00Z", endedAt: null }, "2026-09-29T10:45:00Z")).toEqual({ ok: true });
  });
});

describe("formatMinutes", () => {
  it("formats hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0h 00m");
    expect(formatMinutes(552)).toBe("9h 12m");
  });
});
