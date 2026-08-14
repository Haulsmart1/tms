import { describe, it, expect } from "vitest";
import {
  normaliseTimestamp,
  readingAgeMinutes,
  signalState,
  isLive,
  pingLabel,
  speedLabel,
  STALE_AFTER_MINUTES,
  type PositionReading,
} from "./position";

const NOW = new Date("2026-08-14T12:00:00Z");

function reading(recordedAt: string, speedKph = 80): PositionReading {
  return { vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph, headingDeg: null, recordedAt };
}

describe("normaliseTimestamp", () => {
  it("appends Z to a naive stamp, because the column is stored in UTC", () => {
    // telematics_positions.recorded_at is `timestamp without time zone`, so
    // Supabase returns no offset and new Date() would read it as local time.
    expect(normaliseTimestamp("2026-08-14T09:41:00")).toBe("2026-08-14T09:41:00Z");
  });

  it("leaves a stamp that already carries Z alone", () => {
    expect(normaliseTimestamp("2026-08-14T09:41:00Z")).toBe("2026-08-14T09:41:00Z");
  });

  it("leaves a stamp that already carries a numeric offset alone", () => {
    expect(normaliseTimestamp("2026-08-14T09:41:00+01:00")).toBe("2026-08-14T09:41:00+01:00");
  });

  it("leaves a stamp with a two-digit offset and no minutes alone", () => {
    // Postgres emits +01 rather than +01:00 when the offset has zero minutes.
    expect(normaliseTimestamp("2026-08-14T09:41:00+01")).toBe("2026-08-14T09:41:00+01");
  });

  it("leaves a stamp with a negative two-digit offset alone", () => {
    expect(normaliseTimestamp("2026-08-14T09:41:00-05")).toBe("2026-08-14T09:41:00-05");
  });
});

describe("readingAgeMinutes", () => {
  it("returns elapsed minutes", () => {
    expect(readingAgeMinutes(reading("2026-08-14T11:45:00Z"), NOW)).toBeCloseTo(15, 5);
  });

  it("parses a naive stamp as UTC rather than local", () => {
    expect(readingAgeMinutes(reading("2026-08-14T11:45:00"), NOW)).toBeCloseTo(15, 5);
  });

  it("returns null for an unparseable stamp rather than NaN", () => {
    expect(readingAgeMinutes(reading("not-a-date"), NOW)).toBeNull();
  });
});

describe("signalState", () => {
  it("is none with no reading at all", () => {
    expect(signalState(null, NOW)).toBe("none");
  });

  it("is live under the threshold", () => {
    expect(signalState(reading("2026-08-14T11:55:00Z"), NOW)).toBe("live");
  });

  it("is live at exactly the threshold, so the boundary is not double-counted", () => {
    // Matches isPodOverdue in lib/pod/overdue.ts, which is also false at
    // exactly its threshold. One convention across the codebase.
    expect(signalState(reading("2026-08-14T11:50:00Z"), NOW)).toBe("live");
  });

  it("is stale past the threshold", () => {
    expect(signalState(reading("2026-08-14T11:49:00Z"), NOW)).toBe("stale");
  });

  it("is none for an unparseable stamp, because an unreadable fix is not a fix", () => {
    expect(signalState(reading("not-a-date"), NOW)).toBe("none");
  });

  it("is stale when the reading is far enough in the future to be a broken clock", () => {
    // 5 minutes ahead exceeds FUTURE_TOLERANCE_MINUTES. Reporting "live" here
    // would pin a green pill to a vehicle that may not have reported in days.
    expect(signalState(reading("2026-08-14T12:05:00Z"), NOW)).toBe("stale");
  });
});

describe("isLive", () => {
  it("is true only for a live reading", () => {
    expect(isLive(reading("2026-08-14T11:55:00Z"), NOW)).toBe(true);
    expect(isLive(reading("2026-08-14T09:00:00Z"), NOW)).toBe(false);
    expect(isLive(null, NOW)).toBe(false);
  });
});

describe("pingLabel", () => {
  it("says No GPS when there is no reading", () => {
    expect(pingLabel(null, NOW)).toBe("No GPS");
  });

  it("says just now under a minute", () => {
    expect(pingLabel(reading("2026-08-14T11:59:30Z"), NOW)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(pingLabel(reading("2026-08-14T11:45:00Z"), NOW)).toBe("15 min ago");
    expect(pingLabel(reading("2026-08-14T09:00:00Z"), NOW)).toBe("3 h ago");
    expect(pingLabel(reading("2026-08-12T12:00:00Z"), NOW)).toBe("2 d ago");
  });

  it("reads 1 h ago at exactly 60 minutes", () => {
    expect(pingLabel(reading("2026-08-14T11:00:00Z"), NOW)).toBe("1 h ago");
  });

  it("reads 1 d ago at exactly 1440 minutes", () => {
    expect(pingLabel(reading("2026-08-13T12:00:00Z"), NOW)).toBe("1 d ago");
  });

  it("says clock ahead when the reading is far enough in the future to be a broken clock", () => {
    expect(pingLabel(reading("2026-08-14T12:05:00Z"), NOW)).toBe("clock ahead");
  });
});

describe("speedLabel", () => {
  const AT = "2026-08-14T11:58:00Z";

  it("rounds and formats a real speed", () => {
    expect(speedLabel(reading(AT, 80.6))).toBe("81 km/h");
  });

  it("says Stationary at exactly zero", () => {
    expect(speedLabel(reading(AT, 0))).toBe("Stationary");
  });

  it("says Stationary at 0.4, NOT 0 km/h", () => {
    // GPS jitter on a parked truck reports small nonzero speeds constantly, so
    // this is the most likely reading for a stationary vehicle. 0.4 > 0 is
    // true but Math.round(0.4) is 0, which is why the guard is on the rounded
    // value: "0 km/h" is the one string this vocabulary exists to prevent.
    expect(speedLabel(reading(AT, 0.4))).toBe("Stationary");
  });

  it("returns null for a negative speed, because that is garbage, not a parked truck", () => {
    // "Stationary" is a positive claim about where a vehicle is. A negative
    // speed is unusable data, so it takes the same treatment as NaN: report
    // unknown rather than assert something the source did not support.
    expect(speedLabel(reading(AT, -5))).toBeNull();
  });

  it("returns null for a small negative speed too, since the guard is on the rounded value", () => {
    // -0.4 rounds to -0 in JavaScript, and -0 < 0 is false. Math.round(-0.6)
    // is -1, which does trip the guard. Both must land on null rather than one
    // of them slipping through as "Stationary".
    expect(speedLabel(reading(AT, -0.6))).toBeNull();
  });

  it("returns null for a non-finite speed, so callers can word unknown themselves", () => {
    // NaN > 0 is false, so the naive expression would call a moving vehicle
    // "Stationary": a confident assertion rather than a figure to discount.
    expect(speedLabel(reading(AT, Number.NaN))).toBeNull();
  });
});

describe("STALE_AFTER_MINUTES", () => {
  it("is 10", () => {
    expect(STALE_AFTER_MINUTES).toBe(10);
  });
});
