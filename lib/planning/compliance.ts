export type PlanningComplianceStatus =
  | "ok"
  | "warning"
  | "incomplete";

export type PlanningComplianceDriver = {
  id: string;
  name: string;
  tachograph_required: boolean | null;
  tachograph_card_number: string | null;
  tachograph_expiry: string | null;
  tachograph_next_download_due: string | null;
  cpc_required: boolean | null;
  cpc_qualified: boolean | null;
  cpc_expiry: string | null;
};

export type PlanningComplianceInput = {
  driver: PlanningComplianceDriver | null;
  hasPlannedJobs: boolean;
  plannedDrivingSeconds: number | null;
  activityDataAvailable: boolean;
  today: string;
};

export type PlanningCompliance = {
  status: PlanningComplianceStatus;
  statusLabel: string;
  dataComplete: boolean;
  plannedDrivingSeconds: number | null;
  warnings: string[];
  missing: string[];
};

const DRIVING_REVIEW_SECONDS = 4.5 * 60 * 60;

function normaliseDate(value: string | null): string | null {
  if (!value) return null;

  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function isPastDate(value: string | null, today: string): boolean {
  const date = normaliseDate(value);
  return date !== null && date < today;
}

function hasText(value: string | null): boolean {
  return Boolean(value?.trim());
}

export function evaluatePlanningCompliance(
  input: PlanningComplianceInput
): PlanningCompliance {
  const warnings: string[] = [];
  const missing: string[] = [];

  if (!input.hasPlannedJobs) {
    return {
      status: "ok",
      statusLabel: "No work planned",
      dataComplete: true,
      plannedDrivingSeconds: 0,
      warnings,
      missing,
    };
  }

  if (!input.driver) {
    missing.push("No driver selected");
  }

  if (input.plannedDrivingSeconds === null) {
    missing.push("Planned route time unavailable");
  }

  if (input.driver && !input.activityDataAvailable) {
    missing.push("Driver activity data unavailable");
  }

  const driver = input.driver;

  if (driver?.tachograph_required) {
    if (!hasText(driver.tachograph_card_number)) {
      warnings.push("Tachograph card number missing");
    }

    if (!normaliseDate(driver.tachograph_expiry)) {
      warnings.push("Tachograph card expiry missing");
    } else if (isPastDate(driver.tachograph_expiry, input.today)) {
      warnings.push("Tachograph card expired");
    }

    if (
      driver.tachograph_next_download_due &&
      isPastDate(driver.tachograph_next_download_due, input.today)
    ) {
      warnings.push("Tachograph download overdue");
    }
  }

  if (driver?.cpc_required) {
    if (driver.cpc_qualified === false) {
      warnings.push("Driver CPC is not marked qualified");
    }

    if (
      driver.cpc_expiry &&
      isPastDate(driver.cpc_expiry, input.today)
    ) {
      warnings.push("Driver CPC expired");
    }
  }

  if (
    input.plannedDrivingSeconds !== null &&
    input.plannedDrivingSeconds > DRIVING_REVIEW_SECONDS
  ) {
    warnings.push(
      "Planned driving exceeds 4 h 30 m; break and regime review required"
    );
  }

  const dataComplete = missing.length === 0;

  let status: PlanningComplianceStatus = "ok";
  let statusLabel = "Wizard check ready";

  if (warnings.length > 0) {
    status = "warning";
    statusLabel = "Review required";
  } else if (!dataComplete) {
    status = "incomplete";
    statusLabel = "Compliance data incomplete";
  }

  return {
    status,
    statusLabel,
    dataComplete,
    plannedDrivingSeconds: input.plannedDrivingSeconds,
    warnings,
    missing,
  };
}
