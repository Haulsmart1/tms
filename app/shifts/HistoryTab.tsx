"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import DataTable, { type Column } from "../../components/DataTable";
import Field from "../../components/Field";
import MessageBanner from "../../components/MessageBanner";
import Select from "../../components/Select";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
import { shiftsToCsv } from "../../lib/shifts/csv";
import { correctionFieldLabel, flagLabels } from "../../lib/shifts/display";
import { operatorDaysBack, operatorDayWindow } from "../../lib/shifts/fleetQuery";
import { forHours, HISTORY_SHIFT_LIMIT, loadShiftHistory, type HistoryShift } from "../../lib/shifts/historyQuery";
import { formatMinutes, summariseShift, type ShiftSummary } from "../../lib/shifts/hours";
import { clockIn, dateTimeIn } from "../../lib/shifts/zonedTime";
import type { TenantStatus } from "../../lib/tenant/context";
import { operatorDayInTimeZone } from "../../lib/time";
import type { DriverOption, ShiftTimeMode, ShiftTimeTarget } from "./ShiftDialogs";

type Row = HistoryShift & { summary: ShiftSummary };

function shownValue(value: string | null, timeZone: string): string {
  if (!value) return "not set";
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? dateTimeIn(new Date(ms).toISOString(), timeZone) : value;
}

