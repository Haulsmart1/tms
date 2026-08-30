import { describe, expect, it } from "vitest";

import {
  metresPerSecondToKph,
  parseDriverLocation,
} from "./location";

function validLocation() {
  return {
    latitude: 53.4808,
    longitude: -2.2426,
    accuracy: 8,
    speedKph: 45,
    heading: 180,
    recordedAt: new Date().toISOString(),
  };
}

describe("parseDriverLocation", () => {
  it("accepts a valid GPS fix", () => {
    expect(parseDriverLocation(validLocation())).toMatchObject({
      latitude: 53.4808,
      longitude: -2.2426,
      accuracy: 8,
      speedKph: 45,
      heading: 180,
    });
  });

  it("accepts coordinate boundaries", () => {
    expect(
      parseDriverLocation({
        ...validLocation(),
        latitude: -90,
        longitude: 180,
      }),
    ).toMatchObject({
      latitude: -90,
      longitude: 180,
    });
  });

  it("rejects invalid latitude", () => {
    expect(() =>
      parseDriverLocation({
        ...validLocation(),
        latitude: 91,
      }),
    ).toThrow("Invalid GPS latitude.");
  });

  it("rejects invalid longitude", () => {
    expect(() =>
      parseDriverLocation({
        ...validLocation(),
        longitude: -181,
      }),
    ).toThrow("Invalid GPS longitude.");
  });

  it("accepts missing optional telemetry", () => {
    expect(
      parseDriverLocation({
        ...validLocation(),
        accuracy: null,
        speedKph: null,
        heading: null,
      }),
    ).toMatchObject({
      accuracy: null,
      speedKph: null,
      heading: null,
    });
  });

  it("rejects negative speed", () => {
    expect(() =>
      parseDriverLocation({
        ...validLocation(),
        speedKph: -1,
      }),
    ).toThrow("Invalid GPS speed.");
  });

  it("rejects invalid heading", () => {
    expect(() =>
      parseDriverLocation({
        ...validLocation(),
        heading: 361,
      }),
    ).toThrow("Invalid GPS heading.");
  });
});

describe("metresPerSecondToKph", () => {
  it("converts browser metres per second to km/h", () => {
    expect(metresPerSecondToKph(10)).toBe(36);
  });

  it("returns null when speed is unavailable", () => {
    expect(metresPerSecondToKph(null)).toBeNull();
  });
});
