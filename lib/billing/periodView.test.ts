import { describe, expect, it } from "vitest";
import {
  NO_PERIOD_REASONS,
  periodProgress,
  pricingExplanation,
  type PreviewLine,
} from "./periodView";

function vehicleLine(netPence: number, vrn = "AB12CDE"): PreviewLine {
  return {
    kind: "vehicle",
    vehicleId: "v1",
    vrnNormalised: vrn,
    coverageStartISO: "2026-09-10",
    coverageEndISO: "2026-10-08",
    actualDays: 28,
    billableDays: 28,
    unitAmountPence: 6450,
    netPence,
    includedInPlan: false,
    description: `${vrn}, 28 days`,
  };
}

function adjustmentLine(kind: PreviewLine["kind"], netPence: number): PreviewLine {
  return {
    kind,
    vehicleId: null,
    vrnNormalised: null,
    coverageStartISO: null,
    coverageEndISO: null,
    actualDays: 0,
    billableDays: 0,
    unitAmountPence: 0,
    netPence,
    includedInPlan: false,
    description: kind,
  };
}

describe("periodProgress", () => {
  it("counts the first day as day 1, not day 0", () => {
    const progress = periodProgress({
      periodStartISO: "2026-09-10",
      periodEndISO: "2026-10-08",
      todayISO: "2026-09-10",
    });
    expect(progress.dayOfPeriod).toBe(1);
    expect(progress.totalDays).toBe(28);
    expect(progress.label).toBe("Day 1 of 28");
  });

  it("counts a day in the middle", () => {
    expect(
      periodProgress({
        periodStartISO: "2026-09-10",
        periodEndISO: "2026-10-08",
        todayISO: "2026-09-13",
      }).dayOfPeriod
    ).toBe(4);
  });

  // A period whose end has arrived but which the cron has not yet closed is a
  // real and common state: the job runs once a day. Reporting "Day 31 of 28"
  // would read as a fault when nothing is wrong.
  it("clamps a period whose end has passed but which is not yet closed", () => {
    const progress = periodProgress({
      periodStartISO: "2026-09-10",
      periodEndISO: "2026-10-08",
      todayISO: "2026-10-11",
    });
    expect(progress.dayOfPeriod).toBe(28);
    expect(progress.daysRemaining).toBe(0);
  });

  // Cancellation cuts a period short, so period_end is not always start + 28.
  it("uses the stored end rather than assuming 28 days", () => {
    expect(
      periodProgress({
        periodStartISO: "2026-09-10",
        periodEndISO: "2026-09-17",
        todayISO: "2026-09-12",
      }).totalDays
    ).toBe(7);
  });
});

describe("pricingExplanation", () => {
  it("explains a bill the minimum is carrying", () => {
    expect(
      pricingExplanation({
        lines: [vehicleLine(6450), adjustmentLine("minimum_adjustment", 6450)],
        vehicleCount: 1,
        minimumPence: 12900,
      })
    ).toBe(
      "The £129.00 minimum exceeds your 1 vehicle at £64.50, so the minimum applies."
    );
  });

  // THE BOUNDARY. Two vehicles cost exactly £129.00, which EQUALS the minimum
  // rather than falling below it, so assembleInvoice raises no adjustment line.
  // Saying "the minimum applies" here would be true of the number and false of
  // the bill.
  it("says nothing at exactly the minimum, where no adjustment is raised", () => {
    expect(
      pricingExplanation({
        lines: [vehicleLine(6450, "AB12CDE"), vehicleLine(6450, "XY98ZZZ")],
        vehicleCount: 2,
        minimumPence: 12900,
      })
    ).toBeNull();
  });

  it("explains a whole-fleet discount", () => {
    expect(
      pricingExplanation({
        lines: [vehicleLine(64500), adjustmentLine("volume_discount", -6450)],
        vehicleCount: 10,
        minimumPence: 12900,
      })
    ).toBe(
      "A volume discount is applied to your whole fleet, saving £64.50."
    );
  });

  /* THE CAPPED FLEET, which had no test and is the case the docstring claims
     to handle. 19 vehicles are priced by pretending to be 20, so the invoice's
     nominal discountPercent is 20 while the saving is £193.50 of £1225.50,
     which is 15.8%. Quoting either percentage beside that saving prints two
     numbers that cannot both be right. The sentence quotes neither. */
  it("quotes no percentage, so a capped fleet cannot contradict itself", () => {
    const explanation = pricingExplanation({
      lines: [vehicleLine(122550), adjustmentLine("volume_discount", -19350)],
      vehicleCount: 19,
      minimumPence: 12900,
    });
    expect(explanation).toBe(
      "A volume discount is applied to your whole fleet, saving £193.50."
    );
    expect(explanation).not.toContain("%");
  });

  it("prefers the minimum when both lines are present", () => {
    const explanation = pricingExplanation({
      lines: [
        vehicleLine(6450),
        adjustmentLine("volume_discount", -645),
        adjustmentLine("minimum_adjustment", 7095),
      ],
      vehicleCount: 1,
      minimumPence: 12900,
    });
    expect(explanation).toContain("minimum applies");
  });

  it("says nothing when only vehicle lines are involved", () => {
    expect(
      pricingExplanation({
        lines: [vehicleLine(6450), vehicleLine(6450), vehicleLine(6450)],
        vehicleCount: 3,
        minimumPence: 12900,
      })
    ).toBeNull();
  });
});

describe("NO_PERIOD_REASONS", () => {
  // This list replaces the SQL diagnostic in the 2026-09-10 handoff. If it
  // shrinks, a cause has stopped being explained to the person looking at a
  // page that shows no charge.
  it("lists every cause of a missing period", () => {
    expect(NO_PERIOD_REASONS).toHaveLength(3);
    expect(NO_PERIOD_REASONS.every((reason) => reason.length > 0)).toBe(true);
  });
});
