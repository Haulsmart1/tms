import { describe, expect, it } from "vitest";
import {
  classifyComplianceRegime,
  type ComplianceRegimeInput,
} from "./regime";

function input(
  overrides: Partial<ComplianceRegimeInput> = {}
): ComplianceRegimeInput {
  return {
    vehicle: {
      mam_kg: 3500,
      trailer_mam_kg: 0,
      tachograph_fitted: true,
      tachograph_type: "smart_2",
      home_country_code: "GB",
      ...overrides.vehicle,
    },
    job: {
      journey_scope: "gb_domestic",
      origin_country_code: "GB",
      destination_country_code: "GB",
      compliance_regime_override: null,
      compliance_override_reason: null,
      ...overrides.job,
    },
  };
}

describe("classifyComplianceRegime", () => {
  it("classifies GB domestic at exactly 3,500 kg as GB domestic", () => {
    const result = classifyComplianceRegime(input());

    expect(result.regime).toBe("gb_domestic");
    expect(result.tachoRequired).toBeNull();
    expect(result.confidence).toBe("confirmed");
    expect(result.combinationMamKg).toBe(3500);
  });

  it("classifies GB domestic at 3,501 kg as assimilated", () => {
    const result = classifyComplianceRegime(
      input({
        vehicle: {
          mam_kg: 3501,
        },
      })
    );

    expect(result.regime).toBe("assimilated");
    expect(result.tachoRequired).toBe(true);
    expect(result.confidence).toBe("confirmed");
  });

  it("does not treat exactly 2,500 kg as above the UK-EU light-goods threshold", () => {
    const result = classifyComplianceRegime(
      input({
        vehicle: {
          mam_kg: 2500,
        },
        job: {
          journey_scope: "uk_eu",
          origin_country_code: "GB",
          destination_country_code: "FR",
        },
      })
    );

    expect(result.regime).toBe("unknown");
    expect(result.tachoRequired).toBeNull();
    expect(result.confidence).toBe("incomplete");
    expect(result.combinationMamKg).toBe(2500);
  });

  it("classifies 2,501 kg UK-EU light goods separately", () => {
    const result = classifyComplianceRegime(
      input({
        vehicle: {
          mam_kg: 2501,
        },
        job: {
          journey_scope: "uk_eu",
          origin_country_code: "GB",
          destination_country_code: "FR",
        },
      })
    );

    expect(result.regime).toBe("international_light_goods");
    expect(result.tachoRequired).toBe(true);
    expect(result.confidence).toBe("confirmed");
  });

  it("keeps exactly 3,500 kg UK-EU in international light goods", () => {
    const result = classifyComplianceRegime(
      input({
        job: {
          journey_scope: "uk_eu",
          origin_country_code: "GB",
          destination_country_code: "DE",
        },
      })
    );

    expect(result.regime).toBe("international_light_goods");
    expect(result.combinationMamKg).toBe(3500);
  });

  it("classifies 3,501 kg UK-EU as assimilated", () => {
    const result = classifyComplianceRegime(
      input({
        vehicle: {
          mam_kg: 3501,
        },
        job: {
          journey_scope: "uk_eu",
          origin_country_code: "GB",
          destination_country_code: "NL",
        },
      })
    );

    expect(result.regime).toBe("assimilated");
    expect(result.tachoRequired).toBe(true);
  });

  it("uses vehicle plus trailer MAM for threshold classification", () => {
    const result = classifyComplianceRegime(
      input({
        vehicle: {
          mam_kg: 2400,
          trailer_mam_kg: 101,
        },
        job: {
          journey_scope: "uk_eu",
          origin_country_code: "GB",
          destination_country_code: "BE",
        },
      })
    );

    expect(result.combinationMamKg).toBe(2501);
    expect(result.regime).toBe("international_light_goods");
  });

  it("does not silently treat unknown trailer MAM as zero", () => {
    const result = classifyComplianceRegime(
      input({
        vehicle: {
          trailer_mam_kg: null,
        },
      })
    );

    expect(result.combinationMamKg).toBeNull();
    expect(result.regime).toBe("unknown");
    expect(result.confidence).toBe("incomplete");
    expect(result.missing).toContain(
      "Trailer MAM or explicit no-trailer value"
    );
  });

  it("classifies AETR only above the 3,500 kg boundary", () => {
    const atBoundary = classifyComplianceRegime(
      input({
        job: {
          journey_scope: "aetr",
          origin_country_code: "GB",
          destination_country_code: "CH",
        },
      })
    );

    const aboveBoundary = classifyComplianceRegime(
      input({
        vehicle: {
          mam_kg: 3501,
        },
        job: {
          journey_scope: "aetr",
          origin_country_code: "GB",
          destination_country_code: "CH",
        },
      })
    );

    expect(atBoundary.regime).toBe("unknown");
    expect(atBoundary.confidence).toBe("incomplete");
    expect(aboveBoundary.regime).toBe("aetr");
    expect(aboveBoundary.tachoRequired).toBe(true);
  });

  it("applies a documented operator override", () => {
    const result = classifyComplianceRegime(
      input({
        job: {
          compliance_regime_override: "exempt",
          compliance_override_reason: "Documented statutory exemption",
        },
      })
    );

    expect(result.regime).toBe("exempt");
    expect(result.tachoRequired).toBeNull();
    expect(result.confidence).toBe("overridden");
    expect(result.reasons).toContain(
      "Operator override: Documented statutory exemption"
    );
  });

  it("ignores an override with no reason and marks the base result incomplete", () => {
    const result = classifyComplianceRegime(
      input({
        job: {
          compliance_regime_override: "assimilated",
          compliance_override_reason: "   ",
        },
      })
    );

    expect(result.regime).toBe("gb_domestic");
    expect(result.confidence).toBe("incomplete");
    expect(result.missing).toContain("Compliance override reason");
  });

  it("rejects a GB-domestic scope that conflicts with country facts", () => {
    const result = classifyComplianceRegime(
      input({
        job: {
          destination_country_code: "FR",
        },
      })
    );

    expect(result.regime).toBe("unknown");
    expect(result.confidence).toBe("incomplete");
    expect(result.warnings).toContain(
      "GB domestic scope conflicts with the recorded origin or destination"
    );
  });

  it("rejects a UK-EU hint when neither endpoint establishes a GB-EU journey", () => {
    const result = classifyComplianceRegime(
      input({
        job: {
          journey_scope: "uk_eu",
          origin_country_code: "GB",
          destination_country_code: "CH",
        },
      })
    );

    expect(result.regime).toBe("unknown");
    expect(result.confidence).toBe("incomplete");
  });

  it("keeps regime confidence confirmed when fitted status is unknown", () => {
    const result = classifyComplianceRegime(
      input({
        vehicle: {
          mam_kg: 3501,
          tachograph_fitted: null,
        },
      })
    );

    expect(result.regime).toBe("assimilated");
    expect(result.tachoRequired).toBe(true);
    expect(result.confidence).toBe("confirmed");
    expect(result.missing).toContain("Tachograph fitted status");
    expect(result.warnings).toContain(
      "Tachograph requirement is known, but fitted-status metadata is missing"
    );
  });

  it("warns when the baseline requires a tachograph but vehicle says none is fitted", () => {
    const result = classifyComplianceRegime(
      input({
        vehicle: {
          mam_kg: 3501,
          tachograph_fitted: false,
        },
      })
    );

    expect(result.regime).toBe("assimilated");
    expect(result.tachoRequired).toBe(true);
    expect(result.confidence).toBe("confirmed");
    expect(result.warnings).toContain(
      "Vehicle is recorded without a tachograph although the baseline regime requires one"
    );
  });

  it("leaves international-other journeys unknown rather than guessing", () => {
    const result = classifyComplianceRegime(
      input({
        job: {
          journey_scope: "international_other",
          origin_country_code: "GB",
          destination_country_code: "NO",
        },
      })
    );

    expect(result.regime).toBe("unknown");
    expect(result.tachoRequired).toBeNull();
    expect(result.confidence).toBe("incomplete");
  });
});
