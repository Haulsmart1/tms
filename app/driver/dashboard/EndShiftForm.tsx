"use client";
/*
  End shift: the odometer, then "Any new defects since your check?". A defect
  here follows the same severity rules as a walkaround and can take the
  vehicle off the road before the next driver takes it. Works offline: it
  only queues.
*/

import { useMemo, useState } from "react";
import { endShiftEvent } from "../../../lib/shifts/driverActions";
import { groupByItem } from "../../../lib/walkaround/catalogue";
import type { DriverShiftState } from "../../../lib/walkaround/driverState";
import type { DriverShift } from "../useDriverShift";
import DefectPicker, { type PickedDefect } from "../walkaround/DefectPicker";
import { ui } from "./shiftStyles";

export default function EndShiftForm({ state, shift, onClose }: { state: DriverShiftState; shift: DriverShift; onClose: () => void }) {
  const [odometer, setOdometer] = useState("");
  const [hasDefects, setHasDefects] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<PickedDefect[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const groups = useMemo(() => groupByItem(state.catalogue), [state.catalogue]);
  const catalogue = useMemo(() => new Map(state.catalogue.map((i) => [i.id, i])), [state.catalogue]);
  const vehicle = state.openShift?.currentVehicle ?? null;
  const dangerous = picked.some((p) => p.resolved.finalSeverity === "dangerous");

  async function submit() {
    setError("");
    if (hasDefects === null) {
      setError("Answer the question: any new defects since your check?");
      return;
    }
    if (hasDefects && picked.length === 0) {
      setError("Add the defect, or answer No.");
      return;
    }
    const built = endShiftEvent(
      state,
      odometer,
      hasDefects ? picked.map((p) => p.defect) : [],
      { clientId: crypto.randomUUID(), occurredAt: new Date().toISOString() },
    );
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    try {
      await shift.submit(built.event);
      if (hasDefects) {
        for (const p of picked) {
          for (const photo of p.photos) await shift.submitPhoto(p.defect.clientId, photo.blob, photo.mimeType, photo.filename);
        }
      }
      onClose();
    } catch {
      setError("This phone could not save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 grid gap-3 border-t border-line pt-4">
      <h3 className={ui.subTitle}>End shift</h3>
      <label className="grid gap-1">
        <span className={ui.label}>Odometer{vehicle ? ` on ${vehicle.registration}` : ""}</span>
        <input className={ui.input} inputMode="numeric" pattern="[0-9]*" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
      </label>

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className={`${ui.label} mb-1`}>Any new defects since your check?</legend>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={hasDefects === false ? ui.primary : ui.secondary} onClick={() => setHasDefects(false)}>
            No
          </button>
          <button
            type="button"
            className={hasDefects === true ? ui.primary : ui.secondary}
            disabled={!vehicle}
            onClick={() => {
              setHasDefects(true);
              if (picked.length === 0) setPicking(true);
            }}
          >
            Yes
          </button>
        </div>
        {!vehicle ? <p className={ui.muted}>You have no checked vehicle on this shift, so defects cannot be recorded here. Tell the office.</p> : null}
      </fieldset>

      {hasDefects ? (
        <div className="grid gap-2">
          {picked.map((p) => (
            <div key={p.defect.clientId} className="flex items-start justify-between gap-3 rounded-md border border-line bg-surface-2 p-3 text-sm">
              <span>
                {p.resolved.label}
                {p.resolved.finalSeverity === "dangerous" ? <span className={ui.dangerBadge}>Dangerous</span> : null}
                {p.photos.length > 0 ? <span className={ui.muted}> ({p.photos.length} photo{p.photos.length === 1 ? "" : "s"})</span> : null}
              </span>
              <button type="button" className={ui.secondary} onClick={() => setPicked((all) => all.filter((x) => x !== p))}>
                Remove
              </button>
            </div>
          ))}
          {picking ? (
            <DefectPicker
              groups={groups}
              catalogue={catalogue}
              palette="tokens"
              onDone={(p) => {
                setPicked((all) => [...all, p]);
                setPicking(false);
              }}
              onCancel={() => setPicking(false)}
            />
          ) : (
            <button type="button" className={ui.secondary} onClick={() => setPicking(true)}>
              Add another defect
            </button>
          )}
          {dangerous && vehicle ? (
            <p className={ui.dangerNote}>{vehicle.registration} will be taken off the road when this is sent. The office will be told.</p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className={ui.error}>{error}</p> : null}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={ui.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={ui.primary} onClick={() => void submit()} disabled={busy || picking}>
          End shift
        </button>
      </div>
    </div>
  );
}
