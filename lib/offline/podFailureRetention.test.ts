import { describe, expect, it } from "vitest";
import { shouldHoldPodFailure } from "./podFailureRetention";

describe("POD evidence retention", () => {
  for (const kind of ["pod_photo", "pod_scan", "pod_complete"]) {
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
