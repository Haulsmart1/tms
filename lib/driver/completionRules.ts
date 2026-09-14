/*
  Barcode verification before completion (review POD-12, POD-20).

  Scan model, stated once: serialised items belong to the JOB, not to a stop
  (job_items has no stop), so verification is job-wide and a serial counts once
  per job. A scan records the delivery stop it was taken at, for the audit
  trail. Scans are only taken at delivery stops.

  Enforcement: every expected serial must be verified before the job's FINAL
  outstanding delivery is completed. Earlier drops on a multi-drop job are not
  blocked, because nothing says which serial goes to which drop.
*/

import { barcodeProgress, type JobItemScanLike, type SerializedJobItem } from "./barcode";

export function barcodeCompletionBlock(input: {
  items: readonly SerializedJobItem[];
  scans: readonly JobItemScanLike[];
  otherOutstandingDeliveryStops: number;
}): string | null {
  if (input.otherOutstandingDeliveryStops > 0) return null;
  const progress = barcodeProgress([...input.items], [...input.scans]);
  if (progress.remaining === 0) return null;
  return `Scan every serialised item before completing the final delivery (${progress.verified} of ${progress.expected} verified).`;
}
