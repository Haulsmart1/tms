"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import Badge, { type Tone } from "../../components/Badge";
import Button from "../../components/Button";
import DataTable, { type Column } from "../../components/DataTable";
import { fleetTodayRows, type FleetInput, type FleetShift, type FleetTodayRow } from "../../lib/dashboard/fleetReadiness";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
import { loadFleetInput } from "../../lib/shifts/fleetQuery";
import { formatMinutes } from "../../lib/shifts/hours";
import { clockIn, dateTimeIn } from "../../lib/shifts/zonedTime";
import type { TenantStatus } from "../../lib/tenant/context";
import { operatorDayInTimeZone } from "../../lib/time";
import type { CheckResult } from "../../lib/walkaround/types";
import type { ShiftTimeTarget } from "./ShiftDialogs";

const RESULT: Record<CheckResult, { tone: Tone; label: string }> = {
  pass: { tone: "success", label: "Passed" },
  minor: { tone: "warning", label: "Minor defects" },
  dangerous: { tone: "danger", label: "Dangerous defect" },
};

function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
}

function shiftText(row: FleetTodayRow, now: Date): string {
  if (row.shiftState === "on_duty" && row.shiftStartedAt) return `On duty ${formatMinutes(minutesSince(row.shiftStartedAt, now))}`;
  if (row.shiftState === "on_break") return "On break";
  if (row.shiftState === "ended") return "Ended";
  return "Not started";
}

/* Vehicles out on a job today without a check come first: they are the rows
   the office needs to act on. */
function needsCheck(row: FleetTodayRow): boolean {
  return row.onJobToday && row.checkResult === null;
}

export default function FleetTodayTab({
  supabase,
  tenantStatus,
  activeTenantId,
  timeZone,
  zoneReady,
  canWrite,
  reloadKey,
  onStartShift,
  onEndShift,
}: {
  supabase: SupabaseClient;
  tenantStatus: TenantStatus;
  activeTenantId: string | null;
  timeZone: string;
  zoneReady: boolean;
  canWrite: boolean;
  reloadKey: number;
  onStartShift: () => void;
  onEndShift: (target: ShiftTimeTarget) => void;
}) {
  const [input, setInput] = useState<FleetInput | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [errorText, setErrorText] = useState("");
  const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setState("loading");
    const now = new Date();
    try {
      const next = await loadFleetInput(supabase, activeTenantId, operatorDayInTimeZone(now, timeZone), now, timeZone);
      if (seq !== loadSeq.current) return;
      setInput(next);
      setDataTenantId(activeTenantId);
      setState("ready");
    } catch (error) {
      if (seq !== loadSeq.current) return;
      console.error("[shifts] fleet today load failed", error);
      setErrorText(error instanceof Error ? error.message : "");
      setState("error");
    }
  }, [supabase, activeTenantId, timeZone]);

  useEffect(() => {
    if (tenantStatus !== "ready" || !zoneReady) return;
    void load();
    return () => {
      loadSeq.current++;
    };
  }, [tenantStatus, zoneReady, load, reloadKey]);

  const rows = useMemo(() => {
    if (!input) return [];
    return fleetTodayRows(input).sort((a, b) => Number(needsCheck(b)) - Number(needsCheck(a)));
  }, [input]);
  const openShifts: FleetShift[] = useMemo(
    () => (input?.shifts ?? []).filter((s) => s.endedAt === null).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [input],
  );
  const now = input?.now ?? new Date();
  const registration = useMemo(() => new Map((input?.vehicles ?? []).map((v) => [v.id, v.registration])), [input]);

  const showSkeleton = shouldShowSkeleton({
    tenantStatus,
    fetching: state === "loading",
    hasData: input !== null,
    activeTenantId,
    dataTenantId,
  });

  const columns: Column<FleetTodayRow>[] = [
    {
      header: "Vehicle",
      cell: (r) => (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-sm font-medium text-ink">{r.registration}</span>
          {needsCheck(r) ? <Badge tone="warning">On a job today, not checked</Badge> : null}
        </div>
      ),
    },
    { header: "Driver", cell: (r) => r.driverName ?? <span className="text-ink-2">No driver yet</span> },
    {
      header: "Walkaround",
      cell: (r) =>
        r.checkResult && r.checkTime ? (
          <span className="inline-flex items-center gap-2">
            <span className="font-mono text-sm tabular-nums text-ink">{clockIn(r.checkTime, timeZone)}</span>
            <Badge tone={RESULT[r.checkResult].tone}>{RESULT[r.checkResult].label}</Badge>
          </span>
        ) : (
          <span className="text-ink-2">Not checked today</span>
        ),
    },
    { header: "Shift", cell: (r) => shiftText(r, now) },
    {
      header: "Defects",
      cell: (r) =>
        r.openDefects === 0 ? (
          <span className="text-ink-2">None open</span>
        ) : (
          <span className={r.dangerousDefects > 0 ? "font-semibold text-danger-strong" : "text-ink"}>
            {r.openDefects} open{r.dangerousDefects > 0 ? `, ${r.dangerousDefects} dangerous` : ""}
          </span>
        ),
    },
    {
      header: "Status",
      cell: (r) => (r.vor ? <Badge tone="danger">VOR</Badge> : <Badge tone="neutral">In service</Badge>),
    },
  ];

  const openColumns: Column<FleetShift>[] = [
    { header: "Driver", cell: (s) => <span className="font-medium text-ink">{s.driverName}</span> },
    { header: "Started", cell: (s) => dateTimeIn(s.startedAt, timeZone) },
    {
      header: "Now",
      cell: (s) => (s.onBreak ? "On break" : `On duty ${formatMinutes(minutesSince(s.startedAt, now))}`),
    },
    {
      header: "Vehicle",
      cell: (s) =>
        s.currentVehicleId ? (
          <span className="font-mono text-sm">{registration.get(s.currentVehicleId) ?? "Another vehicle"}</span>
        ) : (
          <span className="text-ink-2">No walkaround check yet</span>
        ),
    },
    {
      header: "",
      align: "right",
      cell: (s) =>
        canWrite ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onEndShift({ id: s.id, driverName: s.driverName, startedAt: s.startedAt, endedAt: null })}
          >
            End shift
          </Button>
        ) : null,
    },
  ];

  const baseState = showSkeleton ? "loading" : state === "error" ? "error" : null;
  const errorMessage = `Couldn't load today's fleet. ${errorText ? `(${errorText})` : ""}`.trim();

  return (
    <div className="grid gap-6">
      <section aria-busy={showSkeleton}>
        {showSkeleton ? (
          <span className="sr-only" role="status">
            Loading the fleet
          </span>
        ) : null}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Fleet today</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Refresh
            </Button>
            {canWrite ? (
              <Button size="sm" onClick={onStartShift}>
                Start shift for a driver
              </Button>
            ) : null}
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.vehicleId}
          state={baseState ?? (rows.length ? "ready" : "empty")}
          errorMessage={errorMessage}
          onRetry={() => void load()}
          emptyTitle="No vehicles in service"
          emptyDescription="Vehicles that are active or off the road show here."
        />
      </section>

      <section aria-busy={showSkeleton}>
        <h2 className="mb-2 text-sm font-semibold text-ink">On shift now</h2>
        <DataTable
          columns={openColumns}
          rows={openShifts}
          rowKey={(s) => s.id}
          state={baseState ?? (openShifts.length ? "ready" : "empty")}
          errorMessage={errorMessage}
          onRetry={() => void load()}
          skeletonRows={2}
          emptyTitle="Nobody is on shift"
        />
      </section>
    </div>
  );
}
