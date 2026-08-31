import type { PlanJob } from "./types";
import {
  classifyComplianceRegime,
  type ComplianceJobFacts,
  type ComplianceRegime,
  type ComplianceRegimeResult,
  type ComplianceVehicleFacts,
} from "./regime";

export type LaneRegimeJobResult = {
  jobId: string;
  result: ComplianceRegimeResult;
};

export type LaneRegimeSummary = {
  status: "empty" | "single" | "mixed";
  regime: ComplianceRegime | null;
  reviewRequired: boolean;
  hasOverrides: boolean;
  warningCount: number;
  jobs: LaneRegimeJobResult[];
};

function jobFacts(job: PlanJob): ComplianceJobFacts {
  return {
    journey_scope: job.journey_scope ?? null,
    origin_country_code: job.origin_country_code ?? null,
    destination_country_code: job.destination_country_code ?? null,
    compliance_regime_override: job.compliance_regime_override ?? null,
    compliance_override_reason: job.compliance_override_reason ?? null,
  };
}

export function regimeLabel(regime: ComplianceRegime | null): string {
  switch (regime) {
    case "gb_domestic":
      return "GB domestic";
    case "assimilated":
      return "Assimilated";
    case "aetr":
      return "AETR";
    case "international_light_goods":
      return "International light goods";
    case "exempt":
      return "Exempt";
    case "unknown":
      return "Unknown regime";
    case null:
      return "No regime";
  }
}

export function summarizeLaneRegimes(
  vehicle: ComplianceVehicleFacts,
  jobs: PlanJob[]
): LaneRegimeSummary {
  if (jobs.length === 0) {
    return {
      status: "empty",
      regime: null,
      reviewRequired: false,
      hasOverrides: false,
      warningCount: 0,
      jobs: [],
    };
  }

  const classified: LaneRegimeJobResult[] = jobs.map((job) => ({
    jobId: job.id,
    result: classifyComplianceRegime({
      vehicle,
      job: jobFacts(job),
    }),
  }));

  const regimes = new Set(classified.map(({ result }) => result.regime));
  const mixed = regimes.size > 1;

  const reviewRequired = classified.some(
    ({ result }) =>
      result.regime === "unknown" ||
      result.confidence === "incomplete" ||
      result.missing.length > 0
  );

  const hasOverrides = classified.some(
    ({ result }) => result.confidence === "overridden"
  );

  const warningCount = classified.reduce(
    (total, { result }) => total + result.warnings.length,
    0
  );

  return {
    status: mixed ? "mixed" : "single",
    regime: mixed ? null : classified[0].result.regime,
    reviewRequired,
    hasOverrides,
    warningCount,
    jobs: classified,
  };
}
