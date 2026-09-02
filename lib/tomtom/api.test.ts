import { describe, expect, it } from "vitest";
import {
  geocodeUrl, matrixBody, matrixBodyBetween, matrixUrl, parseGeocode, parseMatrix, parseRoute, routeUrl,
} from "./api";

describe("geocodeUrl", () => {
  it("encodes the query and pins countrySet to GB", () => {
    const url = geocodeUrl("1 Dock Rd, Leeds", "KEY");
    expect(url).toBe(
      "https://api.tomtom.com/search/2/geocode/1%20Dock%20Rd%2C%20Leeds.json?key=KEY&limit=5&countrySet=GB"
    );
  });
});

describe("parseGeocode", () => {
  it("reads the first result's position", () => {
    expect(parseGeocode({ results: [{ position: { lat: 53.8, lon: -1.55 } }] }))
      .toEqual({ lat: 53.8, lng: -1.55 });
  });

  it("returns null for no results or malformed positions", () => {
    expect(parseGeocode({ results: [] })).toBeNull();
    expect(parseGeocode({ results: [{ position: { lat: "53.8" } }] })).toBeNull();
    expect(parseGeocode(null)).toBeNull();
  });
});

describe("routeUrl", () => {
  it("joins lat,lng pairs with colons", () => {
    const url = routeUrl(
      [{ lat: 53.8, lng: -1.55 }, { lat: 53.96, lng: -1.08 }],
      "KEY"
    );
    expect(url).toBe(
      "https://api.tomtom.com/routing/1/calculateRoute/53.8,-1.55:53.96,-1.08/json?key=KEY&travelMode=car&traffic=false&routeRepresentation=polyline"
    );
  });
});

describe("parseRoute", () => {
  const good = {
    routes: [{
      summary: { lengthInMeters: 92_400, travelTimeInSeconds: 9_660 },
      legs: [
        {
          summary: { lengthInMeters: 41_000, travelTimeInSeconds: 3_480 },
          points: [{ latitude: 53.8, longitude: -1.55 }, { latitude: 53.96, longitude: -1.08 }],
        },
        {
          summary: { lengthInMeters: 51_400, travelTimeInSeconds: 6_180 },
          points: [{ latitude: 53.96, longitude: -1.08 }, { latitude: 53.74, longitude: -0.33 }],
        },
      ],
    }],
  };

  it("flattens leg points and keeps per-leg summaries in order", () => {
    const result = parseRoute(good);
    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(4);
    expect(result!.points[0]).toEqual({ lat: 53.8, lng: -1.55 });
    expect(result!.legs).toEqual([
      { distanceMeters: 41_000, travelTimeSeconds: 3_480 },
      { distanceMeters: 51_400, travelTimeSeconds: 6_180 },
    ]);
    expect(result!.totalDistanceMeters).toBe(92_400);
    expect(result!.totalTravelTimeSeconds).toBe(9_660);
  });

  it("returns null for an empty or malformed response", () => {
    expect(parseRoute({ routes: [] })).toBeNull();
    expect(parseRoute(null)).toBeNull();
    expect(parseRoute({ routes: [{ summary: {}, legs: [] }] })).toBeNull();
  });
});

describe("matrixUrl and matrixBody", () => {
  it("builds the v2 sync endpoint and a square origins/destinations body", () => {
    expect(matrixUrl("KEY")).toBe("https://api.tomtom.com/routing/matrix/2?key=KEY");
    const body = matrixBody([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }]);
    expect(body).toEqual({
      origins: [{ point: { latitude: 1, longitude: 2 } }, { point: { latitude: 3, longitude: 4 } }],
      destinations: [{ point: { latitude: 1, longitude: 2 } }, { point: { latitude: 3, longitude: 4 } }],
      options: { travelMode: "car" },
    });
  });

  it("builds distinct origins and destinations for Smart Optimize", () => {
    expect(
      matrixBodyBetween(
        [{ lat: 10, lng: 11 }, { lat: 20, lng: 21 }],
        [{ lat: 30, lng: 31 }, { lat: 40, lng: 41 }]
      )
    ).toEqual({
      origins: [
        { point: { latitude: 10, longitude: 11 } },
        { point: { latitude: 20, longitude: 21 } },
      ],
      destinations: [
        { point: { latitude: 30, longitude: 31 } },
        { point: { latitude: 40, longitude: 41 } },
      ],
      options: { travelMode: "car" },
    });
  });
});

describe("parseMatrix", () => {
  it("places travel times by origin and destination index", () => {
    const json = {
      data: [
        { originIndex: 0, destinationIndex: 0, routeSummary: { travelTimeInSeconds: 12 } },
        { originIndex: 0, destinationIndex: 1, routeSummary: { travelTimeInSeconds: 100 } },
        { originIndex: 1, destinationIndex: 0, routeSummary: { travelTimeInSeconds: 90 } },
        { originIndex: 1, destinationIndex: 1, routeSummary: { travelTimeInSeconds: 15 } },
      ],
    };
    expect(parseMatrix(json, 2)).toEqual([
      [12, 100],
      [90, 15],
    ]);
  });

  it("leaves unreported cells as Infinity so the optimizer avoids them", () => {
    const m = parseMatrix({ data: [] }, 2)!;
    expect(m[0][1]).toBe(Number.POSITIVE_INFINITY);
    expect(m[0][0]).toBe(Number.POSITIVE_INFINITY);
  });

  it("parses rectangular origin/destination matrices", () => {
    const m = parseMatrix(
      {
        data: [
          {
            originIndex: 0,
            destinationIndex: 1,
            routeSummary: { travelTimeInSeconds: 42 },
          },
        ],
      },
      2,
      3
    )!;

    expect(m).toHaveLength(2);
    expect(m[0]).toHaveLength(3);
    expect(m[0][1]).toBe(42);
    expect(m[1][2]).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns null when the response has no data array", () => {
    expect(parseMatrix({}, 2)).toBeNull();
    expect(parseMatrix(null, 2)).toBeNull();
  });
});
