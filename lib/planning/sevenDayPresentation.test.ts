import { describe, expect, it } from "vitest";
import { scheduleDriverRoute } from "./driverSchedule";
import type { PlanningDriverSchedulePreview } from "./planningDriverSchedule";
import { buildSevenDayPresentation, remainingSevenDayTaskIds } from "./sevenDayPresentation";
import { buildEditableSevenDayPlan, moveEditablePlanRange, parseSevenDayEditorDrafts } from "./sevenDayPlanEditor";
import { createSavedPlanSnapshot, parseSavedPlanSnapshot, savedPlanSnapshotToPendingItineraries } from "./savedPlan";
import { createPlanningDraft, parsePlanningDraft, planningDraftMatchesPlan } from "./draftCache";

const HOUR = 3600;
function preview(count = 3, travel = 4 * HOUR, available = true): PlanningDriverSchedulePreview {
  const schedule = scheduleDriverRoute({
    planningProfile: "tramper", startLocationId: "base", activityDataAvailable: true,
    ruleProfile: { id: "test", label: "test", regime: "assimilated", effectiveFrom: "2026-01-01", verified: false, sourceReference: null, maxContinuousDrivingSeconds: 4.5 * HOUR, qualifyingBreakSeconds: .75 * HOUR, maxDailyDrivingSeconds: 9 * HOUR, dailyRestSeconds: 11 * HOUR, maxDutyWindowSeconds: 13 * HOUR },
    tasks: Array.from({ length: count }, (_, i) => ({ id: `stop:${i}`, locationId: `${i}`, serviceSeconds: 600 })),
    travelSecondsBetween: () => available ? travel : null,
  });
  return { schedule, planningStart: new Date("2026-10-09T07:00:00Z"), dropEtas: schedule.events.filter((event) => event.kind === "service").map((event, i) => ({ dropNumber: i + 1, jobId: `job:${i}`, stopId: event.taskId!.slice(5), serviceStartSeconds: event.startSeconds, serviceEndSeconds: event.endSeconds })) };
}

describe("SevenDay integration with current scheduling", () => {
  it("keeps a task spanning drive days visible and assigns its stop once at service completion", () => {
    const value = preview();
    // Future-compatible projection: partial driving may be emitted across days.
    value.schedule.events.unshift({ kind: "drive", day: 1, startSeconds: 0, endSeconds: 3600, durationSeconds: 3600, locationId: "0", taskId: "stop:0" });
    for (const event of value.schedule.events) if (event.kind === "service") event.day = 2;
    const days = buildSevenDayPresentation(value);
    expect(days).toHaveLength(7);
    expect(days[0].events.some((event) => event.taskId === "stop:0")).toBe(true);
    expect(days[0].taskIds).not.toContain("stop:0");
    expect(days[1].taskIds).toContain("stop:0");
    expect(days.flatMap((day) => day.taskIds)).toEqual(value.schedule.completedTaskIds);
    expect(days[0].totals.dailyRestCount).toBe(1);
    expect(days[0].totals.breakCount).toBeGreaterThan(0);
    expect(days.reduce((n, day) => n + day.totals.driveSeconds, 0)).toBe(13 * HOUR);
  });
  it("shows horizon overflow in canonical remaining order without truncating the scheduler", () => {
    const value = preview(20);
    expect(value.schedule.days.length).toBeGreaterThan(7);
    const ids = Array.from({ length: 20 }, (_, i) => `stop:${i}`);
    const remaining = remainingSevenDayTaskIds(value, ids);
    expect(remaining.length).toBeGreaterThan(0);
    expect([...buildSevenDayPresentation(value).flatMap((day) => day.taskIds), ...remaining]).toEqual(ids);
    expect(buildEditableSevenDayPlan(ids, value).stops.filter((stop) => stop.day === 0).map((stop) => stop.taskId)).toEqual(remaining);
  });
  it("shows unavailable travel as remaining work", () => {
    const value = preview(3, HOUR, false);
    expect(value.schedule.status).toBe("unschedulable");
    expect(remainingSevenDayTaskIds(value, ["stop:0", "stop:1", "stop:2"])).toEqual(value.schedule.unscheduledTaskIds);
  });
  it("retains completed zero-duration services without inventing an ETA", () => {
    const value = preview(3, HOUR);
    value.schedule.events = value.schedule.events.filter((event) => event.taskId !== "stop:1" || event.kind !== "service");
    value.dropEtas = value.dropEtas.filter((drop) => drop.stopId !== "1");
    expect(buildSevenDayPresentation(value)[0].taskIds).toEqual(["stop:0", "stop:1", "stop:2"]);
    expect(remainingSevenDayTaskIds(value, ["stop:0", "stop:1", "stop:2"])).toEqual([]);
  });
  it("retains 25 ordered stops without renumbering on day boundaries", () => {
    const value = preview(25, HOUR);
    expect(buildSevenDayPresentation(value).flatMap((day) => day.drops).map((drop) => drop.dropNumber)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
  it("moves a canonical suffix and refuses reversal or a scheduled successor of remaining work", () => {
    const plan = buildEditableSevenDayPlan(["stop:0", "stop:1", "stop:2"], preview(3, HOUR));
    const rules = [{ taskId: "stop:1", precedenceTaskIds: ["stop:0"] }, { taskId: "stop:2", precedenceTaskIds: ["stop:1"] }];
    expect(moveEditablePlanRange(plan, "stop:1", "stop:2", 2, rules).ok).toBe(true);
    expect(moveEditablePlanRange(plan, "stop:0", "stop:0", 2, rules).ok).toBe(false);
    expect(moveEditablePlanRange(plan, "stop:0", "stop:0", 0, rules).ok).toBe(false);
  });
  it("round trips edited allocations with dates and assignments through named snapshots and local recovery", () => {
    const draft = { signature: "2026-10-09\u001fdriver\u001fEurope/London\u001fstop:0", edited: true, plan: { stops: [{ taskId: "stop:0", canonicalIndex: 0, day: 2 as const }] } };
    const snapshot = createSavedPlanSnapshot({ planningDate: "2026-10-09", lanes: [{ vehicleId: "vehicle", driverId: "driver", jobIds: ["job"] }], pendingItineraries: {}, persistedItineraries: {}, editorDrafts: { vehicle: draft } });
    const loaded = parseSavedPlanSnapshot(JSON.parse(JSON.stringify(snapshot)))!;
    expect(loaded.editorDrafts?.vehicle).toEqual(draft);
    expect(loaded.lanes[0]).toEqual(snapshot.lanes[0]);
    expect(loaded.planningDate).toBe("2026-10-09");
    expect(savedPlanSnapshotToPendingItineraries(loaded)).toEqual({});
    const local = createPlanningDraft({ tenantId: "tenant", date: loaded.planningDate, updatedAt: 1000, laneOrders: { vehicle: ["job"] }, laneDrivers: { vehicle: "driver" }, selectedVehicleId: "vehicle", baseline: { job: ["vehicle", "driver", 1] }, editorDrafts: loaded.editorDrafts });
    const restored = parsePlanningDraft(JSON.stringify(local), { tenantId: "tenant", date: loaded.planningDate, now: 1000, validVehicleIds: new Set(["vehicle"]), validDriverIds: new Set(["driver"]), validJobIds: new Set(["job"]) })!;
    expect(restored.editorDrafts).toEqual(loaded.editorDrafts);
    expect(planningDraftMatchesPlan(restored, local.laneOrders, local.laneDrivers, ["vehicle"])).toBe(false);
    expect(parseSevenDayEditorDrafts({ vehicle: { ...draft, signature: "wrong" } })).toBeNull();
  });
});
