/*
  Plain-language labels for shift and walkaround flags on the office pages.
  Facts only: nothing here says "infringement", "legal" or "compliant".
*/

const FLAG_LABELS: Record<string, string> = {
  over_13h: "On duty over 13h",
  open_over_16h: "Open over 16h",
  odometer_decrease: "Odometer went down",
  late_sync: "Synced late",
  delayed_sync: "Sent over 15 minutes after it was recorded",
  out_of_order: "Arrived out of order",
  after_office_end: "Recorded after the office ended the shift",
  late_break_skipped: "A late break was not recorded",
  driver_end_after_office: "Driver ended after the office did",
  assigned_vehicle_mismatch: "Not the assigned vehicle",
};

export function flagLabel(flag: string): string {
  const known = FLAG_LABELS[flag];
  if (known) return known;
  const text = flag.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

export function flagLabels(flags: readonly string[]): string {
  return [...new Set(flags)].map(flagLabel).filter(Boolean).join(", ");
}

const CORRECTION_FIELDS: Record<string, string> = {
  started_at: "Start time",
  ended_at: "End time",
  office_started: "Started by the office",
};

export function correctionFieldLabel(field: string): string {
  return CORRECTION_FIELDS[field] ?? flagLabel(field);
}
