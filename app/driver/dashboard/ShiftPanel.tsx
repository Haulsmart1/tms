"use client";
/*
  The driver's shift on the dashboard: what is waiting to sync, the "do not
  drive" panel when a check took a vehicle off the road, and either Start
  shift or the running shift with breaks, swap and end. Hours shown are
  RECORDED hours, never a legal hours check.
*/

import Link from "next/link";
import { useEffect, useState } from "react";
import { heldForOthersMessage, MEMORY_ONLY_MESSAGE } from "../../../lib/offline/driverSync";
import { breakEvent, clockTime, recordedHours } from "../../../lib/shifts/driverActions";
import { formatMinutes } from "../../../lib/shifts/hours";
import type { DriverShiftState } from "../../../lib/walkaround/driverState";
import { useOnline, type DriverShift } from "../useDriverShift";
import BlockingPanel from "./BlockingPanel";
import EndShiftForm from "./EndShiftForm";
import { ui } from "./shiftStyles";

/* Shown whatever the shift state: a subcontractor (forbidden) can still queue PODs. */
function MemoryOnlyBanner({ shift }: { shift: DriverShift }) {
  if (!shift.memoryOnly || shift.pendingCount === 0) return null;
  return (
    <p className="m-0 mb-3 rounded-md border border-danger-border bg-danger-tint p-3 text-sm font-semibold text-danger-strong" role="alert">
      {MEMORY_ONLY_MESSAGE}
    </p>
  );
}

export default function ShiftPanel({ shift }: { shift: DriverShift }) {
  return (
    <>
      <MemoryOnlyBanner shift={shift} />
      <ShiftPanelBody shift={shift} />
    </>
  );
}

function ShiftPanelBody({ shift }: { shift: DriverShift }) {
  const { state } = shift;
  if (shift.forbidden) return null;

  if (!state) {
    return (
      <section className={ui.card}>
        <h2 className={ui.title}>Shift</h2>
        {shift.loading ? (
          <p className={`${ui.muted} mt-2`} role="status">
            Loading your shift
          </p>
        ) : (
          <div className="mt-2 grid gap-2">
            <p className={ui.body}>{shift.error ?? "Unable to load your shift."}</p>
            <button type="button" className={ui.secondary} onClick={() => void shift.reload()}>
              Try again
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      <SyncStrip shift={shift} />
      {state.blockingCheck ? <BlockingPanel state={state} blocking={state.blockingCheck} shift={shift} /> : null}
      {state.openShift ? <OnShift state={state} shift={shift} /> : state.blockingCheck ? null : <NoShift state={state} />}
    </>
  );
}

function SyncStrip({ shift }: { shift: DriverShift }) {
  const online = useOnline();
  const held = heldForOthersMessage(shift.heldForOthers);
  if (shift.pendingCount === 0 && shift.rejected.length === 0 && !shift.paused && online && !shift.error && !held) return null;

  return (
    <section className="mb-5 grid gap-2 rounded-lg border border-warning-border bg-warning-tint p-4 text-sm text-ink" aria-live="polite">
      {shift.pendingCount > 0 || !online ? (
        <p className="m-0 font-semibold text-warning-strong">
          {shift.pendingCount > 0
            ? `${shift.pendingCount} item${shift.pendingCount === 1 ? "" : "s"} waiting to sync${online ? "" : ". Offline"}`
            : "Offline"}
        </p>
      ) : null}
      {shift.paused ? (
        <p className="m-0">
          {shift.paused}{" "}
          <Link className="font-semibold text-primary-deep" href="/login?next=/driver/dashboard">
            Sign in
          </Link>
        </p>
      ) : null}
      {shift.error && online ? <p className="m-0">{shift.error}</p> : null}
      {held ? <p className="m-0">{held}</p> : null}
      {shift.rejected.map((item) => (
        <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-danger-border bg-danger-tint p-3">
          <span className="text-danger-strong">{item.message}</span>
          <button type="button" className={ui.secondary} onClick={() => shift.dismissRejected(item.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </section>
  );
}

function NoShift({ state }: { state: DriverShiftState }) {
  return (
    <section className={ui.card}>
      <h2 className={ui.title}>Shift</h2>
      <p className={`${ui.body} mt-2`}>
        {state.assignedVehicle ? `Assigned today: ${state.assignedVehicle.registration}` : "No vehicle assigned today"}
      </p>
      <p className={`${ui.muted} mt-1`}>Start your shift with a walkaround check. Today&apos;s jobs unlock once the check passes (or passes with minor defects) and has synced.</p>
      <Link className={`${ui.primary} mt-4 w-full`} href="/driver/walkaround?phase=start">
        Start shift
      </Link>
    </section>
  );
}

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function OnShift({ state, shift }: { state: DriverShiftState; shift: DriverShift }) {
  const now = useMinuteClock();
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState("");
  const open = state.openShift;
  if (!open) return null;

  const summary = recordedHours(state, now);
  const runningBreak = open.breaks.find((b) => b.endedAt === null) ?? null;

  async function toggleBreak() {
    const built = breakEvent(state, open?.onBreak ? "break_ended" : "break_started", {
      clientId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
    });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError("");
    try {
      await shift.submit(built.event);
    } catch {
      setError("This phone could not save that. Try again.");
    }
  }

  return (
    <section className={ui.card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={ui.title}>On shift since {clockTime(open.startedAt, state.timeZone)}</h2>
        {open.onBreak && runningBreak ? <span className={ui.warningBadge}>On break since {clockTime(runningBreak.startedAt, state.timeZone)}</span> : null}
      </div>
      <p className={`${ui.body} mt-2`}>
        {open.currentVehicle ? `Vehicle: ${open.currentVehicle.registration}` : "No checked vehicle. Check a vehicle before working on jobs."}
      </p>

      {summary ? (
        <div className="mt-3 grid gap-1">
          <span className={ui.label}>Recorded hours</span>
          <p className={ui.body}>
            On duty {formatMinutes(summary.dutyMinutes)}, breaks {formatMinutes(summary.breakMinutes)}, excluding breaks{" "}
            {formatMinutes(summary.workedMinutes)}
          </p>
          {summary.flags.includes("over_13h") ? <span className={ui.warningBadge}>On duty over 13h</span> : null}
          <p className={ui.muted}>These are the hours logged on this phone. Your tachograph remains the legal record.</p>
        </div>
      ) : null}

      {error ? <p className={`${ui.error} mt-3`}>{error}</p> : null}

      {ending ? (
        <EndShiftForm state={state} shift={shift} onClose={() => setEnding(false)} />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className={ui.secondary} onClick={() => void toggleBreak()}>
            {open.onBreak ? "End break" : "Start break"}
          </button>
          <Link className={ui.secondary} href="/driver/walkaround?phase=swap">
            Swap vehicle
          </Link>
          <button type="button" className={`${ui.primary} col-span-2`} onClick={() => setEnding(true)}>
            End shift
          </button>
        </div>
      )}
    </section>
  );
}
