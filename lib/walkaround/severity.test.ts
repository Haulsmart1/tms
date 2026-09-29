import { describe, expect, it } from "vitest";
import { checkResult, dangerReason, resolveDefect } from "./severity";
import type { CatalogueItem } from "./types";

const base: CatalogueItem = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: null,
  code: "brakes.air_leak",
  category: "brakes_air",
  itemLabel: "Brakes and air build-up",
  defectLabel: "Audible air leak",
  guidance: "Listen.",
  severity: "dangerous",
  appliesTo: "both",
  sortOrder: 10,
  retiredAt: null,
};
const minor: CatalogueItem = { ...base, id: "22222222-2222-4222-8222-222222222222", code: "horn.inoperative", itemLabel: "Horn", defectLabel: "Horn does not work", severity: "minor" };
const companyMinor: CatalogueItem = { ...minor, id: "33333333-3333-4333-8333-333333333333", companyId: "co-1", code: "co.tail_lift.slow" };
const retired: CatalogueItem = { ...minor, id: "44444444-4444-4444-8444-444444444444", retiredAt: "2026-01-01T00:00:00Z" };
const catalogue = new Map([base, minor, companyMinor, retired].map((i) => [i.id, i]));

const d = (over: object) => ({ clientId: "c", catalogueItemId: base.id, driverSeverity: null, note: null, ...over });

describe("resolveDefect", () => {
  it("takes severity from the catalogue", () => {
    const r = resolveDefect(d({}), catalogue);
    expect(r).toMatchObject({ ok: true, value: { finalSeverity: "dangerous", catalogueSeverity: "dangerous", escalatedByDriver: false, severitySource: "baseline", label: "Brakes and air build-up: Audible air leak" } });
  });

  it("never lets the driver downgrade a dangerous defect", () => {
    const r = resolveDefect(d({ driverSeverity: "minor" }), catalogue);
    expect(r.ok && r.value.finalSeverity).toBe("dangerous");
  });

  it("lets the driver escalate a minor defect and records it", () => {
    const r = resolveDefect(d({ catalogueItemId: minor.id, driverSeverity: "dangerous" }), catalogue);
    expect(r).toMatchObject({ ok: true, value: { finalSeverity: "dangerous", catalogueSeverity: "minor", escalatedByDriver: true, severitySource: "driver" } });
  });

  it("marks company items as company-sourced", () => {
    const r = resolveDefect(d({ catalogueItemId: companyMinor.id }), catalogue);
    expect(r.ok && r.value.severitySource).toBe("company");
  });

  it("treats Other as minor unless the driver marks it dangerous, and needs a note", () => {
    expect(resolveDefect(d({ catalogueItemId: null, note: "  " }), catalogue).ok).toBe(false);
    const minorOther = resolveDefect(d({ catalogueItemId: null, note: "Cab step cracked" }), catalogue);
    expect(minorOther).toMatchObject({ ok: true, value: { finalSeverity: "minor", catalogueSeverity: null, severitySource: "driver", label: "Other: Cab step cracked" } });
    const dangerOther = resolveDefect(d({ catalogueItemId: null, note: "Smoke from wheel", driverSeverity: "dangerous" }), catalogue);
    expect(dangerOther.ok && dangerOther.value.finalSeverity).toBe("dangerous");
    expect(dangerOther.ok && dangerOther.value.escalatedByDriver).toBe(true);
  });

  it("refuses unknown and retired items", () => {
    expect(resolveDefect(d({ catalogueItemId: "55555555-5555-4555-8555-555555555555" }), catalogue).ok).toBe(false);
    expect(resolveDefect(d({ catalogueItemId: retired.id }), catalogue).ok).toBe(false);
  });
});

describe("checkResult", () => {
  it("is pass, minor or dangerous by the worst defect", () => {
    expect(checkResult([])).toBe("pass");
    expect(checkResult([{ finalSeverity: "minor" }])).toBe("minor");
    expect(checkResult([{ finalSeverity: "minor" }, { finalSeverity: "dangerous" }])).toBe("dangerous");
  });
});

describe("dangerReason", () => {
  it("explains where the classification came from", () => {
    expect(dangerReason({ finalSeverity: "dangerous", severitySource: "baseline" }, "Acme")).toBe("Classed dangerous in the DVSA baseline checklist.");
    expect(dangerReason({ finalSeverity: "dangerous", severitySource: "company" }, "Acme")).toBe("Classed dangerous by Acme for this item.");
    expect(dangerReason({ finalSeverity: "dangerous", severitySource: "company" }, null)).toBe("Classed dangerous by your company for this item.");
    expect(dangerReason({ finalSeverity: "dangerous", severitySource: "driver" }, "Acme")).toBe("You marked this as dangerous.");
    expect(dangerReason({ finalSeverity: "minor", severitySource: "baseline" }, "Acme")).toBeNull();
  });
});
