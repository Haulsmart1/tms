/*
  Shift history CSV for /shifts. Times are shown in the operator's time zone.
  Cells that a spreadsheet would treat as a formula are prefixed with a quote.
*/

import { operatorDayInTimeZone } from "../time";
import type { ShiftSummary } from "./hours";

export type ShiftCsvRow = {
  driverName: string;
  startedAt: string;
  endedAt: string | null;
  vehicles: string[];
  summary: ShiftSummary;
  corrected: boolean;
};

export function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function hm(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

const HEADER = ["Driver", "Date", "Start", "End", "Vehicles", "Duty", "Breaks", "Worked (excl. breaks)", "Mileage", "Flags", "Corrected by office"];

export function shiftsToCsv(rows: readonly ShiftCsvRow[], timeZone: string): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.driverName,
        operatorDayInTimeZone(new Date(r.startedAt), timeZone),
        clock(r.startedAt, timeZone),
        r.endedAt ? clock(r.endedAt, timeZone) : "",
        r.vehicles.join("; "),
        hm(r.summary.dutyMinutes),
        hm(r.summary.breakMinutes),
        hm(r.summary.workedMinutes),
        r.summary.mileage === null ? "" : String(r.summary.mileage),
        r.summary.flags.join(" "),
        r.corrected ? "yes" : "no",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}
