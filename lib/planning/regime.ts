export type ComplianceRegime =
  | "gb_domestic"
  | "assimilated"
  | "aetr"
  | "international_light_goods"
  | "exempt"
  | "unknown";

export type ComplianceConfidence =
  | "confirmed"
  | "incomplete"
  | "overridden";

export type JourneyScope =
  | "gb_domestic"
  | "uk_eu"
  | "aetr"
  | "international_other";

export type TachographType =
  | "analogue"
  | "digital"
  | "smart_1"
  | "smart_2"
  | "other";

export type ComplianceVehicleFacts = {
  mam_kg: number | null;
  trailer_mam_kg: number | null;
  tachograph_fitted: boolean | null;
  tachograph_type: TachographType | null;
  home_country_code: string | null;
};

export type ComplianceJobFacts = {
  journey_scope: JourneyScope | null;
  origin_country_code: string | null;
  destination_country_code: string | null;
  compliance_regime_override: ComplianceRegime | null;
  compliance_override_reason: string | null;
};

export type ComplianceRegimeInput = {
  vehicle: ComplianceVehicleFacts;
  job: ComplianceJobFacts;
};

export type ComplianceRegimeResult = {
  regime: ComplianceRegime;
  tachoRequired: boolean | null;
  confidence: ComplianceConfidence;
  combinationMamKg: number | null;
  reasons: string[];
  warnings: string[];
  missing: string[];
};

const GB = "GB";

const EU_COUNTRY_CODES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

function addUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function normaliseCountryCode(value: string | null): string | null {
  if (value === null) return null;

  const normalised = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalised) ? normalised : null;
}

