import { describe, expect, it } from "vitest";
import { sanitizeTravelSeconds } from "./matrix";
import { parseMatrix } from "../tomtom/api";

describe("sanitizeTravelSeconds", () => {
  it("restores Infinity for the nulls JSON serialization produces", () => {
    /* The zero is reported by the API rather than taken from the diagonal.
       parseMatrix no longer zero-fills i === i, because origins and
       destinations can be different places in a rectangular matrix, so a
       diagonal zero would claim a hop between two distinct stops is free.
       A genuine zero still has to survive the round trip: JSON leaves it as 0
       while it turns Infinity into null, and sanitize must not confuse them. */
    const served = parseMatrix(
      {
        data: [
          { originIndex: 0, destinationIndex: 0, routeSummary: { travelTimeInSeconds: 0 } },
          { originIndex: 0, destinationIndex: 1, routeSummary: { travelTimeInSeconds: 100 } },
        ],
      },
      2
    );
    // The exact boundary the API response crosses:
    const wire = JSON.parse(JSON.stringify({ travelSeconds: served }));
    const restored = sanitizeTravelSeconds(wire.travelSeconds, 2)!;
    expect(restored[0][1]).toBe(100);
    expect(restored[1][0]).toBe(Number.POSITIVE_INFINITY);
    expect(restored[0][0]).toBe(0);
  });

  it("rejects wrong shapes", () => {
    expect(sanitizeTravelSeconds(null, 2)).toBeNull();
    expect(sanitizeTravelSeconds([[0, 1]], 2)).toBeNull();
    expect(sanitizeTravelSeconds([[0], [0, 1]], 2)).toBeNull();
  });

  it("maps negatives and non-numbers to Infinity", () => {
    expect(sanitizeTravelSeconds([[0, -5], ["x", 0]], 2)).toEqual([
      [0, Number.POSITIVE_INFINITY],
      [Number.POSITIVE_INFINITY, 0],
    ]);
  });
});
