import type { ComplianceRegime } from "./regime";

export type DriverRuleProfile = {
  id: string;
  label: string;
  regime: ComplianceRegime;
  effectiveFrom: string;
  verified: boolean;
  sourceReference: string | null;
  maxContinuousDrivingSeconds: number;
  qualifyingBreakSeconds: number;
  maxDailyDrivingSeconds: number;
  dailyRestSeconds: number;
  maxDutyWindowSeconds: number | null;
};

export type DriverRuleValidation =
  | {
      ok: true;
    }
  | {
      ok: false;
      errors: string[];
    };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function validateDriverRuleProfile(
  profile: DriverRuleProfile,
): DriverRuleValidation {
  const errors: string[] = [];

  if (!profile.id.trim()) {
    errors.push("Rule profile id is required");
  }

  if (!profile.label.trim()) {
    errors.push("Rule profile label is required");
  }

  if (!DATE_ONLY.test(profile.effectiveFrom)) {
    errors.push("Rule profile effectiveFrom must use YYYY-MM-DD");
  }

  if (
    profile.verified &&
    !profile.sourceReference?.trim()
  ) {
    errors.push(
      "Verified rule profiles require a source reference",
    );
  }

  const durations: Array<[string, number]> = [
    [
      "maxContinuousDrivingSeconds",
      profile.maxContinuousDrivingSeconds,
    ],
    ["qualifyingBreakSeconds", profile.qualifyingBreakSeconds],
    ["maxDailyDrivingSeconds", profile.maxDailyDrivingSeconds],
    ["dailyRestSeconds", profile.dailyRestSeconds],
  ];

  for (const [name, value] of durations) {
    if (!isPositiveFinite(value)) {
      errors.push(`${name} must be a positive finite number`);
    }
  }

  if (
    profile.maxDutyWindowSeconds !== null &&
    !isPositiveFinite(profile.maxDutyWindowSeconds)
  ) {
    errors.push(
      "maxDutyWindowSeconds must be null or a positive finite number",
    );
  }

  if (
    isPositiveFinite(profile.maxContinuousDrivingSeconds) &&
    isPositiveFinite(profile.maxDailyDrivingSeconds) &&
    profile.maxContinuousDrivingSeconds >
      profile.maxDailyDrivingSeconds
  ) {
    errors.push(
      "maxContinuousDrivingSeconds cannot exceed maxDailyDrivingSeconds",
    );
  }

  return errors.length === 0
    ? { ok: true }
    : { ok: false, errors };
}
