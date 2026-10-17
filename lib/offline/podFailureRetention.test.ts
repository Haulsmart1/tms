import { describe, expect, it } from "vitest";
import { shouldHoldPodFailure } from "./podFailureRetention";
import { applyOutcome, enqueue, MAX_SERVER_FAILURES } from "./queue";

describe("POD evidence retention", () => {
  for (const kind of ["pod_photo", "pod_scan", "pod_complete"]) {
    it(`preserves ${kind} when repeated server failures would discard it`, () => {
      const payload = { kind, evidence: "must survive" };
      let queue = enqueue([], "pod-1", payload, 0);
      const failure = { kind: "retry", error: "database unavailable", status: 503 } as const;
      for (let attempt = 0; attempt < MAX_SERVER_FAILURES - 1; attempt++) {
        expect(shouldHoldPodFailure(kind, failure, queue[0].serverFailures)).toBe(false);
        queue = applyOutcome(queue, "pod-1", failure, attempt).queue;
      }
      expect(applyOutcome(queue, "pod-1", failure, 10).rejected).not.toBeNull();
      expect(shouldHoldPodFailure(kind, failure, queue[0].serverFailures)).toBe(true);
      expect(queue[0].payload).toBe(payload);
      expect(shouldHoldPodFailure(kind, { kind: "retry", error: "offline", status: null }, 4)).toBe(false);
      expect(shouldHoldPodFailure(kind, { kind: "sent" }, 4)).toBe(false);
      expect(shouldHoldPodFailure("event", failure, 4)).toBe(false);
    });
    it(`holds refused ${kind} without deleting the queued item`, () => {
      expect(shouldHoldPodFailure(kind, { kind: "rejected", error: "LIC03" })).toBe(true);
      expect(shouldHoldPodFailure(kind, { kind: "retry", error: "temporary", status: 503 })).toBe(false);
      expect(shouldHoldPodFailure(kind, { kind: "sent" })).toBe(false);
    });
  }
  it("does not change non-POD refusal handling", () => {
    expect(shouldHoldPodFailure("event", { kind: "rejected", error: "invalid" })).toBe(false);
  });
});
