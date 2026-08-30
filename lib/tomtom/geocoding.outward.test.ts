import { describe, expect, it } from "vitest";

import { selectGeocodePosition } from "./geocoding";

function tomTomResult(
  postalCode: string,
  countryCode: string,
) {
  return {
    results: [
      {
        position: {
          lat: 53,
          lon: -2,
        },
        address: {
          postalCode,
          countryCode,
        },
      },
    ],
  };
}

describe("TomTom outward postcode matching", () => {
  it("accepts the expected GB outward code when explicitly enabled", () => {
    expect(
      selectGeocodePosition(
        tomTomResult("CW5", "GB"),
        "CW5 8JT",
        true,
      ),
    ).toEqual({
      lat: 53,
      lng: -2,
    });
  });

  it("keeps outward-code matching disabled by default", () => {
    expect(
      selectGeocodePosition(
        tomTomResult("CW5", "GB"),
        "CW5 8JT",
      ),
    ).toBeNull();
  });

  it("rejects a different outward code", () => {
    expect(
      selectGeocodePosition(
        tomTomResult("CW4", "GB"),
        "CW5 8JT",
        true,
      ),
    ).toBeNull();
  });

  it("rejects an outward-only candidate outside GB", () => {
    expect(
      selectGeocodePosition(
        tomTomResult("CW5", "FR"),
        "CW5 8JT",
        true,
      ),
    ).toBeNull();
  });

  it("continues to accept an exact full postcode", () => {
    expect(
      selectGeocodePosition(
        tomTomResult("CW5 8JT", "GB"),
        "CW5 8JT",
      ),
    ).toEqual({
      lat: 53,
      lng: -2,
    });
  });
});
