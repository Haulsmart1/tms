import { describe, expect, it } from "vitest";
import { activeCatalogue, groupByItem, missingChecklistItems, requiredChecklistItems, toSnapshot, validateCompanyItem } from "./catalogue";
import type { CatalogueItem } from "./types";

function item(over: Partial<CatalogueItem>): CatalogueItem {
  return {
    id: over.id ?? "id-" + (over.code ?? "x"),
    companyId: null,
    code: "brakes.air_leak",
    category: "brakes_air",
    itemLabel: "Brakes and air build-up",
    defectLabel: "Audible air leak",
    guidance: "Listen for leaks.",
    severity: "dangerous",
    appliesTo: "both",
    sortOrder: 10,
    retiredAt: null,
    ...over,
  };
}

describe("activeCatalogue", () => {
  it("keeps baseline and this company's items, drops other companies and retired rows, baseline first", () => {
    const rows = [
      item({ id: "c1", companyId: "co-1", code: "co.tail_lift.leak", category: "tail_lift", sortOrder: 5 }),
      item({ id: "b2", code: "tyres.tread", sortOrder: 20 }),
      item({ id: "b1", code: "brakes.air_leak", sortOrder: 10 }),
      item({ id: "x", companyId: "co-2", code: "co.crane.x" }),
      item({ id: "r", companyId: "co-1", code: "co.old.y", retiredAt: "2026-09-01T00:00:00Z" }),
    ];
    expect(activeCatalogue(rows, "co-1").map((r) => r.id)).toEqual(["b1", "b2", "c1"]);
  });
});

describe("checklist coverage (S-5)", () => {
  const rows = [
    item({ id: "v1", code: "lights.out", appliesTo: "vehicle" }),
    item({ id: "b1", code: "brakes.air_leak", appliesTo: "both" }),
    item({ id: "t1", code: "trailer.coupling", appliesTo: "trailer" }),
    item({ id: "c1", companyId: "co-1", code: "co.tail_lift.leak", appliesTo: "vehicle" }),
    item({ id: "x", companyId: "co-2", code: "co.crane.x", appliesTo: "vehicle" }),
    item({ id: "r", code: "old.row", appliesTo: "vehicle", retiredAt: "2026-09-01T00:00:00Z" }),
  ];

  it("requires every active vehicle and both row of the baseline and this company, not trailer-only rows", () => {
    expect(requiredChecklistItems(rows, "co-1").map((i) => i.id).sort()).toEqual(["b1", "c1", "v1"]);
  });

  it("accepts a full checklist, with or without trailer rows", () => {
    expect(missingChecklistItems(rows, "co-1", ["v1", "b1", "c1"])).toEqual([]);
    expect(missingChecklistItems(rows, "co-1", ["v1", "b1", "c1", "t1"])).toEqual([]);
  });

  it("names what a one-item checklist left out", () => {
    expect(missingChecklistItems(rows, "co-1", ["b1"]).map((i) => i.id).sort()).toEqual(["c1", "v1"]);
  });

  it("does not let another company's or a retired row stand in for a required one", () => {
    expect(missingChecklistItems(rows, "co-1", ["x", "r", "b1", "c1"]).map((i) => i.id)).toEqual(["v1"]);
  });
});

describe("groupByItem", () => {
  it("groups consecutive defects by category in catalogue order", () => {
    const rows = [
      item({ id: "a", category: "brakes_air", itemLabel: "Brakes" }),
      item({ id: "b", category: "brakes_air", itemLabel: "Brakes" }),
      item({ id: "c", category: "tyres_wheels", itemLabel: "Tyres" }),
    ];
    const groups = groupByItem(rows);
    expect(groups.map((g) => [g.category, g.itemLabel, g.defects.map((d) => d.id)])).toEqual([
      ["brakes_air", "Brakes", ["a", "b"]],
      ["tyres_wheels", "Tyres", ["c"]],
    ]);
  });
});

describe("toSnapshot", () => {
  it("records source and drops internal fields", () => {
    const snap = toSnapshot([item({ id: "b1" }), item({ id: "c1", companyId: "co-1", code: "co.a.b" })]);
    expect(snap[0]).toEqual({
      id: "b1",
      code: "brakes.air_leak",
      category: "brakes_air",
      itemLabel: "Brakes and air build-up",
      defectLabel: "Audible air leak",
      guidance: "Listen for leaks.",
      severity: "dangerous",
      source: "baseline",
    });
    expect(snap[1].source).toBe("company");
  });
});

describe("validateCompanyItem", () => {
  const good = {
    category: "Tail lift",
    itemLabel: "Tail-lift",
    defectLabel: "Hydraulic leak",
    guidance: "Look under the platform.",
    severity: "dangerous",
    appliesTo: "vehicle",
  };

  it("accepts a valid item and builds a co. prefixed code", () => {
    const result = validateCompanyItem(good, new Set());
    expect(result).toEqual({
      ok: true,
      value: {
        code: "co.tail_lift.hydraulic_leak",
        category: "tail_lift",
        itemLabel: "Tail-lift",
        defectLabel: "Hydraulic leak",
        guidance: "Look under the platform.",
        severity: "dangerous",
        appliesTo: "vehicle",
      },
    });
  });

  it("suffixes the code when it already exists", () => {
    const result = validateCompanyItem(good, new Set(["co.tail_lift.hydraulic_leak"]));
    expect(result.ok && result.value.code).toBe("co.tail_lift.hydraulic_leak_2");
  });

  it("refuses bad severity, missing labels and over-long text", () => {
    expect(validateCompanyItem({ ...good, severity: "critical" }, new Set()).ok).toBe(false);
    expect(validateCompanyItem({ ...good, defectLabel: "  " }, new Set()).ok).toBe(false);
    expect(validateCompanyItem({ ...good, itemLabel: "x".repeat(81) }, new Set()).ok).toBe(false);
    expect(validateCompanyItem({ ...good, guidance: "x".repeat(401) }, new Set()).ok).toBe(false);
  });

  it("defaults appliesTo to vehicle", () => {
    const result = validateCompanyItem({ ...good, appliesTo: undefined }, new Set());
    expect(result.ok && result.value.appliesTo).toBe("vehicle");
  });
});
