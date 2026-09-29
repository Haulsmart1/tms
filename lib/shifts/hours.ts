/*
  Recorded shift hours. These are the hours a driver logged, NOT a legal hours
  calculation: tachograph data stays the legal record, and nothing here checks
  Working Time, daily rest or weekly rest. Flags are facts ("on duty over
  13h"), never "infringement".

  All arithmetic is on instants (Date.parse), so clock-change days come out as
  real elapsed time.
*/

export type TimeInterval = { startedAt: string; endedAt: string | null };

export type ShiftForHours = {
  startedAt: string;
  endedAt: string | null;
  breaks: readonly TimeInterval[];
  periods: readonly { startOdometer: number; endOdometer: number | null }[];
};

export type ShiftFlag = "over_13h" | "open_over_16h" | "odometer_decrease";

export type ShiftSummary = {
  dutyMinutes: number;
  breakMinutes: number;
  workedMinutes: number;
  mileage: number | null;
  flags: ShiftFlag[];
};

export const LONG_DUTY_MINUTES = 13 * 60;
export const STALE_OPEN_MINUTES = 16 * 60;

function minutesBetween(start: number, end: number): number {
  return Math.max(0, Math.floor((end - start) / 60_000));
}

export function summariseShift(shift: ShiftForHours, now: Date): ShiftSummary {
  const start = Date.parse(shift.startedAt);
  const end = shift.endedAt ? Date.parse(shift.endedAt) : now.getTime();
  const dutyMinutes = minutesBetween(start, end);

  let breakMinutes = 0;
  for (const b of shift.breaks) {
    const bStart = Math.max(Date.parse(b.startedAt), start);
    const bEnd = Math.min(b.endedAt ? Date.parse(b.endedAt) : end, end);
    breakMinutes += minutesBetween(bStart, bEnd);
  }
  breakMinutes = Math.min(breakMinutes, dutyMinutes);

  const flags: ShiftFlag[] = [];
  if (dutyMinutes > LONG_DUTY_MINUTES) flags.push("over_13h");
  if (shift.endedAt === null && dutyMinutes > STALE_OPEN_MINUTES) flags.push("open_over_16h");

  let mileage: number | null = null;
  if (shift.periods.length > 0 && shift.periods.every((p) => p.endOdometer !== null)) {
    if (shift.periods.some((p) => (p.endOdometer as number) < p.startOdometer)) flags.push("odometer_decrease");
    else mileage = shift.periods.reduce((sum, p) => sum + ((p.endOdometer as number) - p.startOdometer), 0);
  } else if (shift.periods.some((p) => p.endOdometer !== null && p.endOdometer < p.startOdometer)) {
    flags.push("odometer_decrease");
  }

  return { dutyMinutes, breakMinutes, workedMinutes: dutyMinutes - breakMinutes, mileage, flags };
}

type Result = { ok: true } | { ok: false; error: string };

export function validateBreakStart(
  shift: { startedAt: string; endedAt: string | null; breaks: readonly TimeInterval[] },
  at: string,
): Result {
  const t = Date.parse(at);
  if (shift.endedAt !== null) return { ok: false, error: "The shift has already ended." };
  if (t < Date.parse(shift.startedAt)) return { ok: false, error: "A break cannot start before the shift." };
  if (shift.breaks.some((b) => b.endedAt === null)) return { ok: false, error: "A break is already running." };
  // The new break has no end yet, so it overlaps every closed break that is
  // still running at t or starts after it (a later break synced out of order).
  if (shift.breaks.some((b) => b.endedAt !== null && t < Date.parse(b.endedAt))) {
    return { ok: false, error: "That time overlaps another break." };
  }
  return { ok: true };
}

export function validateBreakEnd(openBreak: TimeInterval | null, at: string, closedBreaks: readonly TimeInterval[]): Result {
  if (!openBreak || openBreak.endedAt !== null) return { ok: false, error: "No break is running." };
  const start = Date.parse(openBreak.startedAt);
  const end = Date.parse(at);
  if (end < start) return { ok: false, error: "A break cannot end before it starts." };
  if (closedBreaks.some((b) => b.endedAt !== null && Date.parse(b.startedAt) < end && Date.parse(b.endedAt) > start)) {
    return { ok: false, error: "That time overlaps another break." };
  }
  return { ok: true };
}

export function formatMinutes(total: number): string {
  const safe = Math.max(0, Math.trunc(total));
  return `${Math.floor(safe / 60)}h ${String(safe % 60).padStart(2, "0")}m`;
}
