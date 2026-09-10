import { describe, expect, it } from "vitest";
import { fleetPeriodPence, PERIOD_MINIMUM_PENCE, PERIOD_VEHICLE_PENCE } from "./rateCard";
import { assembleInvoice } from "./invoice";
import type { InvoiceVehicle } from "./invoice";

const PERIOD_START = "2026-03-21";
const PERIOD_END = "2026-04-18";

function vehicles(
  count: number,
  coverageStartISO: string = PERIOD_START
): InvoiceVehicle[] {
  return Array.from({ length: count }, (_, index) => ({
    vehicleId: `vehicle-${String(index).padStart(3, "0")}`,
    tenantId: "tenant-1",
    vrnNormalised: `AB${String(index).padStart(2, "0")}XYZ`,
    coverageStartISO,
  }));
}

function invoice(
  fleet: readonly InvoiceVehicle[],
  overrides: Partial<Parameters<typeof assembleInvoice>[0]> = {}
) {
  return assembleInvoice({
    periodStartISO: PERIOD_START,
    periodEndISO: PERIOD_END,
    vehicles: fleet,
    minBillDays: 1,
    unitAmountPence: PERIOD_VEHICLE_PENCE,
    minimumPence: PERIOD_MINIMUM_PENCE,
    includedVehicles: 0,
    vatRatePercent: 20,
    ...overrides,
  });
}

describe("assembleInvoice with no vehicles", () => {
  // The dormant case. A company that activated nothing has no billing period
  // at all in production, but the assembly must still refuse to invent a
  // minimum charge for an empty fleet rather than billing GBP 129 for nothing.
  it("produces no lines and no charge", () => {
    const result = invoice([]);
    expect(result.lines).toEqual([]);
    expect(result.netPence).toBe(0);
    expect(result.vatPence).toBe(0);
    expect(result.grossPence).toBe(0);
  });
});

describe("assembleInvoice minimum", () => {
  it("lifts a single vehicle up to the minimum", () => {
    const result = invoice(vehicles(1));

    expect(result.subtotalPence).toBe(6450);
    expect(result.netPence).toBe(12900);
    expect(result.vatPence).toBe(2580);
    expect(result.grossPence).toBe(15480);
  });

  it("names the shortfall on its own line", () => {
    const adjustment = invoice(vehicles(1)).lines.find(
      (line) => line.kind === "minimum_adjustment"
    );

    expect(adjustment?.netPence).toBe(6450);
    expect(adjustment?.vehicleId).toBeNull();
    expect(adjustment?.description).toMatch(/minimum/i);
  });

  // The floor is exactly two vehicles, so two full-period vehicles land on it
  // precisely and need no adjustment. This is the property that makes
  // "GBP 129 minimum" and "first two vehicles included" the same offer.
  it("adds nothing when the fleet lands exactly on the minimum", () => {
    const result = invoice(vehicles(2));

    expect(result.netPence).toBe(12900);
    expect(result.lines.every((line) => line.kind === "vehicle")).toBe(true);
  });

  it("leaves a fleet above the minimum alone", () => {
    const result = invoice(vehicles(3));

    expect(result.netPence).toBe(19350);
    expect(result.lines).toHaveLength(3);
  });

  // A vehicle present for two days of the period still costs the full
  // minimum. The floor is a floor on the PERIOD, not on the usage.
  it("charges the full minimum for a barely-used period", () => {
    const result = invoice(vehicles(1, "2026-04-16"));

    expect(result.subtotalPence).toBe(461);
    expect(result.netPence).toBe(12900);
  });
});

