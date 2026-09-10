import { describe, expect, it } from "vitest";
import {
  DISCOUNT_BANDS,
  fleetPeriodPence,
  PERIOD_MINIMUM_PENCE,
  PERIOD_VEHICLE_PENCE,
} from "./rateCard";

describe("rate card constants", () => {
  // Deliberate tripwires on commercially meaningful numbers. If one of these
  // changes, someone has repriced the product, not refactored the maths.
  it("pins the per-vehicle period rate at GBP 64.50", () => {
    expect(PERIOD_VEHICLE_PENCE).toBe(6450);
  });

  it("pins the period minimum at GBP 129.00", () => {
    expect(PERIOD_MINIMUM_PENCE).toBe(12900);
  });

  // The minimum is exactly two vehicles, which is why "GBP 129 minimum" and
  // "first two vehicles included" are the same offer. Vehicle three costs the
  // full rate on top under either reading. If the two ever drift apart the
  // sales copy silently starts describing a different product.
  it("keeps the minimum equal to two vehicles at the headline rate", () => {
    expect(PERIOD_MINIMUM_PENCE).toBe(PERIOD_VEHICLE_PENCE * 2);
  });

  it("orders the discount bands by ascending threshold", () => {
    const thresholds = DISCOUNT_BANDS.map((band) => band.threshold);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
  });
});

describe("fleetPeriodPence", () => {
  it("charges nothing for an empty fleet", () => {
    expect(fleetPeriodPence(0)).toBe(0);
  });

  // Below the first discount threshold it is plain multiplication. The floor
  // is applied by the close job, not here, so a single vehicle prices at the
  // bare rate rather than at the GBP 129 minimum.
  it("prices an undiscounted fleet at the headline rate", () => {
    expect(fleetPeriodPence(1)).toBe(6450);
    expect(fleetPeriodPence(2)).toBe(12900);
    expect(fleetPeriodPence(9)).toBe(58050);
  });

  // 10 x 90% is exactly 9, so the tenth vehicle is free rather than cheap.
  // That is a property of the chosen numbers, not a rounding artefact.
  it("makes the tenth vehicle free at the 10 per cent threshold", () => {
    expect(fleetPeriodPence(10)).toBe(58050);
    expect(fleetPeriodPence(10)).toBe(fleetPeriodPence(9));
  });

  it("applies 10 per cent across the whole fleet from ten vehicles", () => {
    expect(fleetPeriodPence(11)).toBe(63855);
    expect(fleetPeriodPence(14)).toBe(81270);
  });

  // The 15 per cent band exists to break the 10-to-20 jump into two steps
  // small enough to stay monotonic. Without it the cap flattened 18, 19 AND
  // 20 to a single price. This threshold rises properly rather than flatly:
  // the 15th vehicle costs GBP 9.68 rather than nothing.
  it("applies 15 per cent across the whole fleet from fifteen vehicles", () => {
    expect(fleetPeriodPence(15)).toBe(82238);
    expect(fleetPeriodPence(15)).toBeGreaterThan(fleetPeriodPence(14));
    expect(fleetPeriodPence(18)).toBe(98685);
  });

  // THE CAP, now firing on one vehicle rather than three. 19 vehicles at 15%
  // off is 104168 while 20 at 20% off is 103200, so priced naively the bill
  // would still fall by GBP 9.68 at the twentieth vehicle. A fleet of 19 pays
  // the 20 price instead, which makes the 20th vehicle free.
  //
  // 15% is deliberate rather than the largest value that would fit. Only a
  // discount between 15.79% and 16% makes BOTH thresholds rise strictly, and
  // no integer percentage lies in that window: 16% would flatten 15 instead.
  // One free vehicle is unavoidable here; this chooses which one.
  it("caps a fleet just under a threshold at the threshold price", () => {
    expect(fleetPeriodPence(20)).toBe(103200);
    expect(fleetPeriodPence(19)).toBe(103200);
  });

  it("leaves fleets far enough below a threshold uncapped", () => {
    expect(fleetPeriodPence(17)).toBe(93203);
    expect(fleetPeriodPence(18)).toBeLessThan(fleetPeriodPence(19));
  });

  it("applies 20 per cent across the whole fleet in the third band", () => {
    expect(fleetPeriodPence(29)).toBe(149640);
  });

  it("applies 22 per cent across the whole fleet from thirty vehicles", () => {
    expect(fleetPeriodPence(30)).toBe(150930);
    expect(fleetPeriodPence(50)).toBe(251550);
  });

  // The guarantee the cap exists to provide, asserted rather than spot
  // checked. Every term of the min is non-decreasing in the fleet size, so
  // their minimum is too; this proves the implementation actually has that
  // property. A customer must never be able to reduce their bill by adding a
  // vehicle, because that is an invitation to invent phantom ones.
  it("never charges less for a larger fleet", () => {
    for (let count = 0; count < 200; count += 1) {
      expect(fleetPeriodPence(count + 1)).toBeGreaterThanOrEqual(
        fleetPeriodPence(count)
      );
    }
  });

  // No floats anywhere in money. A non-integer result would mean the discount
  // arithmetic had gone through a division that did not round.
  it("returns whole pence at every fleet size", () => {
    for (let count = 0; count <= 200; count += 1) {
      expect(Number.isInteger(fleetPeriodPence(count))).toBe(true);
    }
  });

  it("rejects a negative fleet size", () => {
    expect(() => fleetPeriodPence(-1)).toThrow(/non-negative integer/);
  });

  it("rejects a fractional fleet size", () => {
    expect(() => fleetPeriodPence(2.5)).toThrow(/non-negative integer/);
  });
});
