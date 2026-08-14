import { describe, it, expect } from "vitest";
import { telemetryTiles, ROUTING_HINT } from "./telemetry";
import type { PositionReading } from "./position";

const NOW = new Date("2026-08-14T12:00:00Z");

function reading(recordedAt: string, speedKph = 81): PositionReading {
  return { vehicleId: "v1", lat: 53.8, lng: -1.5, speedKph, headingDeg: null, recordedAt };
}

describe("telemetryTiles", () => {
  it("always returns the mockup's four slots in order", () => {
    expect(telemetryTiles(null, NOW).map((t) => t.label))
      .toEqual(["Speed", "Distance to go", "Last ping", "ETA"]);
  });

  it("shows No signal for speed and ping when there is no reading", () => {
    const [speed, , ping] = telemetryTiles(null, NOW);
    expect(speed.value).toBe("No signal");
    expect(speed.muted).toBe(true);
    expect(ping.value).toBe("No signal");
  });

  it("never shows a zero speed for a missing fix", () => {
    // A "0 km/h" on a truck that is actually moving is worse than a blank.
    expect(telemetryTiles(null, NOW)[0].value).not.toContain("0");
  });

  it("populates speed and ping from a live reading", () => {
    const [speed, , ping] = telemetryTiles(reading("2026-08-14T11:58:00Z"), NOW);
    expect(speed.value).toBe("81 km/h");
    expect(speed.muted).toBe(false);
    expect(ping.value).toBe("2 min ago");
    expect(ping.muted).toBe(false);
  });

  it("says Stationary rather than 0 km/h for a live but halted vehicle", () => {
    expect(telemetryTiles(reading("2026-08-14T11:58:00Z", 0), NOW)[0].value).toBe("Stationary");
  });

  it("suppresses speed for a stale reading but still reports the ping", () => {
    // An old speed is meaningless. When it was last seen is not.
    const [speed, , ping] = telemetryTiles(reading("2026-08-14T09:00:00Z"), NOW);
    expect(speed.value).toBe("No signal");
    expect(ping.value).toBe("3 h ago");
    expect(ping.muted).toBe(true);
  });

  it("leaves distance and ETA blank in every case, with a hint saying why", () => {
    for (const r of [null, reading("2026-08-14T11:58:00Z"), reading("2026-08-14T09:00:00Z")]) {
      const [, distance, , eta] = telemetryTiles(r, NOW);
      expect(distance.value).toBe("—");
      expect(eta.value).toBe("—");
      expect(distance.hint).toBe(ROUTING_HINT);
      expect(eta.hint).toBe(ROUTING_HINT);
    }
  });
});
