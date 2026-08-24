import { describe, expect, it } from "vitest";
import {
  geocodeQuery,
  normalizeUkPostcode,
  selectGeocodePosition,
} from "./geocoding";

describe("normalizeUkPostcode", () => {
  it("normalizes a standard UK postcode", () => {
    expect(
      normalizeUkPostcode("tn15 9hz"),
    ).toBe("TN15 9HZ");
  });

  it("extracts a postcode from a noisy locality field", () => {
    expect(
      normalizeUkPostcode(
        "IGHTHAM  TN15 9HZ",
      ),
    ).toBe("TN15 9HZ");
  });

  it("returns null when no postcode exists", () => {
    expect(
      normalizeUkPostcode("Ightham"),
    ).toBeNull();
  });
});

describe("geocodeQuery", () => {
  it("uses the clean postcode rather than noisy postcode-field text", () => {
    expect(
      geocodeQuery({
        address_line:
          "H & H UK Limited Celcon House",
        city: "Sevenoaks",
        postcode:
          "IGHTHAM  TN15 9HZ",
      }),
    ).toBe(
      "H & H UK Limited Celcon House, Sevenoaks, TN15 9HZ",
    );
  });
});

describe("selectGeocodePosition", () => {
  const response = {
    results: [
      {
        position: {
          lat: 51.6,
          lon: -3.2,
        },
        address: {
          postalCode: "CF10 1AA",
        },
      },
      {
        position: {
          lat: 51.286,
          lon: 0.285,
        },
        address: {
          postalCode: "TN15 9HZ",
        },
      },
    ],
  };

  it("rejects a plausible candidate with the wrong postcode", () => {
    expect(
      selectGeocodePosition(
        response,
        "TN15 9HZ",
      ),
    ).toEqual({
      lat: 51.286,
      lng: 0.285,
    });
  });

  it("uses the first valid candidate when no postcode is available", () => {
    expect(
      selectGeocodePosition(
        response,
        null,
      ),
    ).toEqual({
      lat: 51.6,
      lng: -3.2,
    });
  });

  it("returns null when every candidate has the wrong postcode", () => {
    expect(
      selectGeocodePosition(
        {
          results: [
            response.results[0],
          ],
        },
        "TN15 9HZ",
      ),
    ).toBeNull();
  });
});