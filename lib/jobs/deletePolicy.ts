export type ProtectedJobLinkCounts = {
  invoiceJobs: number;
  invoices: number;
  supplierPurchaseOrderJobs: number;
};

const deletableJobStatuses = new Set([
  "pending_acceptance",
  "planned",
]);

export function canDeleteJobStatus(
  status: string | null | undefined
): boolean {
  return (
    typeof status === "string" &&
    deletableJobStatuses.has(status)
  );
}

export type OperationalJobRecordCounts = {
  podEvidence: number;
  itemScans: number;
};

/* A planned job can already carry POD uploads or barcode scans. Deleting it
   would orphan the storage objects (review POD-23), so it is refused. */
export function hasOperationalJobRecords(
  records: OperationalJobRecordCounts
): boolean {
  return records.podEvidence > 0 || records.itemScans > 0;
}

export function hasProtectedJobLinks(
  links: ProtectedJobLinkCounts
): boolean {
  return (
    links.invoiceJobs > 0 ||
    links.invoices > 0 ||
    links.supplierPurchaseOrderJobs > 0
  );
}
