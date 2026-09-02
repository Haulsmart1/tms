import { describe, expect, it } from "vitest";
import type { PlanJob } from "./types";
import {
  regimeLabel,
  summarizeLaneRegimes,
} from "./laneRegime";
import type { ComplianceVehicleFacts } from "./regime";

function vehicle(
  overrides: Partial<ComplianceVehicleFacts> = {}
): ComplianceVehicleFacts {
  return {
    mam_kg: 3500,
    trailer_mam_kg: 0,
    tachograph_fitted: false,
    tachograph_type: null,
    home_country_code: "GB",
    ...overrides,
  };
}

function job(
  id: string,
  overrides: Partial<PlanJob> = {}
): PlanJob {
  return {
    id,
    reference: id,
    status: "planned",
    vehicle_id: null,
    driver_id: null,
    subcontractor_id: null,
    route_order: null,
    customer_name: null,
    journey_scope: "gb_domestic",
    origin_country_code: "GB",
    destination_country_code: "GB",
    compliance_regime_override: null,
    compliance_override_reason: null,
    stops: [],
    ...overrides,
  };
}

describe("summarizeLaneRegimes", () => {
  it("returns an empty summary for a lane with no jobs", () => {
    const result = summarizeLaneRegimes(vehicle(), []);

    expect(result.status).toBe("empty");
    expect(result.regime).toBeNull();
    expect(result.reviewRequired).toBe(false);
    expect(result.jobs).toEqual([]);
  });

  it("summarizes matching job regimes as one lane regime", () => {
    const result = summarizeLaneRegimes(
      vehicle(),
      [job("j1"), job("j2")]
    );

    expect(result.status).toBe("single");
    expect(result.regime).toBe("gb_domestic");
    expect(result.reviewRequired).toBe(false);
  });

  it("requires review for operator-supplied AETR scope", () => {
    const summary = summarizeLaneRegimes(
      vehicle({
        mam_kg: 3501,
        trailer_mam_kg: 0,
        tachograph_fitted: true,
      }),
      [
        job("aetr", {
          journey_scope: "aetr",
          origin_country_code: "GB",
          destination_country_code: "CH",
        }),
      ]
    );

    expect(summary.status).toBe("single");
    expect(summary.regime).toBe("aetr");
    expect(summary.reviewRequired).toBe(true);
    expect(summary.jobs[0].result.confidence).toBe("incomplete");
  });

  it("does not silently collapse different known regimes", () => {
    const result = summarizeLaneRegimes(
      vehicle({ mam_kg: 3500 }),
      [
        job("domestic"),
        job("eu", {
          journey_scope: "uk_eu",
          origin_country_code: "GB",
          destination_country_code: "FR",
        }),
      ]
    );

    expect(result.jobs.map(({ result: jobResult }) => jobResult.regime)).toEqual([
      "gb_domestic",
      "international_light_goods",
    ]);
    expect(result.status).toBe("mixed");
    expect(result.regime).toBeNull();
  });

  it("requires review when a job regime is unknown", () => {
    const result = summarizeLaneRegimes(
      vehicle(),
      [
        job("unknown", {
          journey_scope: null,
          origin_country_code: null,
          destination_country_code: null,
        }),
      ]
    );

    expect(result.status).toBe("single");
    expect(result.regime).toBe("unknown");
    expect(result.reviewRequired).toBe(true);
  });

  it("keeps mixed and review states independently visible", () => {
    const result = summarizeLaneRegimes(
      vehicle(),
      [
        job("domestic"),
        job("unknown", {
          journey_scope: null,
          origin_country_code: null,
          destination_country_code: null,
        }),
      ]
    );

    expect(result.status).toBe("mixed");
    expect(result.reviewRequired).toBe(true);
  });

  it("flags documented overrides without hiding the result", () => {
    const result = summarizeLaneRegimes(
      vehicle(),
      [
        job("override", {
          compliance_regime_override: "exempt",
          compliance_override_reason: "Operator-documented exemption review",
        }),
      ]
    );

    expect(result.status).toBe("single");
    expect(result.regime).toBe("exempt");
    expect(result.hasOverrides).toBe(true);
  });

  it("requires review when required equipment metadata is missing", () => {
    const result = summarizeLaneRegimes(
      vehicle({
        mam_kg: 3501,
        tachograph_fitted: null,
      }),
      [job("heavy")]
    );

    expect(result.regime).toBe("assimilated");
    expect(result.reviewRequired).toBe(true);
  });
});

describe("regimeLabel", () => {
  it("formats the international light-goods regime", () => {
    expect(regimeLabel("international_light_goods")).toBe(
      "International light goods"
    );
  });
});
