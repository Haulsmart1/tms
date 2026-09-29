"use client";
/*
  Which vehicle, and proof the driver is at it: scan the cab QR or type the
  registration. The assigned vehicle is pre-selected; choosing another needs a
  reason. Off-the-road vehicles are shown but cannot be chosen. The phone only
  checks that a scan is a cab code and that a typed registration matches; the
  server re-checks both.
*/

import { useState } from "react";
import { MISMATCH_REASON_MAX, needsMismatchReason, scannedCabCode, typedRegistrationMatches, type VehicleConfirmation } from "../../../lib/walkaround/checkWizard";
import type { DriverShiftState } from "../../../lib/walkaround/driverState";
import CameraScanner, { type ScanAnswer, type ScannerCopy } from "../CameraScanner";
import { w } from "./styles";

const QR_COPY: ScannerCopy = {
  open: "Scan cab QR",
  title: "Cab QR code",
  aim: "Point the rear camera at the QR sticker in the cab.",
  scanning: "Looking for the cab QR code...",
  checking: "QR code detected. Checking it...",
  manualEntry: "registration",
  footer: "If the camera is unavailable, close the scanner and type the registration.",
};

type Props = {
  state: DriverShiftState;
  vehicleId: string | null;
  confirmation: VehicleConfirmation | null;
  mismatchReason: string;
  onVehicle: (id: string) => void;
  onConfirmation: (confirmation: VehicleConfirmation | null) => void;
  onMismatchReason: (text: string) => void;
};

export default function VehicleStep({ state, vehicleId, confirmation, mismatchReason, onVehicle, onConfirmation, onMismatchReason }: Props) {
  const assignedId = state.assignedVehicle?.id ?? null;
  const [choosing, setChoosing] = useState(() => !assignedId || vehicleId !== assignedId);
  const vehicle = state.vehicles.find((v) => v.id === vehicleId) ?? null;
  const typed = confirmation?.kind === "registration" ? confirmation.typed : "";

  async function onScan(text: string): Promise<ScanAnswer> {
    const scanned = scannedCabCode(text);
    if (!scanned.ok) return { ok: false, message: scanned.error };
    onConfirmation({ kind: "qr", payload: scanned.payload });
    return { ok: true, message: "Cab code read. It is checked against this vehicle when the check syncs." };
  }

  return (
    <>
      <div className="grid gap-2">
        <span className={w.label}>Vehicle</span>
        {vehicle ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
            <span className="text-xl font-black">{vehicle.registration}</span>
            {vehicle.vor ? <span className={w.dangerBadge}>Off the road</span> : vehicle.id === assignedId ? <span className={w.minorBadge}>Assigned today</span> : null}
          </div>
        ) : (
          <p className={w.body}>{assignedId ? "Choose a vehicle." : "No vehicle is assigned to you today. Choose the one you are checking."}</p>
        )}
        {!choosing ? (
          <button type="button" className={w.secondary} onClick={() => setChoosing(true)}>
            Different vehicle
          </button>
        ) : null}
      </div>

      {choosing ? (
        <div className="grid gap-2" role="radiogroup" aria-label="Choose a vehicle">
          {state.vehicles.map((v) => {
            const selected = v.id === vehicleId;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={v.vor}
                className={`${w.option} ${selected ? "border-blue-700" : "border-slate-200"} ${v.vor ? "bg-slate-100 text-slate-400" : ""}`}
                onClick={() => {
                  if (v.id === vehicleId) return;
                  onVehicle(v.id);
                  onConfirmation(null);
                }}
              >
                <span>{v.registration}</span>
                <span className="text-xs font-black">{v.vor ? "Off the road" : v.id === assignedId ? "Assigned today" : selected ? "Selected" : ""}</span>
              </button>
            );
          })}
          {state.vehicles.length === 0 ? <p className={w.body}>No vehicles are set up for your fleet. Ask the office.</p> : null}
        </div>
      ) : null}

      {needsMismatchReason(vehicleId, state) ? (
        <label className="block">
          <span className={w.label}>Why are you taking a different vehicle? (required)</span>
          <textarea className={w.textarea} value={mismatchReason} maxLength={MISMATCH_REASON_MAX} onChange={(e) => onMismatchReason(e.target.value)} />
        </label>
      ) : null}

      {vehicle && !vehicle.vor ? (
        <div className="grid gap-2 border-t border-slate-100 pt-4">
          <span className={w.label}>Confirm you are at {vehicle.registration}</span>
          {confirmation?.kind === "qr" ? (
            <div className="flex items-center justify-between gap-3">
              <p className={w.success}>Cab QR code scanned.</p>
              <button type="button" className={w.secondary} onClick={() => onConfirmation(null)}>
                Clear
              </button>
            </div>
          ) : null}
          <CameraScanner key={vehicle.id} mode="qr" copy={QR_COPY} onScan={onScan} />
          <label className="mt-2 block">
            <span className={w.label}>Or type the registration</span>
            <input
              className={w.input}
              value={typed}
              maxLength={16}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => onConfirmation(e.target.value ? { kind: "registration", typed: e.target.value } : null)}
            />
          </label>
          {typed ? (
            typedRegistrationMatches(typed, vehicle.id, state) ? (
              <p className={w.success}>Matches {vehicle.registration}.</p>
            ) : (
              <p className={w.warning}>Does not match {vehicle.registration} yet.</p>
            )
          ) : null}
        </div>
      ) : null}
    </>
  );
}
