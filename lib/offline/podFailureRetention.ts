import type { SendOutcome } from "./queue";

/** Never discard a POD event on an explicit refusal. It is evidence until reconciled. */
export function shouldHoldPodFailure(kind: string, outcome: SendOutcome): boolean {
  return (kind === "pod_photo" || kind === "pod_scan" || kind === "pod_complete")
    && outcome.kind === "rejected";
}
