/*
  What GET /api/driver/shift returns, and what the driver app renders after
  applying queued events (lib/shifts/projection.ts). Client-safe types only.
*/

import type { TimeInterval } from "../shifts/hours";
import type { CatalogueItem, CheckResult, ObjectionStatus, Severity, SeveritySource } from "./types";

export type DriverDefectView = {
  clientId: string;
  label: string;
  finalSeverity: Severity;
  severitySource: SeveritySource;
  /** "Classed dangerous in the baseline checklist (based on DVSA guidance)." etc. Null for minor. */
  reason: string | null;
  guidance: string | null;
  note: string | null;
  photoCount: number;
  objection: null | { status: ObjectionStatus; decisionNote: string | null };
};

export type DriverVehicleOption = { id: string; registration: string; vor: boolean };

export type DriverShiftState = {
  today: string;
  /** The operator's IANA time zone, for showing shift times as the office sees them. */
  timeZone: string;
  companyName: string | null;
  onCallPhone: string | null;
  assignedVehicle: { id: string; registration: string } | null;
  vehicles: DriverVehicleOption[];
  catalogue: CatalogueItem[];
  openShift: null | {
    id: string;
    /** The shift's client id: queued break, swap and end events name it as shiftClientId. */
    clientId: string;
    startedAt: string;
    onBreak: boolean;
    breaks: TimeInterval[];
    currentVehicle: null | {
      vehicleId: string;
      registration: string;
      startOdometer: number;
      checkResult: CheckResult;
      /** When the covering check was done; the job gate refuses once it is too old. */
      checkPerformedAt: string | null;
    };
  };
  /** The latest check that took a vehicle off the road and has not been superseded. */
  blockingCheck: null | {
    checkClientId: string;
    vehicleId: string;
    registration: string;
    performedAt: string;
    defects: DriverDefectView[];
  };
  /** True when the phone holds events the server has not accepted yet. */
  syncPending: boolean;
};