function validPositiveMass(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function validTrailerMass(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function recordTachographEquipmentStatus(
  fitted: boolean | null,
  required: boolean,
  warnings: string[],
  missing: string[]
): void {
  if (!required) return;

  if (fitted === null) {
    addUnique(missing, "Tachograph fitted status");
    warnings.push(
      "Tachograph requirement is known, but fitted-status metadata is missing"
    );
    return;
  }

  if (!fitted) {
    warnings.push(
      "Vehicle is recorded without a tachograph although the baseline regime requires one"
    );
  }
}

function result(
  regime: ComplianceRegime,
  tachoRequired: boolean | null,
  confidence: ComplianceConfidence,
  combinationMamKg: number | null,
  reasons: string[],
  warnings: string[],
  missing: string[]
): ComplianceRegimeResult {
  return {
    regime,
    tachoRequired,
    confidence,
    combinationMamKg,
    reasons,
    warnings,
    missing,
  };
}

export function classifyComplianceRegime(
  input: ComplianceRegimeInput
): ComplianceRegimeResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const missing: string[] = [];

  const vehicle = input.vehicle;
  const job = input.job;

  const origin = normaliseCountryCode(job.origin_country_code);
  const destination = normaliseCountryCode(job.destination_country_code);
  const homeCountry = normaliseCountryCode(vehicle.home_country_code);

  if (
    job.origin_country_code !== null &&
    origin === null
  ) {
    addUnique(missing, "Valid origin country code");
  }

  if (
    job.destination_country_code !== null &&
    destination === null
  ) {
    addUnique(missing, "Valid destination country code");
  }

  if (
    vehicle.home_country_code !== null &&
    homeCountry === null
  ) {
    addUnique(missing, "Valid vehicle home country code");
  }

  const vehicleMamKg = vehicle.mam_kg;
  const trailerMamKg = vehicle.trailer_mam_kg;

  const vehicleMassValid = validPositiveMass(vehicleMamKg);
  if (!vehicleMassValid) {
    addUnique(missing, "Vehicle MAM");
  }

  const trailerMassValid = validTrailerMass(trailerMamKg);
  if (!trailerMassValid) {
    addUnique(
      missing,
      trailerMamKg === null
        ? "Trailer MAM or explicit no-trailer value"
        : "Valid trailer MAM"
    );
  }

  const combinationMamKg =
    vehicleMassValid && trailerMassValid
      ? vehicleMamKg + trailerMamKg
      : null;

  if (trailerMamKg === 0) {
    reasons.push("No trailer mass is included in this planning classification");
  }

  const override = job.compliance_regime_override;
  const overrideReason = job.compliance_override_reason?.trim() ?? "";

  if (override !== null && overrideReason.length > 0) {
    reasons.push(`Operator override: ${overrideReason}`);
    warnings.push(
      "Compliance regime was manually overridden; verify the documented legal basis"
    );

    return result(
      override,
      null,
      "overridden",
      combinationMamKg,
      reasons,
      warnings,
      missing
    );
  }

  let forceIncomplete = false;

  if (override !== null && overrideReason.length === 0) {
    addUnique(missing, "Compliance override reason");
    warnings.push(
      "Compliance regime override ignored because no reason was supplied"
    );
    forceIncomplete = true;
  }

  if (job.journey_scope === null) {
    addUnique(missing, "Journey scope");
  }

  if (origin === null) {
    addUnique(missing, "Origin country");
  }

  if (destination === null) {
    addUnique(missing, "Destination country");
  }

  if (
    job.journey_scope === null ||
    origin === null ||
    destination === null ||
    combinationMamKg === null
  ) {
    return result(
      "unknown",
      null,
      "incomplete",
      combinationMamKg,
      reasons,
      warnings,
      missing
    );
  }

  const scope = job.journey_scope;

  if (scope === "gb_domestic") {
    if (origin !== GB || destination !== GB) {
      warnings.push(
        "GB domestic scope conflicts with the recorded origin or destination"
      );

      return result(
        "unknown",
        null,
        "incomplete",
        combinationMamKg,
        reasons,
        warnings,
        missing
      );
    }

    if (combinationMamKg <= 3500) {
      reasons.push(
        "GB domestic goods journey at or below 3,500 kg combination MAM"
      );
      warnings.push(
        "Specific GB domestic exemptions and derogations are not evaluated by this classifier"
      );

      return result(
        "gb_domestic",
        null,
        forceIncomplete ? "incomplete" : "confirmed",
        combinationMamKg,
        reasons,
        warnings,
        missing
      );
    }

    reasons.push(
      "GB domestic goods journey above 3,500 kg combination MAM"
    );
    warnings.push(
      "Specific exemptions and derogations are not evaluated by this classifier"
    );

    recordTachographEquipmentStatus(
      vehicle.tachograph_fitted,
      true,
      warnings,
      missing
    );

    return result(
      "assimilated",
      true,
      forceIncomplete ? "incomplete" : "confirmed",
      combinationMamKg,
      reasons,
      warnings,
      missing
    );
  }

  if (scope === "uk_eu") {
    const gbToEu =
      (origin === GB && EU_COUNTRY_CODES.has(destination)) ||
      (destination === GB && EU_COUNTRY_CODES.has(origin));

    if (!gbToEu) {
      warnings.push(
        "UK-EU scope conflicts with the recorded origin and destination countries"
      );

      return result(
        "unknown",
        null,
        "incomplete",
        combinationMamKg,
        reasons,
        warnings,
        missing
      );
    }

    if (combinationMamKg <= 2500) {
      reasons.push(
        "Combination MAM is not above the 2,500 kg international light-goods threshold"
      );
      warnings.push(
        "No exemption is inferred; another regime or exemption review is required"
      );

      return result(
        "unknown",
        null,
        "incomplete",
        combinationMamKg,
        reasons,
        warnings,
        missing
      );
    }

    const regime: ComplianceRegime =
      combinationMamKg <= 3500
        ? "international_light_goods"
        : "assimilated";

    reasons.push(
      combinationMamKg <= 3500
        ? "UK-EU goods journey above 2,500 kg and at or below 3,500 kg combination MAM"
        : "UK-EU goods journey above 3,500 kg combination MAM"
    );
    warnings.push(
      "Specific exemptions and derogations are not evaluated by this classifier"
    );

    recordTachographEquipmentStatus(
      vehicle.tachograph_fitted,
      true,
      warnings,
      missing
    );

    return result(
      regime,
      true,
      forceIncomplete ? "incomplete" : "confirmed",
      combinationMamKg,
      reasons,
      warnings,
      missing
    );
  }

  if (scope === "aetr") {
    if (origin === destination) {
      warnings.push(
        "AETR scope conflicts with a journey whose recorded endpoints are in the same country"
      );

      return result(
        "unknown",
        null,
        "incomplete",
        combinationMamKg,
        reasons,
        warnings,
        missing
      );
    }

    if (combinationMamKg <= 3500) {
      reasons.push(
        "Combination MAM is not above 3,500 kg for this AETR classification"
      );
      warnings.push(
        "No exemption or alternative international regime is inferred"
      );

      return result(
        "unknown",
        null,
        "incomplete",
        combinationMamKg,
        reasons,
        warnings,
        missing
      );
    }

    reasons.push(
      "Operator-supplied AETR scope with combination MAM above 3,500 kg"
    );
    warnings.push(
      "AETR territorial applicability and specific exemptions still require route review"
    );

    recordTachographEquipmentStatus(
      vehicle.tachograph_fitted,
      true,
      warnings,
      missing
    );

    return result(
      "aetr",
      true,
      "incomplete",
      combinationMamKg,
      reasons,
      warnings,
      missing
    );
  }

  warnings.push(
    "International-other scope is not sufficient to determine a legal driving-hours regime"
  );

  return result(
    "unknown",
    null,
    "incomplete",
    combinationMamKg,
    reasons,
    warnings,
    missing
  );
}
