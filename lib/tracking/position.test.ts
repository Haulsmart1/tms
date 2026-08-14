import { describe, it, expect } from "vitest";
import {
  normaliseTimestamp,
  readingAgeMinutes,
  signalState,
  isLive,
  pingLabel,
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
});

describe("STALE_AFTER_MINUTES", () => {
  it("is 10", () => {
    expect(STALE_AFTER_MINUTES).toBe(10);
  });
});
