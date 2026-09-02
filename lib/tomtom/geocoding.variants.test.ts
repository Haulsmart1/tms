import { describe, expect, it } from "vitest";

import {
  geocodeQueryVariants,
} from "./geocoding";

describe("TomTom geocode query variants", () => {
  it("keeps the original full query first", () => {
    expect(
      geocodeQueryVariants({
        address_line:
          "7 Parkside Barns, Wrenbury Road",
        city: "Nantwich",
        postcode: "CW5 8JT",
      })[0],
    ).toBe(
      "7 Parkside Barns, Wrenbury Road, Nantwich, CW5 8JT",
    );
  });

  it("removes a leading business name", () => {
    expect(
      geocodeQueryVariants({
        address_line:
          "Cambridge Audio Service, Unit 506 Phoenix Industrial Estate",
        city: "Nantwich",
        postcode: "CW5 8JT",
      }),
    ).toContain(
      "Unit 506 Phoenix Industrial Estate, Nantwich, CW5 8JT",
    );
  });

  it("adds a unit-free estate query", () => {
    expect(
      geocodeQueryVariants({
        address_line:
          "Cambridge Audio Service, Unit 506 Phoenix Industrial Estate",
        city: "Nantwich",
        postcode: "CW5 8JT",
      }),
    ).toContain(
      "Phoenix Industrial Estate, Nantwich, CW5 8JT",
    );
  });

  it("keeps a simple single-part address unchanged", () => {
    expect(
      geocodeQueryVariants({
        address_line: "10 High Street",
        city: "Nantwich",
        postcode: "CW5 5AA",
      }),
    ).toEqual([
      "10 High Street, Nantwich, CW5 5AA",
    ]);
  });

  it("does not produce duplicate queries", () => {
    const queries =
      geocodeQueryVariants({
        address_line:
          "Business, Business",
        city: "Nantwich",
        postcode: "CW5 8JT",
      });

    expect(
      new Set(queries).size,
    ).toBe(queries.length);
  });
});
