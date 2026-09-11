export type ManualActivityKind =
  | "driving"
  | "other_work"
  | "availability"
  | "break"
  | "rest"
  | "unknown";

export const MANUAL_ACTIVITY_KINDS:
  Array<{ value: ManualActivityKind; label: string }> = [
    { value: "driving", label: "Driving" },
    { value: "other_work", label: "Other work" },
    { value: "availability", label: "Availability" },
    { value: "break", label: "Break" },
    { value: "rest", label: "Rest" },
    { value: "unknown", label: "Unknown" },
  ];

export function validateManualActivityRange(
  start: Date,
  end: Date
): string | null {
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return "Enter valid start and end times.";
  }

  if (end.getTime() <= start.getTime()) {
    return "Activity end must be after its start.";
  }

  return null;
}

export function activitySourceLabel(
  sourceKind: string | null,
  sourceProvider: string | null
): string {
  switch (sourceKind) {
    case "manual":
      return "Manual";
    case "tachograph_file":
      return sourceProvider
        ? `Tacho file ? ${sourceProvider}`
        : "Tacho file";
    case "tachograph_api":
      return sourceProvider
        ? `Tacho API ? ${sourceProvider}`
        : "Tacho API";
    default:
      return "Legacy";
  }
}