function downloadCsv(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function HistoryTab({
  supabase,
  tenantStatus,
  activeTenantId,
  timeZone,
  zoneReady,
  canWrite,
  drivers,
  reloadKey,
  onShiftTime,
}: {
  supabase: SupabaseClient;
  tenantStatus: TenantStatus;
  activeTenantId: string | null;
  timeZone: string;
  zoneReady: boolean;
  canWrite: boolean;
  drivers: DriverOption[];
  reloadKey: number;
  onShiftTime: (target: ShiftTimeTarget, mode: ShiftTimeMode) => void;
}) {
  const today = operatorDayInTimeZone(new Date(), timeZone);
  const [from, setFrom] = useState(() => operatorDaysBack(today, 7));
  const [to, setTo] = useState(today);
  const [driverId, setDriverId] = useState("");
  const [shifts, setShifts] = useState<HistoryShift[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [errorText, setErrorText] = useState("");
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);
  const [expanded, setExpanded] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const range = useMemo(() => (from <= to ? operatorDayWindow(from, timeZone, to) : null), [from, to, timeZone]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    if (!range) {
      setState("error");
      setErrorText("Choose a start date on or before the end date.");
      return;
    }
    setState("loading");
    try {
      const result = await loadShiftHistory(supabase, activeTenantId, range, driverId || null);
      if (seq !== loadSeq.current) return;
      setShifts(result.shifts);
      setTruncated(result.truncated);
      setDataTenantId(activeTenantId);
      setState("ready");
    } catch (error) {
      if (seq !== loadSeq.current) return;
      console.error("[shifts] history load failed", error);
      setErrorText(error instanceof Error ? error.message : "");
      setState("error");
    }
  }, [supabase, activeTenantId, range, driverId]);

  useEffect(() => {
    if (tenantStatus !== "ready" || !zoneReady) return;
    void load();
    return () => {
      loadSeq.current++;
    };
  }, [tenantStatus, zoneReady, load, reloadKey]);

  const rows: Row[] = useMemo(() => {
    const now = new Date();
    return (shifts ?? []).map((s) => ({ ...s, summary: summariseShift(forHours(s), now) }));
  }, [shifts]);

  const showSkeleton = shouldShowSkeleton({
    tenantStatus,
    fetching: state === "loading",
    hasData: shifts !== null,
    activeTenantId,
    dataTenantId,
  });

  function exportCsv() {
    const csv = shiftsToCsv(
      rows.map((r) => ({
        driverName: r.driverName,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        vehicles: [...new Set(r.periods.map((p) => p.registration))],
        summary: r.summary,
        corrected: r.corrections.length > 0,
      })),
      timeZone,
    );
    downloadCsv(csv, `shifts-${from}-to-${to}.csv`);
  }

  const target = (r: Row): ShiftTimeTarget => ({ id: r.id, driverName: r.driverName, startedAt: r.startedAt, endedAt: r.endedAt });

  const columns: Column<Row>[] = [
    { header: "Driver", cell: (r) => <span className="font-medium text-ink">{r.driverName}</span> },
    {
      header: "Shift",
      cell: (r) => (
        <span className="text-sm">
          {dateTimeIn(r.startedAt, timeZone)} to {r.endedAt ? clockIn(r.endedAt, timeZone) : <Badge tone="info">Open</Badge>}
        </span>
      ),
    },
    {
      header: "Vehicles",
      cell: (r) =>
        r.periods.length ? (
          <span className="font-mono text-sm">{[...new Set(r.periods.map((p) => p.registration))].join(", ")}</span>
        ) : (
          <span className="text-ink-2">None</span>
        ),
    },
    { header: "Recorded duty", align: "right", cell: (r) => <span className="font-mono tabular-nums">{formatMinutes(r.summary.dutyMinutes)}</span> },
    { header: "Breaks", align: "right", cell: (r) => <span className="font-mono tabular-nums">{formatMinutes(r.summary.breakMinutes)}</span> },
    {
      header: "Worked excl. breaks",
      align: "right",
      cell: (r) => <span className="font-mono tabular-nums">{formatMinutes(r.summary.workedMinutes)}</span>,
    },
    {
      header: "Mileage",
      align: "right",
      cell: (r) => (r.summary.mileage === null ? <span className="text-ink-2">Not known</span> : <span className="font-mono tabular-nums">{r.summary.mileage}</span>),
    },
    {
      header: "Flags",
      cell: (r) => {
        const text = flagLabels([...r.summary.flags, ...r.flags]);
        return text ? <span className="text-sm text-warning-strong">{text}</span> : <span className="text-ink-2">None</span>;
      },
    },
    {
      header: "Office",
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-2">
          {r.corrections.length ? (
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={expanded === r.id}
              onClick={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
            >
              Corrected ({r.corrections.length})
            </Button>
          ) : null}
          {canWrite && r.endedAt === null ? (
            <Button size="sm" variant="secondary" onClick={() => onShiftTime(target(r), "end")}>
              End shift
            </Button>
          ) : null}
          {canWrite ? (
            <Button size="sm" variant="secondary" onClick={() => onShiftTime(target(r), "correct_start")}>
              Correct start
            </Button>
          ) : null}
          {canWrite && r.endedAt !== null ? (
            <Button size="sm" variant="secondary" onClick={() => onShiftTime(target(r), "correct_end")}>
              Correct end
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section aria-busy={showSkeleton} className="grid gap-3">
      {showSkeleton ? (
        <span className="sr-only" role="status">
          Loading shift history
        </span>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <Field id="history-from" label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} wrapperClassName="w-44" />
        <Field id="history-to" label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} wrapperClassName="w-44" />
        <Select id="history-driver" label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} wrapperClassName="w-56">
          <option value="">All drivers</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" onClick={exportCsv} disabled={state !== "ready" || rows.length === 0}>
          Export CSV
        </Button>
      </div>
      <MessageBanner tone="warning">
        {truncated ? `Showing the latest ${HISTORY_SHIFT_LIMIT} shifts. Narrow the dates or pick a driver to see the rest.` : null}
      </MessageBanner>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        state={showSkeleton ? "loading" : state === "error" ? "error" : rows.length ? "ready" : "empty"}
        errorMessage={`Couldn't load shift history. ${errorText ? `(${errorText})` : ""}`.trim()}
        onRetry={() => void load()}
        emptyTitle="No shifts in this range"
        expandedKey={expanded}
        renderExpanded={(r) => (
          <div className="bg-surface-2 px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-2">Correction history</h3>
            <ul className="grid gap-2">
              {r.corrections.map((c) => (
                <li key={c.id} className="text-sm text-ink-2">
                  <span className="font-medium text-ink">{correctionFieldLabel(c.field)}</span> changed by {c.correctedBy} on{" "}
                  {dateTimeIn(c.correctedAt, timeZone)}: {shownValue(c.oldValue, timeZone)} to {shownValue(c.newValue, timeZone)}.
                  Reason: {c.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      />
    </section>
  );
}
