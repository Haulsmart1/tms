import { describe, expect, it } from "vitest";
import {
  evaluatePlanningCompliance,
  type PlanningComplianceDriver,
} from "./compliance";

const DRIVER: PlanningComplianceDriver = {
  id: "driver-1",
  name: "Test Driver",
  tachograph_required: true,
  tachograph_card_number: "CARD-123",
  tachograph_expiry: "2027-01-01",
  tachograph_next_download_due: "2026-09-30",
  cpc_required: true,
  cpc_qualified: true,
  cpc_expiry: "2027-06-01",
};

function evaluate(
  overrides: Partial<Parameters<typeof evaluatePlanningCompliance>[0]> = {}
) {
  return evaluatePlanningCompliance({
    driver: DRIVER,
    hasPlannedJobs: true,
    plannedDrivingSeconds: 2 * 60 * 60,
    activityDataAvailable: false,
    today: "2026-08-31",
    ...overrides,
  });
}

describe("evaluatePlanningCompliance", () => {
  it("does not invent zero hours when activity data is absent", () => {
    const result = evaluate();

    expect(result.status).toBe("incomplete");
    expect(result.dataComplete).toBe(false);
    expect(result.missing).toContain("Driver activity data unavailable");
  });

  it("requires a driver for planned work", () => {
    const result = evaluate({ driver: null });

    expect(result.status).toBe("incomplete");
    expect(result.missing).toContain("No driver selected");
  });

  it("requires route time when work is planned", () => {
    const result = evaluate({ plannedDrivingSeconds: null });

    expect(result.missing).toContain("Planned route time unavailable");
  });

  it("treats an empty lane as having no compliance problem", () => {
    const result = evaluate({
      driver: null,
      hasPlannedJobs: false,
      plannedDrivingSeconds: null,
    });

    expect(result.status).toBe("ok");
    expect(result.statusLabel).toBe("No work planned");
    expect(result.dataComplete).toBe(true);
    expect(result.plannedDrivingSeconds).toBe(0);
  });

  it("warns when a required tachograph card has expired", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        tachograph_expiry: "2026-08-30",
      },
    });

    expect(result.status).toBe("warning");
    expect(result.warnings).toContain("Tachograph card expired");
  });

  it("does not expire a card on its expiry date", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        tachograph_expiry: "2026-08-31",
      },
    });

    expect(result.warnings).not.toContain("Tachograph card expired");
  });

  it("warns when the tachograph download is overdue", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        tachograph_next_download_due: "2026-08-01",
      },
    });

    expect(result.warnings).toContain("Tachograph download overdue");
  });

  it("warns for planned driving beyond the 4 h 30 m review point", () => {
    const result = evaluate({
      plannedDrivingSeconds: (4 * 60 + 31) * 60,
    });

    expect(result.warnings).toContain(
      "Planned driving exceeds 4 h 30 m; break and regime review required"
    );
  });

  it("flags missing required tachograph metadata", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        tachograph_card_number: null,
        tachograph_expiry: null,
      },
    });

    expect(result.warnings).toContain("Tachograph card number missing");
    expect(result.warnings).toContain("Tachograph card expiry missing");
  });

  it("warns when required CPC is not qualified", () => {
    const result = evaluate({
      driver: {
        ...DRIVER,
        cpc_qualified: false,
      },
    });

    expect(result.warnings).toContain(
      "Driver CPC is not marked qualified"
    );
  });
});
