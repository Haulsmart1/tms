import { describe, expect, it } from "vitest";
import { sanitizeTravelSeconds } from "./matrix";
import { parseMatrix } from "../tomtom/api";

describe("sanitizeTravelSeconds", () => {
  it("restores Infinity for the nulls JSON serialization produces", () => {
    const served = parseMatrix(
      { data: [{ originIndex: 0, destinationIndex: 1, routeSummary: { travelTimeInSeconds: 100 } }] },
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
