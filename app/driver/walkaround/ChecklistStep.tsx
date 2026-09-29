"use client";
/*
  The checklist, based on the DVSA daily walkaround check plus the company's
  own items. Nothing is pre-marked: each item needs OK or Defect. Defect opens
  the shared DefectPicker for that item.
*/

import { useState } from "react";
import type { QueuedDefect } from "../../../lib/shifts/events";
import type { GroupAnswer, KeyedGroup } from "../../../lib/walkaround/checkWizard";
import { resolveDefect } from "../../../lib/walkaround/severity";
import type { CatalogueItem } from "../../../lib/walkaround/types";
import DefectPicker, { type PickedDefect } from "./DefectPicker";
import { w } from "./styles";

type Props = {
  groups: readonly KeyedGroup[];
  catalogue: ReadonlyMap<string, CatalogueItem>;
  answers: Readonly<Record<string, GroupAnswer>>;
  pullingTrailer: boolean;
  photoCount: (defectClientId: string) => number;
  onTrailer: (value: boolean) => void;
  onOk: (key: string) => void;
  onAddDefect: (key: string, picked: PickedDefect) => void;
  onRemoveDefect: (key: string, defectClientId: string) => void;
};

export default function ChecklistStep({ groups, catalogue, answers, pullingTrailer, photoCount, onTrailer, onOk, onAddDefect, onRemoveDefect }: Props) {
  const [picking, setPicking] = useState<string | null>(null);

  return (
    <>
      <p className={w.body}>Based on the DVSA daily walkaround check. Walk round the vehicle and mark every item.</p>
      <label className={w.check}>
        <input type="checkbox" className="mt-1 h-5 w-5" checked={pullingTrailer} onChange={(e) => onTrailer(e.target.checked)} />
        <span>I am pulling a trailer</span>
      </label>

      <ol className="m-0 grid list-none gap-3 p-0">
        {groups.map(({ key, group }) => {
          const answer = answers[key];
          const defects = answer?.status === "defect" ? answer.defects : [];
          return (
            <li key={key} className="rounded-xl border border-slate-200 p-4">
              <h2 className={w.h2}>{group.itemLabel}</h2>
              {group.defects[0]?.guidance ? <p className={`${w.body} mt-1`}>What to look for: {group.defects[0].guidance}</p> : null}

              {picking === key ? (
                <div className="mt-3">
                  <DefectPicker
                    groups={[group]}
                    catalogue={catalogue}
                    palette="light"
                    onCancel={() => setPicking(null)}
                    onDone={(picked) => {
                      onAddDefect(key, picked);
                      setPicking(null);
                    }}
                  />
                </div>
              ) : (
                <>
                  {defects.length > 0 ? (
                    <ul className="m-0 mt-3 grid list-none gap-2 p-0">
                      {defects.map((d) => (
                        <DefectRow key={d.clientId} defect={d} catalogue={catalogue} photos={photoCount(d.clientId)} onRemove={() => onRemoveDefect(key, d.clientId)} />
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={answer?.status === "ok" ? w.okOn : w.okOff}
                      aria-pressed={answer?.status === "ok"}
                      disabled={defects.length > 0}
                      onClick={() => onOk(key)}
                    >
                      OK
                    </button>
                    <button type="button" className={defects.length > 0 ? w.defectOn : w.defectOff} onClick={() => setPicking(key)}>
                      {defects.length > 0 ? "Add another defect" : "Defect"}
                    </button>
                  </div>
                  {defects.length > 0 ? <p className={`${w.muted} mt-2`}>Remove the defects to mark this item OK.</p> : null}
                </>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function DefectRow({ defect, catalogue, photos, onRemove }: { defect: QueuedDefect; catalogue: ReadonlyMap<string, CatalogueItem>; photos: number; onRemove: () => void }) {
  const resolved = resolveDefect(defect, catalogue);
  const label = resolved.ok ? resolved.value.label : "Defect";
  const dangerous = resolved.ok && resolved.value.finalSeverity === "dangerous";
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 p-3 text-sm">
      <span className="grid gap-1">
        <span className="font-bold">{label}</span>
        <span className="flex flex-wrap items-center gap-2">
          <span className={dangerous ? w.dangerBadge : w.minorBadge}>{dangerous ? "Dangerous" : "Minor"}</span>
          {photos > 0 ? <span className={w.muted}>{photos === 1 ? "1 photo" : `${photos} photos`}</span> : null}
        </span>
      </span>
      <button type="button" className={w.secondary} onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}
