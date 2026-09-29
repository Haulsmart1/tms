"use client";
/*
  Pick one defect: a catalogue defect for the item (or "Other" with a note),
  an optional note and up to five photos. The driver can raise a minor defect
  to dangerous but there is no control that lowers a dangerous one.

  Used by the walkaround checklist (fixed light palette, like
  /driver/jobs/[jobId]) and by the end-shift form on the themeable driver
  dashboard (design tokens), hence the `palette` prop.
*/

import { useId, useState, type ChangeEvent } from "react";
import type { QueuedDefect } from "../../../lib/shifts/events";
import type { ItemGroup } from "../../../lib/walkaround/catalogue";
import { canMarkDangerous, DEFECT_NOTE_MAX, DEFECT_PHOTOS_MAX, draftToDefect } from "../../../lib/walkaround/defectDraft";
import type { ResolvedDefect } from "../../../lib/walkaround/severity";
import type { CatalogueItem } from "../../../lib/walkaround/types";
import { preparePodPhoto, type PreparedPhoto } from "../jobs/[jobId]/downscaleImage";

export type PickedDefect = { defect: QueuedDefect; resolved: ResolvedDefect; photos: PreparedPhoto[] };
export type PickerPalette = "tokens" | "light";

const OTHER = "other";

const PALETTES = {
  tokens: {
    box: "grid gap-3 rounded-lg border border-line bg-surface-2 p-4 text-ink",
    heading: "m-0 text-sm font-semibold text-ink",
    option: "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-line bg-surface p-3 text-sm text-ink",
    badge: "ml-2 inline-block rounded-full border border-danger-border bg-danger-tint px-2 py-0.5 text-[11px] font-semibold text-danger-strong",
    input: "min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink",
    textarea: "min-h-24 w-full rounded-md border border-line bg-surface p-3 text-base text-ink",
    primary: "min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-50",
    secondary: "min-h-11 rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink",
    error: "m-0 rounded-md border border-danger-border bg-danger-tint p-3 text-sm font-semibold text-danger-strong",
    muted: "m-0 text-xs text-ink-2",
  },
  light: {
    box: "grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-slate-950",
    heading: "m-0 text-base font-black text-slate-950",
    option: "flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900",
    badge: "ml-2 inline-block rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-black text-red-800",
    input: "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base outline-none focus:border-blue-600",
    textarea: "min-h-24 w-full rounded-xl border border-slate-300 bg-white p-3 text-base outline-none focus:border-blue-600",
    primary: "min-h-12 rounded-xl bg-blue-700 px-4 text-sm font-black text-white disabled:opacity-50",
    secondary: "min-h-12 rounded-xl border border-slate-300 bg-white px-4 text-sm font-black text-slate-800",
    error: "m-0 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800",
    muted: "m-0 text-xs text-slate-500",
  },
} as const;

export default function DefectPicker({
  groups,
  catalogue,
  palette,
  onDone,
  onCancel,
}: {
  /** One group from the checklist, or every group (the end-shift form lets the driver choose the item). */
  groups: readonly ItemGroup[];
  catalogue: ReadonlyMap<string, CatalogueItem>;
  palette: PickerPalette;
  onDone: (picked: PickedDefect) => void;
  onCancel: () => void;
}) {
  const c = PALETTES[palette];
  const name = useId();
  const [clientId] = useState(() => crypto.randomUUID());
  const [groupIndex, setGroupIndex] = useState(0);
  const [choice, setChoice] = useState("");
  const [markedDangerous, setMarkedDangerous] = useState(false);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const group = groups[groupIndex] ?? null;
  const chosenItem = choice && choice !== OTHER ? catalogue.get(choice) ?? null : null;
  const showRaise = choice !== "" && canMarkDangerous(chosenItem);
  const guidance = chosenItem?.guidance ?? group?.defects[0]?.guidance ?? null;

  function pickGroup(index: number) {
    setGroupIndex(index);
    setChoice("");
    setMarkedDangerous(false);
  }

  async function addPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const photo = await preparePodPhoto(file);
      setPhotos((current) => [...current, photo].slice(0, DEFECT_PHOTOS_MAX));
    } finally {
      setBusy(false);
    }
  }

  function done() {
    if (!choice) {
      setError("Choose the defect, or Other.");
      return;
    }
    const result = draftToDefect({ clientId, catalogueItemId: choice === OTHER ? null : choice, markedDangerous: showRaise && markedDangerous, note }, catalogue);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone({ defect: result.defect, resolved: result.resolved, photos });
  }

  return (
    <div className={c.box}>
      {groups.length > 1 ? (
        <label className="grid gap-1">
          <span className={c.heading}>Which part of the vehicle?</span>
          <select className={c.input} value={groupIndex} onChange={(e) => pickGroup(Number(e.target.value))}>
            {groups.map((g, i) => (
              <option key={`${g.category}-${i}`} value={i}>
                {g.itemLabel}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className={c.heading}>{group?.itemLabel ?? "Defect"}</p>
      )}

      <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className={`${c.muted} mb-1`}>What is wrong?</legend>
        {(group?.defects ?? []).map((item) => (
          <label key={item.id} className={c.option}>
            <input type="radio" name={name} className="mt-1" checked={choice === item.id} onChange={() => setChoice(item.id)} />
            <span>
              {item.defectLabel}
              {item.severity === "dangerous" ? <span className={c.badge}>Dangerous: vehicle will go off the road</span> : null}
            </span>
          </label>
        ))}
        <label className={c.option}>
          <input type="radio" name={name} className="mt-1" checked={choice === OTHER} onChange={() => setChoice(OTHER)} />
          <span>Other (describe it in the note)</span>
        </label>
      </fieldset>

      {guidance ? <p className={c.muted}>What to look for: {guidance}</p> : null}

      {showRaise ? (
        <label className={c.option}>
          <input type="checkbox" className="mt-1" checked={markedDangerous} onChange={(e) => setMarkedDangerous(e.target.checked)} />
          <span>This is dangerous, the vehicle should not be driven</span>
        </label>
      ) : null}

      <label className="grid gap-1">
        <span className={c.muted}>Note{choice === OTHER ? " (required)" : " (optional)"}</span>
        <textarea className={c.textarea} value={note} maxLength={DEFECT_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
      </label>

      <div className="grid gap-2">
        <span className={c.muted}>
          Photos: {photos.length} of {DEFECT_PHOTOS_MAX}
        </span>
        {photos.map((photo, i) => (
          <div key={`${photo.filename}-${i}`} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{photo.filename}</span>
            <button type="button" className={c.secondary} onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        {photos.length < DEFECT_PHOTOS_MAX ? (
          <label className={`${c.secondary} flex cursor-pointer items-center justify-center`}>
            {busy ? "Preparing photo..." : "Add photo"}
            <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy} onChange={(e) => void addPhoto(e)} />
          </label>
        ) : null}
      </div>

      {error ? <p className={c.error}>{error}</p> : null}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={c.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={c.primary} disabled={busy} onClick={done}>
          Add defect
        </button>
      </div>
    </div>
  );
}
