import { MAX_SERVER_FAILURES, type SendOutcome } from "./queue";

/** Never discard a POD event on an explicit refusal. It is evidence until reconciled. */
export function shouldHoldPodFailure(kind: string, outcome: SendOutcome, serverFailures = 0): boolean {
  return (kind === "pod_photo" || kind === "pod_scan" || kind === "pod_complete")
    && (outcome.kind === "rejected" || (outcome.kind === "retry"
      && typeof outcome.status === "number" && outcome.status >= 500
      && serverFailures + 1 >= MAX_SERVER_FAILURES));
}
