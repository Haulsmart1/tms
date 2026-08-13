import { describe, it, expect } from "vitest";
import { podAgeHours, isAwaitingPod, isPodOverdue, POD_OVERDUE_HOURS } from "./overdue";
import { buildNeedsAttention } from "../dashboard/aggregate";

const NOW = new Date("2026-08-13T12:00:00Z");

describe("podAgeHours", () => {
  it("returns elapsed hours since planned_at", () => {
    expect(podAgeHours("2026-08-13T08:00:00Z", NOW)).toBeCloseTo(4, 5);
    expect(podAgeHours("2026-08-11T12:00:00Z", NOW)).toBeCloseTo(48, 5);
  });

  it("returns null for a null planned_at rather than a misleading number", () => {
    // planned_at is nullable: app/jobs/page.tsx only sets it when the job has a
    // scheduled_date. Returning 0 or Infinity here would silently make undated
    // jobs look either fresh or maximally overdue.
    expect(podAgeHours(null, NOW)).toBeNull();
  });

  it("returns null for an unparseable date rather than NaN", () => {
    expect(podAgeHours("not-a-date", NOW)).toBeNull();
  });
});

describe("isAwaitingPod", () => {
  const awaiting = { type: "delivery", pod_status: "pending", jobStatus: "planned" };

  it("is true for a planned job's undelivered delivery stop", () => {
    expect(isAwaitingPod(awaiting)).toBe(true);
  });

  it("is false for collection stops, which have no POD form", () => {
    expect(isAwaitingPod({ ...awaiting, type: "collection" })).toBe(false);
  });

  it("is false once the stop is delivered", () => {
    expect(isAwaitingPod({ ...awaiting, pod_status: "delivered" })).toBe(false);
  });

  it("is false when the job is no longer planned, matching the dashboard", () => {
    // app/dashboard/page.tsx:94-96 filters overdue POD stops to jobs.status
    // === "planned". POD must apply the same predicate or the two pages will
    // report different counts for the same data.
    expect(isAwaitingPod({ ...awaiting, jobStatus: "completed" })).toBe(false);
  });

  it("treats a missing pod_status as awaiting, since the column is nullable", () => {
    expect(isAwaitingPod({ ...awaiting, pod_status: null })).toBe(true);
  });
});

describe("isPodOverdue", () => {
  it("is true past the threshold", () => {
    expect(isPodOverdue("2026-08-11T11:00:00Z", NOW)).toBe(true);
  });

  it("is false at exactly the threshold, so the boundary is not double-counted", () => {
    expect(isPodOverdue("2026-08-11T12:00:00Z", NOW)).toBe(false);
  });

  it("is false when planned_at is null", () => {
    expect(isPodOverdue(null, NOW)).toBe(false);
  });
});

describe("POD_OVERDUE_HOURS", () => {
  it("is 48", () => {
    expect(POD_OVERDUE_HOURS).toBe(48);
  });
});

describe("dashboard and POD agree about the same stop", () => {
  it("computes the same age for a stop as buildNeedsAttention reports", () => {
    const plannedAt = "2026-08-11T08:00:00Z";
    const [item] = buildNeedsAttention(
      [{ stopId: "s1", jobRef: "J-1", plannedAt }],
      [],
      NOW,
    );
    expect(item.ageHours).toBeCloseTo(podAgeHours(plannedAt, NOW)!, 10);
  });
});
