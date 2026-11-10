import { describe, expect, it, vi } from "vitest";
import { savedPlanSummary, type SavedPlanRow } from "./savedPlan";
import { moveSavedPlanToNextDay } from "./savedPlanStore";

const date = "2026-12-31";
const nextDay = "2027-01-01";
const draft = {
  signature: [date, "driver", "Europe/London", "stop:1"].join("\u001f"),
  plan: { stops: [{ taskId: "stop:1", canonicalIndex: 0, day: 2 }] },
  edited: true,
};
const snapshot = {
  version: 1,
  planningDate: date,
  lanes: [{ vehicleId: "van", driverId: "driver", jobIds: ["job-b", "job-a"] }],
  canonicalItineraries: [],
  editorDrafts: { van: draft },
};
const row: SavedPlanRow = {
  id: "plan",
  tenant_id: "tenant",
  name: "CBA",
  planning_date: date,
  snapshot,
  created_by: null,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-10T12:00:00Z",
};

function fixture(conflict = false) {
  const read = {
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  const write = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  };
  const update = vi.fn((patch: Partial<SavedPlanRow>) => {
    write.maybeSingle.mockResolvedValue({ data: conflict ? null : { ...row, ...patch }, error: null });
    return write;
  });
  const client = { from: vi.fn((_table: string) => ({ select: () => read, update })) };
  return { client, update, write };
}

describe("move saved plan to next day", () => {
  it("moves the same plan across a year boundary and retains the route order and day allocations", async () => {
    const { client, update, write } = fixture();
    const moved = await moveSavedPlanToNextDay(client, "tenant", savedPlanSummary(row));
    expect(moved.id).toBe(row.id);
    expect(moved.planningDate).toBe(nextDay);
    expect(moved.snapshot).toEqual({
      ...snapshot,
      planningDate: nextDay,
      editorDrafts: { van: { ...draft, signature: draft.signature.replace(date, nextDay) } },
    });
    expect(update).toHaveBeenCalledOnce();
    expect(write.eq.mock.calls).toEqual([
      ["tenant_id", "tenant"], ["id", "plan"], ["planning_date", date], ["updated_at", row.updated_at],
    ]);
    expect(client.from.mock.calls.every(([table]) => table === "planning_saved_plans")).toBe(true);
  });

  it("refuses a stale row and a change between reading and saving", async () => {
    const stale = fixture();
    await expect(moveSavedPlanToNextDay(stale.client, "tenant", {
      ...savedPlanSummary(row), planningDate: nextDay,
    })).rejects.toThrow("This saved plan changed.");
    expect(stale.update).not.toHaveBeenCalled();

    const concurrent = fixture(true);
    await expect(moveSavedPlanToNextDay(concurrent.client, "tenant", savedPlanSummary(row)))
      .rejects.toThrow("This saved plan changed.");
  });
});
