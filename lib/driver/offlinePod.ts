/*
  The checks the server runs on a POD, run on the phone before an item is
  queued, so a driver with no signal is told at the doorstep rather than hours
  later when the queue sends. The server still runs every check itself; these
  reuse the same pure rules (lib/driver/pod.ts, completionRules.ts, barcode.ts).
*/

import { findExpectedSerial, type JobItemScanLike, type SerializedJobItem } from "./barcode";
import { barcodeCompletionBlock } from "./completionRules";
import { validatePodCompletion } from "./pod";

/** The scans route's wording for a serial already verified on the job. */
export const ALREADY_VERIFIED_MESSAGE = "This item has already been verified on this job.";

/** `verified`: scans the server holds plus scans already queued on this phone. */
export function checkQueuedScan(input: { items: SerializedJobItem[]; verified: JobItemScanLike[]; value: string }):
  | { ok: true; jobItemId: string; serialNumber: string }
  | { ok: false; duplicate: boolean; message: string } {
  const match = findExpectedSerial(input.items, input.value);
  if (!match.ok) return { ok: false, duplicate: false, message: match.message };
  if (input.verified.some((v) => v.job_item_id === match.itemId && v.serial_number === match.serialNumber)) {
    return { ok: false, duplicate: true, message: ALREADY_VERIFIED_MESSAGE };
  }
  return { ok: true, jobItemId: match.itemId, serialNumber: match.serialNumber };
}

export function checkQueuedCompletion(input: {
  recipientName: string;
  podNotes: string;
  /** Evidence on the server plus photos queued for this stop. */
  evidenceCount: number;
  legacyPhotoUrl: string | null;
  items: SerializedJobItem[];
  verified: JobItemScanLike[];
  otherOutstandingDeliveryStops: number;
}): { ok: true } | { ok: false; message: string } {
  const validation = validatePodCompletion({
    recipientName: input.recipientName,
    podNotes: input.podNotes,
    evidenceCount: input.evidenceCount,
    legacyPhotoUrl: input.legacyPhotoUrl,
  });
  if (!validation.ok) return { ok: false, message: validation.message };

  const block = barcodeCompletionBlock({
    items: input.items,
    scans: input.verified,
    otherOutstandingDeliveryStops: input.otherOutstandingDeliveryStops,
  });
  return block ? { ok: false, message: block } : { ok: true };
}
