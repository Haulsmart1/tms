import { describe, expect, it } from "vitest";

import {
  selectUkPostcodePosition,
} from "./geocoding";

describe("UK postcode coordinate fallback", () => {
  it("accepts coordinates only when the full postcode matches", () => {
    expect(
      selectUkPostcodePosition(
        {
          result: {
            postcode: "CW5 8JT",
            latitude: 53.0123,
            longitude: -2.6123,
          },
        },
        "CW5 8JT",
      ),
    ).toEqual({
      lat: 53.0123,
      lng: -2.6123,
    });
  });

  it("normalizes postcode spacing and casing before comparison", () => {
    expect(
      selectUkPostcodePosition(
        {
          result: {
            postcode: "cw5 8jt",
            latitude: 53.0123,
            longitude: -2.6123,
          },
        },
        "CW58JT",
      ),
    ).toEqual({
      lat: 53.0123,
      lng: -2.6123,
    });
  });

  it("rejects an outward-code-only response", () => {
    expect(
      selectUkPostcodePosition(
        {
          result: {
            postcode: "CW5",
            latitude: 53.01,
            longitude: -2.61,
          },
        },
        "CW5 8JT",
      ),
    ).toBeNull();
  });

  it("rejects a different full postcode", () => {
    expect(
      selectUkPostcodePosition(
        {
          result: {
            postcode: "CW5 8JS",
            latitude: 53.01,
            longitude: -2.61,
          },
        },
        "CW5 8JT",
      ),
    ).toBeNull();
  });

  it("rejects malformed or non-finite coordinates", () => {
    expect(
      selectUkPostcodePosition(
        {
          result: {
            postcode: "CW5 8JT",
            latitude: Number.NaN,
            longitude: -2.61,
          },
        },
        "CW5 8JT",
      ),
    ).toBeNull();

    expect(
      selectUkPostcodePosition(
        {
          result: null,
        },
        "CW5 8JT",
      ),
    ).toBeNull();
  });
});