describe("assembleInvoice volume discount", () => {
  it("does not add a discount line below the first threshold", () => {
    const result = invoice(vehicles(9));

    expect(result.discountPercent).toBe(0);
    expect(result.netPence).toBe(58050);
    expect(
      result.lines.some((line) => line.kind === "volume_discount")
    ).toBe(false);
  });

  it("discounts the whole fleet at ten vehicles", () => {
    const result = invoice(vehicles(10));
    const discount = result.lines.find(
      (line) => line.kind === "volume_discount"
    );

    expect(result.subtotalPence).toBe(64500);
    expect(discount?.netPence).toBe(-6450);
    expect(result.netPence).toBe(58050);
    expect(result.vatPence).toBe(11610);
    expect(result.grossPence).toBe(69660);
  });

  it("discounts the whole fleet at twenty vehicles", () => {
    const result = invoice(vehicles(20));

    expect(result.subtotalPence).toBe(129000);
    expect(result.netPence).toBe(103200);
  });

  // The cap reaches the invoice, not just the rate card: 19 vehicles pay the
  // 20 price, so the 20th vehicle really is free on a real bill.
  it("caps nineteen vehicles at the twenty-vehicle price", () => {
    expect(invoice(vehicles(19)).netPence).toBe(
      invoice(vehicles(20)).netPence
    );
  });

  // THE INVARIANT. Per-vehicle lines are prorated at the full rate and the
  // discount is applied to their sum, so a fleet present for the whole period
  // must land exactly on the rate card. If these ever diverge, the invoice a
  // customer reads stops summing to the price they were quoted.
  it("sums to the rate card for a fleet present all period", () => {
    for (const count of [1, 2, 3, 9, 10, 14, 15, 19, 20, 29, 30, 50]) {
      const expected = Math.max(
        fleetPeriodPence(count),
        PERIOD_MINIMUM_PENCE
      );
      expect(invoice(vehicles(count)).netPence).toBe(expected);
    }
  });

  // Proration and the discount have to compose. Twenty vehicles present for
  // eleven days is 20 x GBP 25.34 = GBP 506.80, less 20 per cent.
  it("discounts a prorated subtotal", () => {
    const result = invoice(vehicles(20, "2026-04-07"));

    expect(result.subtotalPence).toBe(50680);
    expect(result.netPence).toBe(40544);
  });
});

describe("assembleInvoice lines", () => {
  it("writes one line per vehicle carrying its coverage and days", () => {
    const [line] = invoice(vehicles(1, "2026-04-09")).lines;

    expect(line).toMatchObject({
      kind: "vehicle",
      vehicleId: "vehicle-000",
      tenantId: "tenant-1",
      vrnNormalised: "AB00XYZ",
      coverageStartISO: "2026-04-09",
      coverageEndISO: PERIOD_END,
      actualDays: 9,
      billableDays: 9,
      netPence: 2073,
    });
  });

  // Rule 3: a vehicle whose grace window outlasts the period produces no line
  // at all, rather than a zero line that would count toward the discount band
  // and pad the invoice.
  it("drops a vehicle whose coverage starts after the period ends", () => {
    const result = invoice([
      ...vehicles(2),
      {
        vehicleId: "still-in-grace",
        tenantId: "tenant-1",
        vrnNormalised: "GR00ACE",
        coverageStartISO: "2026-05-01",
      },
    ]);

    expect(result.lines).toHaveLength(2);
    expect(result.vehicleCount).toBe(2);
  });

  // Ordering is load-bearing: it is what the included-in-plan allowance keys
  // off when it is switched on, so it must not depend on the order rows came
  // back from Postgres.
  it("orders lines by coverage start then registration", () => {
    const result = invoice([
      { vehicleId: "c", tenantId: "t", vrnNormalised: "ZZ99ZZZ", coverageStartISO: "2026-03-25" },
      { vehicleId: "a", tenantId: "t", vrnNormalised: "AA11AAA", coverageStartISO: "2026-04-01" },
      { vehicleId: "b", tenantId: "t", vrnNormalised: "BB22BBB", coverageStartISO: "2026-03-25" },
    ]);

    expect(result.lines.map((line) => line.vehicleId)).toEqual(["b", "c", "a"]);
  });

  it("puts the discount and minimum lines after the vehicle lines", () => {
    const kinds = invoice(vehicles(10, "2026-04-16")).lines.map((l) => l.kind);

    expect(kinds.slice(0, 10)).toEqual(Array(10).fill("vehicle"));
    expect(kinds.slice(10)).toEqual(["volume_discount", "minimum_adjustment"]);
  });

  // Rule 5, defended here as well as by the unique index. Two rows for one
  // vehicle would bill it twice and inflate the discount band, and the close
  // job groups by vehicle precisely to prevent it, so reaching this function
  // with a duplicate means that grouping has broken.
  it("rejects the same vehicle twice", () => {
    expect(() => invoice([...vehicles(1), ...vehicles(1)])).toThrow(
      /vehicle-000/
    );
  });
});

