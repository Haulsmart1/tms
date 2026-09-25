/* Display helpers for the Planning job detail dialog. Kept out of the
   component so the status wording, the timezone-aware ETA and the "draft,
   not saved" assignment rule are unit tested (vitest covers lib/ only). */

import type { LabelStop } from "../printing/jobLabels";
import type { PlanStop } from "./types";

export const ABSENT = "-";

/** Same wording the Jobs page list uses for a status cell. */
export function jobStatusLabel(status: string | null): string {
  if (!status) return ABSENT;
  if (status === "pending_acceptance") return "Awaiting acceptance";
  return status.replaceAll("_", " ");
}

/** "15 Jan 2026, 09:00" in the given IANA zone; "-" for null or junk. The
    string is assembled from parts so ICU punctuation changes cannot move the
    comma, and hourCycle h23 keeps midnight at 00 rather than 24. */
export function formatEta(value: string | null, timeZone: string): string {
  if (!value) return ABSENT;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return ABSENT;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    return ABSENT;
  }

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  return `${part("day")} ${part("month")} ${part("year")}, ${part("hour")}:${part("minute")}`;
}

export function stopTypeLabel(type: string | null): string {
  if (!type) return ABSENT;
  if (type === "collection") return "Collection";
  if (type === "delivery") return "Delivery";
  return type;
}

/** The label printer keys its stop selection on exactly these two types, so
    anything else is dropped rather than mislabelled. */
export function toLabelStops(stops: PlanStop[]): LabelStop[] {
  return [...stops]
    .sort((a, b) => a.stop_order - b.stop_order)
    .flatMap((stop) => {
      if (stop.type !== "collection" && stop.type !== "delivery") return [];
      return [
        {
          id: stop.id,
          stop_order: stop.stop_order,
          type: stop.type,
          address_line: stop.address_line,
          city: stop.city,
          postcode: stop.postcode,
        },
      ];
    });
}

export type AssignmentLabelInput = {
  subcontracted: boolean;
  /** Registration, "Unknown", or null when the job is in no lane. */
  vehicleLabel: string | null;
  /** Name, "Unknown", or null when the lane has no driver. */
  driverLabel: string | null;
};

/** Subcontracted wins over any lane: the vehicle column is meaningless for
    a job another haulier is running. */
export function assignmentLabel({
  subcontracted,
  vehicleLabel,
  driverLabel,
}: AssignmentLabelInput): string {
  if (subcontracted) return "Subcontracted";
  if (vehicleLabel === null) return "Unassigned";
  if (driverLabel === null) return `${vehicleLabel} · No driver`;
  return `${vehicleLabel} · ${driverLabel}`;
}

export type DraftAssignment = {
  vehicleId: string | null;
  driverId: string | null;
};

/** Where the job sits on the board right now, which may differ from the
    saved jobs.vehicle_id until the plan is saved. */
export function draftAssignment(
  jobId: string,
  laneOrders: Record<string, string[]>,
  laneDrivers: Record<string, string | null>
): DraftAssignment {
  for (const [vehicleId, jobIds] of Object.entries(laneOrders)) {
    if (jobIds.includes(jobId)) {
      return { vehicleId, driverId: laneDrivers[vehicleId] ?? null };
    }
  }
  return { vehicleId: null, driverId: null };
}
