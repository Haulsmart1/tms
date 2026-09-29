"use client";

/*
  Office actions on /shifts. The routes enforce who may use them (office
  callers in the shift's tenant); the page only offers them when one tenant is
  selected, because a write needs a tenant.
*/

import { useEffect, useState, type FormEvent } from "react";
import Button from "../../components/Button";
import Field from "../../components/Field";
import MessageBanner from "../../components/MessageBanner";
import Modal from "../../components/Modal";
import Select from "../../components/Select";
import Textarea from "../../components/Textarea";
import { dateTimeIn, isoToZonedInput, zonedInputToIso } from "../../lib/shifts/zonedTime";

export type DriverOption = { id: string; name: string };

async function postJson(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    return typeof data?.error === "string" ? data.error : "Unable to save. Try again.";
  } catch {
    return "Unable to reach the server. Check your connection and try again.";
  }
}

export function StartShiftDialog({
  open,
  onClose,
  onDone,
  tenantId,
  drivers,
  timeZone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  tenantId: string;
  drivers: DriverOption[];
  timeZone: string;
}) {
  const [driverId, setDriverId] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDriverId("");
    setStartedAt(isoToZonedInput(new Date(), timeZone));
    setReason("");
    setError("");
  }, [open, timeZone]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const iso = zonedInputToIso(startedAt, timeZone);
    if (!driverId) return setError("Choose a driver.");
    if (!iso) return setError("Enter a valid start time.");
    if (reason.trim().length < 3) return setError("Give a reason of at least 3 characters.");
    setSaving(true);
    setError("");
    const failure = await postJson("/api/shifts", { tenantId, driverId, startedAt: iso, reason: reason.trim() });
    setSaving(false);
    if (failure) return setError(failure);
    const name = drivers.find((d) => d.id === driverId)?.name ?? "The driver";
    onDone(`Shift started for ${name}.`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start shift for a driver"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="start-shift-form" loading={saving}>
            Start shift
          </Button>
        </>
      }
    >
      <form id="start-shift-form" onSubmit={submit} className="grid gap-3">
        <p className="text-sm text-ink-2">
          This records hours only. The driver still needs to complete a walkaround check in the app before they can
          work on jobs.
        </p>
        <Select id="start-shift-driver" label="Driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Choose a driver</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Field
          id="start-shift-time"
          label="Start time"
          type="datetime-local"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
          hint={`Times are in ${timeZone}.`}
        />
        <Textarea
          id="start-shift-reason"
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="For example: driver's phone is broken"
        />
        <MessageBanner tone="danger">{error || null}</MessageBanner>
      </form>
    </Modal>
  );
}

export type ShiftTimeMode = "end" | "correct_start" | "correct_end";

export type ShiftTimeTarget = {
  id: string;
  driverName: string;
  startedAt: string;
  endedAt: string | null;
};

const TITLES: Record<ShiftTimeMode, string> = {
  end: "End shift",
  correct_start: "Correct the start time",
  correct_end: "Correct the end time",
};

export function ShiftTimeDialog({
  target,
  mode,
  onClose,
  onDone,
  timeZone,
}: {
  target: ShiftTimeTarget | null;
  mode: ShiftTimeMode;
  onClose: () => void;
  onDone: (message: string) => void;
  timeZone: string;
}) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    const initial = mode === "correct_start" ? target.startedAt : mode === "correct_end" ? target.endedAt : null;
    setValue(isoToZonedInput(initial ?? new Date(), timeZone));
    setReason("");
    setError("");
  }, [target, mode, timeZone]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !target) return;
    const iso = zonedInputToIso(value, timeZone);
    if (!iso) return setError("Enter a valid time.");
    if (reason.trim().length < 3) return setError("Give a reason of at least 3 characters.");
    setSaving(true);
    setError("");
    const failure = await postJson(`/api/shifts/${encodeURIComponent(target.id)}/corrections`, {
      field: mode === "correct_start" ? "started_at" : "ended_at",
      value: iso,
      reason: reason.trim(),
    });
    setSaving(false);
    if (failure) return setError(failure);
    onDone(mode === "end" ? `Shift ended for ${target.driverName}.` : `Shift corrected for ${target.driverName}.`);
  }

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={TITLES[mode]}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="shift-time-form" loading={saving}>
            {mode === "end" ? "End shift" : "Save correction"}
          </Button>
        </>
      }
    >
      {target ? (
        <form id="shift-time-form" onSubmit={submit} className="grid gap-3">
          <p className="text-sm text-ink-2">
            {target.driverName}, started {dateTimeIn(target.startedAt, timeZone)}
            {target.endedAt ? `, ended ${dateTimeIn(target.endedAt, timeZone)}` : ", still open"}.
          </p>
          <p className="text-sm text-ink-2">The driver&apos;s original times are kept in the correction history.</p>
          <Field
            id="shift-time-value"
            label={mode === "correct_start" ? "Start time" : "End time"}
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            hint={`Times are in ${timeZone}.`}
          />
          <Textarea
            id="shift-time-reason"
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="For example: driver forgot to end the shift"
          />
          <MessageBanner tone="danger">{error || null}</MessageBanner>
        </form>
      ) : null}
    </Modal>
  );
}
