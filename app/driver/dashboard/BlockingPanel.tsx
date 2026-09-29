"use client";
/*
  The "do not drive this vehicle" panel (spec, Driver flow step 5). It lists
  EVERY defect that took the vehicle off the road, each with why it counts as
  dangerous and what to look for, so the driver can see exactly what was
  recorded, object to it, or call the transport manager.
*/

import Link from "next/link";
import { useState } from "react";
import { OBJECTION_MAX, objectionEvent, walkaroundHref } from "../../../lib/shifts/driverActions";
import type { DriverDefectView, DriverShiftState } from "../../../lib/walkaround/driverState";
import type { DriverShift } from "../useDriverShift";
import { ui } from "./shiftStyles";

type Blocking = NonNullable<DriverShiftState["blockingCheck"]>;

export default function BlockingPanel({ state, blocking, shift }: { state: DriverShiftState; blocking: Blocking; shift: DriverShift }) {
  const told = !state.syncPending && shift.pendingCount === 0;

  return (
    <section className="mb-5 rounded-lg border-2 border-danger bg-danger-tint p-5" aria-labelledby="vor-title">
      <h2 id="vor-title" className="m-0 text-md font-semibold text-danger-strong">
        {blocking.registration} is off the road.
      </h2>
      <p className="m-0 mt-1 text-sm font-semibold text-danger-strong">
        Do not drive this vehicle. {told ? "The office has been told." : "The office will be told as soon as this phone has signal."}
      </p>

      <ul className="m-0 mt-4 grid list-none gap-3 p-0">
        {blocking.defects.map((defect) => (
          <li key={defect.clientId} className="rounded-lg border border-line bg-surface p-4">
            <DefectCard state={state} defect={defect} shift={shift} />
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-2">
        {state.onCallPhone ? (
          <a className={ui.danger} href={`tel:${state.onCallPhone.replace(/[^\d+]/g, "")}`}>
            Call transport manager
          </a>
        ) : (
          <p className="m-0 text-sm text-ink">Your company has not set an on-call number. Contact the office.</p>
        )}
        <Link className={ui.secondary} href={walkaroundHref(state)}>
          Check a different vehicle
        </Link>
      </div>
    </section>
  );
}

function DefectCard({ state, defect, shift }: { state: DriverShiftState; defect: DriverDefectView; shift: DriverShift }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const built = objectionEvent(state, defect.clientId, reason, { clientId: crypto.randomUUID(), occurredAt: new Date().toISOString() });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    try {
      await shift.submit(built.event);
      setOpen(false);
      setReason("");
      setError("");
    } catch {
      setError("This phone could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <p className="m-0 text-sm font-semibold text-ink">
        {defect.label}
        {defect.finalSeverity === "dangerous" ? <span className={ui.dangerBadge}>Dangerous</span> : null}
      </p>
      {defect.reason ? <p className={ui.body}>{defect.reason}</p> : null}
      {defect.guidance ? <p className={ui.muted}>What to look for: {defect.guidance}</p> : null}
      {defect.note ? <p className={ui.muted}>Your note: {defect.note}</p> : null}
      <p className={ui.muted}>
        {defect.photoCount} photo{defect.photoCount === 1 ? "" : "s"}
      </p>

      <ObjectionStatus defect={defect} />

      {!defect.objection && defect.finalSeverity === "dangerous" ? (
        open ? (
          <div className="grid gap-2">
            <label className="grid gap-1">
              <span className={ui.label}>Why do you object?</span>
              <textarea className={ui.textarea} value={reason} maxLength={OBJECTION_MAX} onChange={(e) => setReason(e.target.value)} />
            </label>
            {error ? <p className={ui.error}>{error}</p> : null}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={ui.secondary} onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className={ui.primary} onClick={() => void send()} disabled={busy}>
                Send objection
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={ui.secondary} onClick={() => setOpen(true)}>
            Object to this
          </button>
        )
      ) : null}
    </div>
  );
}

function ObjectionStatus({ defect }: { defect: DriverDefectView }) {
  const objection = defect.objection;
  if (!objection) return null;
  if (objection.status === "pending") return <span className={ui.warningBadge}>Objection sent, waiting for a decision</span>;
  if (objection.status === "approved") return <span className={ui.successBadge}>Objection approved</span>;
  return (
    <p className={ui.error}>
      Objection rejected{objection.decisionNote ? `: ${objection.decisionNote}` : ""}
    </p>
  );
}
