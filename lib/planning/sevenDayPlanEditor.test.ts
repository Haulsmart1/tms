import { describe, expect, it } from "vitest";
import { buildEditableSevenDayPlan, moveEditablePlanRange, parseSevenDayEditorDrafts } from "./sevenDayPlanEditor";
import type { PlanningDriverSchedulePreview } from "./planningDriverSchedule";

const empty: PlanningDriverSchedulePreview = { planningStart: new Date(), dropEtas: [], schedule: { days: [], events: [], warnings: [], completedTaskIds: [], unscheduledTaskIds: ["stop:a", "stop:b"], status: "unschedulable", planningAssumption: true } };
describe("Recovered range editing against current preview", () => {
  it("keeps canonical order when a reversed selection is moved", () => {
    const plan = buildEditableSevenDayPlan(["stop:a", "stop:b"], empty);
    const moved = moveEditablePlanRange(plan, "stop:b", "stop:a", 3);
    expect(moved).toEqual({ ok: true, plan: { stops: [{ taskId: "stop:a", canonicalIndex: 0, day: 3 }, { taskId: "stop:b", canonicalIndex: 1, day: 3 }] } });
    expect(plan.stops.every((stop) => stop.day === 0)).toBe(true);
  });
  it("refuses duplicate IDs, missing tasks and invalid horizons", () => {
    expect(() => buildEditableSevenDayPlan(["stop:a", "stop:a"], empty)).toThrow("unique");
    const plan = buildEditableSevenDayPlan(["stop:a", "stop:b"], empty);
    expect(moveEditablePlanRange(plan, "absent", "stop:b", 1)).toEqual({ ok: false, reason: "unknown_task" });
    for (const day of [-1, 8, 1.5, NaN]) expect(moveEditablePlanRange(plan, "stop:a", "stop:b", day)).toEqual({ ok: false, reason: "invalid_day" });
  });
  it("validates stored allocation order and treats legacy snapshots as having no draft", () => {
    expect(parseSevenDayEditorDrafts(undefined)).toEqual({});
    expect(parseSevenDayEditorDrafts({ vehicle: { signature: "date\u001fdriver\u001fzone\u001fstop:a\u001fstop:b", edited: true, plan: { stops: [{ taskId: "stop:a", canonicalIndex: 0, day: 3 }, { taskId: "stop:b", canonicalIndex: 1, day: 2 }] } } })).toBeNull();
    expect(parseSevenDayEditorDrafts({ vehicle: null })).toBeNull();
  });
});
