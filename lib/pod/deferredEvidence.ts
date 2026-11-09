/** Retained as an audit flag after the missing evidence is uploaded. */
export const DEFERRED_EVIDENCE_FLAG = "pod_evidence_deferred";

export function isDeferredDelivery(stop: {
  type: string;
  pod_status: string | null;
  pod_flags?: string[] | null;
}): boolean {
  return stop.type === "delivery" && stop.pod_status === "delivered"
    && Boolean(stop.pod_flags?.includes(DEFERRED_EVIDENCE_FLAG));
}
