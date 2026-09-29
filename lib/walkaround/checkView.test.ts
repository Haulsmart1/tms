import { describe, expect, it } from "vitest";
import { groupCheckForView, parseSnapshot } from "./checkView";

const snapshot = parseSnapshot([
  { id: "a1", code: "b.lights.1", category: "lights", itemLabel: "Lights", defectLabel: "Not working", guidance: "", severity: "minor", source: "baseline" },
  { id: "a2", code: "b.lights.2", category: "lights", itemLabel: "Lights", defectLabel: "Cracked lens", guidance: "", severity: "minor", source: "baseline" },
  { id: "b1", code: "b.brakes.1", category: "brakes", itemLabel: "Brakes", defectLabel: "Air leak", guidance: "", severity: "dangerous", source: "baseline" },
  "not an item",
  { id: 7, category: "broken" },
]);

describe("parseSnapshot", () => {
  it("keeps well-formed items and skips the rest", () => {
    expect(snapshot.map((i) => i.id)).toEqual(["a1", "a2", "b1"]);
    expect(snapshot[2].severity).toBe("dangerous");
  });

  it("reads anything that is not an array as empty", () => {
    expect(parseSnapshot(null)).toEqual([]);
    expect(parseSnapshot({ id: "x" })).toEqual([]);
  });
});

describe("groupCheckForView", () => {
  it("puts each defect under its checklist item and leaves the rest OK", () => {
    const view = groupCheckForView(snapshot, [
      { id: "d1", catalogueItemId: "a2" },
      { id: "d2", catalogueItemId: null },
      { id: "d3", catalogueItemId: "gone" },
    ]);
    expect(view.groups.map((g) => [g.itemLabel, g.defects.map((d) => d.id)])).toEqual([
      ["Lights", ["d1"]],
      ["Brakes", []],
    ]);
    expect(view.other.map((d) => d.id)).toEqual(["d2", "d3"]);
  });
});
