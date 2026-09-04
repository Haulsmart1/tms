import { describe, expect, it, vi } from "vitest";
import {
  buildDriverTravelMatrix,
  type TravelCostLoader,
  type TravelMatrixLocation,
} from "./travelMatrix";

function location(
  id: string,
  lat: number,
  lng: number,
): TravelMatrixLocation {
  return {
    id,
    point: { lat, lng },
  };
}

function directedLoader(): TravelCostLoader {
  return async (origins, destinations) =>
    origins.map((origin) =>
      destinations.map((destination) =>
        origin.lat * 1000 +
        origin.lng * 100 +
        destination.lat * 10 +
        destination.lng
      )
    );
}

describe("buildDriverTravelMatrix", () => {
  it("preserves directed asymmetric travel costs", async () => {
    const matrix = await buildDriverTravelMatrix(
      [
        location("a", 1, 1),
        location("b", 2, 2),
      ],
      directedLoader(),
    );

    expect(matrix).not.toBeNull();
    expect(matrix?.travelSecondsBetween("a", "b")).toBe(1122);
    expect(matrix?.travelSecondsBetween("b", "a")).toBe(2211);
  });

  it("returns zero for the same location id", async () => {
    const matrix = await buildDriverTravelMatrix(
      [location("a", 1, 1)],
      directedLoader(),
    );

    expect(matrix?.travelSecondsBetween("a", "a")).toBe(0);
  });

  it("preserves distinct ids sharing one physical coordinate", async () => {
    const loader = vi.fn(directedLoader());

    const matrix = await buildDriverTravelMatrix(
      [
        location("collection", 1, 1),
        location("delivery", 1, 1),
        location("other", 2, 2),
      ],
      loader,
    );

    expect(matrix).not.toBeNull();
    expect(
      matrix?.travelSecondsBetween(
        "collection",
        "delivery",
      ),
    ).toBe(0);
    expect(
      matrix?.travelSecondsBetween(
        "delivery",
        "collection",
      ),
    ).toBe(0);

    for (const [origins, destinations] of loader.mock.calls) {
      expect(origins).toHaveLength(2);
      expect(destinations).toHaveLength(2);
    }
  });

  it("keeps every matrix request within 100 cells", async () => {
    const locations = Array.from(
      { length: 23 },
      (_, index) =>
        location(
          `location-${index}`,
          50 + index / 100,
          -3 - index / 100,
        ),
    );

    const loader = vi.fn(async (origins, destinations) =>
      origins.map(() =>
        destinations.map(() => 1)
      )
    );

    const matrix = await buildDriverTravelMatrix(
      locations,
      loader,
    );

    expect(matrix).not.toBeNull();

    for (const [origins, destinations] of loader.mock.calls) {
      expect(
        origins.length * destinations.length,
      ).toBeLessThanOrEqual(100);
    }
  });

  it("rejects a malformed matrix row count", async () => {
    const matrix = await buildDriverTravelMatrix(
      [
        location("a", 1, 1),
        location("b", 2, 2),
      ],
      async () => [[0, 1]],
    );

    expect(matrix).toBeNull();
  });

  it("rejects a malformed matrix column count", async () => {
    const matrix = await buildDriverTravelMatrix(
      [
        location("a", 1, 1),
        location("b", 2, 2),
      ],
      async (origins) =>
        origins.map(() => [0]),
    );

    expect(matrix).toBeNull();
  });

  it.each([
    ["null", null],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -1],
  ])(
    "rejects an invalid %s travel cell",
    async (_label, invalid) => {
      const matrix = await buildDriverTravelMatrix(
        [
          location("a", 1, 1),
          location("b", 2, 2),
        ],
        async (origins, destinations) =>
          origins.map((origin) =>
            destinations.map((destination) => {
              if (
                origin.lat === destination.lat &&
                origin.lng === destination.lng
              ) {
                return 0;
              }

              return invalid as number;
            })
          ),
      );

      expect(matrix).toBeNull();
    },
  );

  it("returns null when the loader throws", async () => {
    const matrix = await buildDriverTravelMatrix(
      [
        location("a", 1, 1),
        location("b", 2, 2),
      ],
      async () => {
        throw new Error("routing unavailable");
      },
    );

    expect(matrix).toBeNull();
  });

  it("rejects duplicate ids", async () => {
    const loader = vi.fn(directedLoader());

    const matrix = await buildDriverTravelMatrix(
      [
        location("same", 1, 1),
        location("same", 2, 2),
      ],
      loader,
    );

    expect(matrix).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("rejects empty ids and invalid coordinates", async () => {
    const loader = vi.fn(directedLoader());

    expect(
      await buildDriverTravelMatrix(
        [location("", 1, 1)],
        loader,
      ),
    ).toBeNull();

    expect(
      await buildDriverTravelMatrix(
        [location("bad", Number.NaN, 1)],
        loader,
      ),
    ).toBeNull();

    expect(loader).not.toHaveBeenCalled();
  });

  it("returns null for unknown ids", async () => {
    const matrix = await buildDriverTravelMatrix(
      [
        location("a", 1, 1),
        location("b", 2, 2),
      ],
      directedLoader(),
    );

    expect(
      matrix?.travelSecondsBetween("missing", "a"),
    ).toBeNull();
    expect(
      matrix?.travelSecondsBetween("a", "missing"),
    ).toBeNull();
  });

  it("does not mutate locations or points", async () => {
    const locations = [
      location("a", 1, 1),
      location("b", 2, 2),
    ];
    const before = JSON.stringify(locations);

    await buildDriverTravelMatrix(
      locations,
      async (origins, destinations) => {
        origins[0].lat = 999;
        destinations[0].lng = 999;

        return origins.map(() =>
          destinations.map(() => 1)
        );
      },
    );

    expect(JSON.stringify(locations)).toBe(before);
  });
});
