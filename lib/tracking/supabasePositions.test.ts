import { describe, expect, it } from "vitest";
import type { PositionReading } from "./position";
import { firstPerVehicle, mergeLatestReadings } from "./supabasePositions";

function reading(vehicleId: string, recordedAt: string, lat = 53): PositionReading {
  return { vehicleId, lat, lng: -1, speedKph: 0, headingDeg: null, recordedAt };
}

describe("mergeLatestReadings (PLAN-14)", () => {
  it("keeps vehicles that appear in only one source", () => {
    const merged = mergeLatestReadings(
      new Map([["v1", reading("v1", "2026-09-14T10:00:00Z")]]),
      new Map([["v2", reading("v2", "2026-09-14T09:00:00Z")]]),
    );

    expect([...merged.keys()].sort()).toEqual(["v1", "v2"]);
  });

  it("prefers the newer fix per vehicle and the primary source on a tie", () => {
    const merged = mergeLatestReadings(
      new Map([
        ["v1", reading("v1", "2026-09-14T08:00:00Z", 1)],
        ["v2", reading("v2", "2026-09-14T08:00:00Z", 1)],
      ]),
      new Map([
        ["v1", reading("v1", "2026-09-14T09:00:00+00:00", 2)],
        ["v2", reading("v2", "2026-09-14T08:00:00Z", 2)],
      ]),
    );

    expect(merged.get("v1")?.lat).toBe(2);
    expect(merged.get("v2")?.lat).toBe(1);
  });
});

describe("firstPerVehicle", () => {
  it("skips null coordinates instead of pinning the vehicle at 0,0", () => {
    const out = firstPerVehicle([
      { vehicle_id: "v1", latitude: null, longitude: null, speed: null, recorded_at: "2026-09-14T10:00:00" },
      { vehicle_id: "v1", latitude: "53.1", longitude: "-1.2", speed: null, recorded_at: "2026-09-14T09:00:00" },
    ]);

    expect(out.get("v1")?.lat).toBe(53.1);
    expect(out.get("v1")?.recordedAt).toBe("2026-09-14T09:00:00Z");
  });
});
