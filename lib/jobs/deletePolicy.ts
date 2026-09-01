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

export function hasProtectedJobLinks(
  links: ProtectedJobLinkCounts
): boolean {
  return (
    links.invoiceJobs > 0 ||
    links.invoices > 0 ||
    links.supplierPurchaseOrderJobs > 0
  );
}
