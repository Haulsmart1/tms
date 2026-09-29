/*
  What the driver picks in the defect picker, turned into the defect the queue
  sends. Pure and client-safe. The driver may raise a minor defect to
  dangerous, never lower one: there is no field for it.
*/

import type { QueuedDefect } from "../shifts/events";
import { resolveDefect, type ResolvedDefect } from "./severity";
import type { CatalogueItem } from "./types";

export type DefectDraft = {
  clientId: string;
  /** Null for "Other". */
  catalogueItemId: string | null;
  /** The driver ticked "This is dangerous". Ignored for a defect the catalogue already calls dangerous. */
  markedDangerous: boolean;
  note: string;
};

export const DEFECT_NOTE_MAX = 1000;
export const DEFECT_PHOTOS_MAX = 5;

/** Only a minor catalogue defect or "Other" can be raised by the driver. */
export function canMarkDangerous(item: CatalogueItem | null): boolean {
  return item === null || item.severity === "minor";
}

export function draftToDefect(
  draft: DefectDraft,
  catalogue: ReadonlyMap<string, CatalogueItem>,
): { ok: true; defect: QueuedDefect; resolved: ResolvedDefect } | { ok: false; error: string } {
  const note = draft.note.trim();
  if (note.length > DEFECT_NOTE_MAX) return { ok: false, error: "Keep the note under 1000 characters." };
  const item = draft.catalogueItemId ? catalogue.get(draft.catalogueItemId) ?? null : null;
  const defect: QueuedDefect = {
    clientId: draft.clientId,
    catalogueItemId: draft.catalogueItemId,
    driverSeverity: draft.markedDangerous && canMarkDangerous(item) ? "dangerous" : null,
    note: note || null,
  };
  const resolved = resolveDefect(defect, catalogue);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  return { ok: true, defect, resolved: resolved.value };
}