describe("assembleInvoice VAT", () => {
  it("charges VAT on the discounted net including the minimum", () => {
    const result = invoice(vehicles(1));

    expect(result.netPence).toBe(12900);
    expect(result.vatPence).toBe(2580);
    expect(result.grossPence).toBe(15480);
  });

  it("rounds VAT half up", () => {
    // 461 net at 20 per cent is 92.2, which must not become 93.
    const result = invoice(vehicles(1, "2026-04-16"), { minimumPence: 0 });

    expect(result.netPence).toBe(461);
    expect(result.vatPence).toBe(92);
    expect(result.grossPence).toBe(553);
  });
});

describe("assembleInvoice included allowance", () => {
  // Rule 8. Off by default (includedVehicles is 0 for every company at
  // launch), because the GBP 129 floor was chosen over an allowance. The
  // logic exists so turning it on later is a config change rather than a
  // build, and it is tested with the minimum disabled because otherwise the
  // floor masks it entirely: three vehicles with two included come to GBP
  // 64.50, which the floor lifts straight back to GBP 129.
  it("zeroes the first N lines", () => {
    const result = invoice(vehicles(3), {
      includedVehicles: 2,
      minimumPence: 0,
    });

    expect(result.lines.map((line) => line.netPence)).toEqual([0, 0, 6450]);
    expect(result.netPence).toBe(6450);
  });

  it("labels an included line", () => {
    const [line] = invoice(vehicles(3), {
      includedVehicles: 2,
      minimumPence: 0,
    }).lines;

    expect(line.includedInPlan).toBe(true);
    expect(line.description).toMatch(/included in plan/i);
  });

  it("leaves charged lines unlabelled", () => {
    const lines = invoice(vehicles(3), {
      includedVehicles: 2,
      minimumPence: 0,
    }).lines;

    expect(lines[2].includedInPlan).toBe(false);
  });

  // The allowance takes the EARLIEST coverage, matching the line order, so a
  // customer's longest-held vehicles are the free ones rather than whichever
  // rows Postgres happened to return first.
  it("gives the allowance to the earliest coverage", () => {
    const result = invoice(
      [
        { vehicleId: "late", tenantId: "t", vrnNormalised: "ZZ99ZZZ", coverageStartISO: "2026-04-09" },
        { vehicleId: "early", tenantId: "t", vrnNormalised: "AA11AAA", coverageStartISO: PERIOD_START },
      ],
      { includedVehicles: 1, minimumPence: 0 }
    );

    expect(result.lines[0].vehicleId).toBe("early");
    expect(result.lines[0].netPence).toBe(0);
    expect(result.lines[1].netPence).toBe(2073);
  });

  // An included vehicle is still a vehicle. Excluding them from the count
  // would push a 10-vehicle fleet with 2 included back into the undiscounted
  // band, so growing the allowance would RAISE the price of the rest.
  it("still counts included vehicles toward the discount band", () => {
    const result = invoice(vehicles(10), {
      includedVehicles: 2,
      minimumPence: 0,
    });

    expect(result.discountPercent).toBe(10);
    expect(result.subtotalPence).toBe(51600);
    expect(result.netPence).toBe(46440);
  });

  it("charges nothing when the allowance covers the whole fleet", () => {
    const result = invoice(vehicles(2), {
      includedVehicles: 5,
      minimumPence: 0,
    });

    expect(result.netPence).toBe(0);
    expect(result.vatPence).toBe(0);
  });

  it("changes nothing when the allowance is zero", () => {
    expect(invoice(vehicles(3), { includedVehicles: 0 }).netPence).toBe(
      invoice(vehicles(3)).netPence
    );
  });
});
