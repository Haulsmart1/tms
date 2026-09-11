import { describe, expect, it } from "vitest";
import {
  DISCOUNT_BANDS,
  PERIOD_DAYS,
  PERIOD_MINIMUM_PENCE,
  PERIOD_VEHICLE_PENCE,
  fleetPeriodPence,
} from "./rateCard";
import {
  BILLING_BASIS_SENTENCE,
  THRESHOLD_PARITY_SENTENCE,
  includedVehicleCount,
  pricingBandRows,
  pricingHeadline,
} from "./pricingCopy";

describe("includedVehicleCount", () => {
  // The floor and the per-vehicle rate are set independently. If someone
  // reprices one without the other, "your first N vehicles included" must
  // follow rather than keep claiming the old N.
  it("derives from the minimum and the headline rate", () => {
    expect(includedVehicleCount()).toBe(
      Math.floor(PERIOD_MINIMUM_PENCE / PERIOD_VEHICLE_PENCE)
    );
  });

  it("is 2 at today's prices", () => {
    expect(includedVehicleCount()).toBe(2);
  });

  // The whole reason the copy can say "included" rather than "minimum": a
  // fleet of exactly that size pays exactly the floor and not a penny more.
  it("names a fleet size that costs exactly the minimum", () => {
    expect(fleetPeriodPence(includedVehicleCount())).toBe(PERIOD_MINIMUM_PENCE);
  });
});

describe("pricingHeadline", () => {
  it("leads with the minimum, which is the lowest anyone actually pays", () => {
    const headline = pricingHeadline();
    expect(headline.fromPence).toBe(PERIOD_MINIMUM_PENCE);
    expect(headline.fromLabel).toBe("£129.00");
  });

  it("carries the per-vehicle rate and the period length", () => {
    const headline = pricingHeadline();
    expect(headline.perVehiclePence).toBe(PERIOD_VEHICLE_PENCE);
    expect(headline.perVehicleLabel).toBe("£64.50");
    expect(headline.periodDays).toBe(PERIOD_DAYS);
  });

  it("summarises the offer in one sentence", () => {
    expect(pricingHeadline().summary).toBe(
      "From £129.00 per 28 days, including your first 2 vehicles."
    );
  });
});

describe("pricingBandRows", () => {
  // The 0% band exists in the rate card as the base case. Printing "0% off"
  // on a pricing page advertises a discount that is not one.
  it("omits the zero-discount band", () => {
    expect(pricingBandRows().every((row) => row.discountPercent > 0)).toBe(true);
    expect(pricingBandRows()).toHaveLength(
      DISCOUNT_BANDS.filter((band) => band.discountPercent > 0).length
    );
  });

  it("labels each band by its threshold", () => {
    expect(pricingBandRows()[0]).toEqual({
      threshold: 10,
      discountPercent: 10,
      label: "10 or more vehicles",
      discountLabel: "10% off your whole fleet",
    });
  });

  it("orders by ascending threshold", () => {
    const thresholds = pricingBandRows().map((row) => row.threshold);
    expect(thresholds).toEqual([...thresholds].sort((a, b) => a - b));
  });
});

describe("BILLING_BASIS_SENTENCE", () => {
  // v2 is ARREARS. Saying "charged every 4 weeks" here, as the v1 copy does,
  // describes the opposite billing direction.
  it("says the period length and that it bills in arrears", () => {
    expect(BILLING_BASIS_SENTENCE).toContain("28");
    expect(BILLING_BASIS_SENTENCE).toContain("end of each");
    expect(BILLING_BASIS_SENTENCE).toContain("Excludes VAT");
  });
});

describe("THRESHOLD_PARITY_SENTENCE", () => {
  /* This sentence is a public commercial promise printed on the pricing page,
     not a description of the code. Asserting the rate card actually satisfies
     it means a reprice that breaks the promise fails here, rather than
     quietly turning the pricing page into a lie. */
  it("promises the threshold behaviour it describes", () => {
    expect(THRESHOLD_PARITY_SENTENCE).toContain("threshold");
    expect(THRESHOLD_PARITY_SENTENCE).toContain("never costs you more");
  });

  // The second half of the promise: growing never costs you more.
  it("holds: the price never falls as the fleet grows", () => {
    for (let count = 0; count <= 200; count += 1) {
      expect(fleetPeriodPence(count + 1)).toBeGreaterThanOrEqual(
        fleetPeriodPence(count)
      );
    }
  });

  /* The first half: a fleet just below a threshold pays the threshold price.
     Worth asserting that this actually happens somewhere, because a sentence
     explaining a behaviour the rate card no longer exhibits is its own kind of
     wrong, and 19 and 9 are the two places the cap currently fires. */
  it("holds: some fleets pay a larger fleet's price", () => {
    const parity: number[] = [];
    for (let count = 1; count <= 200; count += 1) {
      if (fleetPeriodPence(count) === fleetPeriodPence(count + 1)) {
        parity.push(count);
      }
    }
    expect(parity).toContain(9);
    expect(parity).toContain(19);
  });
});
