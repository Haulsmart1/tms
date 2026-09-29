import { describe, expect, it } from "vitest";
import { canMarkDangerous, draftToDefect } from "./defectDraft";
import type { CatalogueItem } from "./types";

const item = (over: Partial<CatalogueItem>): CatalogueItem => ({
  id: "i1",
  companyId: null,
  code: "lights.lamp_out",
  category: "lights",
  itemLabel: "Lights",
  defectLabel: "Lamp not working",
  guidance: "Check every lamp.",
  severity: "minor",
  appliesTo: "both",
  sortOrder: 1,
  retiredAt: null,
  ...over,
});

const minor = item({});
const dangerous = item({ id: "i2", code: "brakes.leak", defectLabel: "Air leak", severity: "dangerous" });
const catalogue = new Map([minor, dangerous].map((i) => [i.id, i]));

describe("draftToDefect", () => {
  it("keeps a minor defect minor unless the driver raises it", () => {
    const plain = draftToDefect({ clientId: "d1", catalogueItemId: "i1", markedDangerous: false, note: "" }, catalogue);
    expect(plain.ok && plain.defect).toEqual({ clientId: "d1", catalogueItemId: "i1", driverSeverity: null, note: null });
    expect(plain.ok && plain.resolved.finalSeverity).toBe("minor");

    const raised = draftToDefect({ clientId: "d1", catalogueItemId: "i1", markedDangerous: true, note: " cracked " }, catalogue);
    expect(raised.ok && raised.defect).toEqual({ clientId: "d1", catalogueItemId: "i1", driverSeverity: "dangerous", note: "cracked" });
    expect(raised.ok && raised.resolved.finalSeverity).toBe("dangerous");
  });

  it("never sends a severity for a defect the catalogue already calls dangerous", () => {
    const r = draftToDefect({ clientId: "d1", catalogueItemId: "i2", markedDangerous: true, note: "" }, catalogue);
    expect(r.ok && r.defect.driverSeverity).toBeNull();
    expect(r.ok && r.resolved.finalSeverity).toBe("dangerous");
  });

  it("needs a note for Other", () => {
    expect(draftToDefect({ clientId: "d1", catalogueItemId: null, markedDangerous: false, note: "  " }, catalogue)).toEqual({ ok: false, error: "Describe the defect." });
    const other = draftToDefect({ clientId: "d1", catalogueItemId: null, markedDangerous: true, note: "Loose load strap" }, catalogue);
    expect(other.ok && other.resolved.finalSeverity).toBe("dangerous");
  });

  it("refuses an unknown item and an over-long note", () => {
    expect(draftToDefect({ clientId: "d1", catalogueItemId: "nope", markedDangerous: false, note: "" }, catalogue).ok).toBe(false);
    expect(draftToDefect({ clientId: "d1", catalogueItemId: "i1", markedDangerous: false, note: "x".repeat(1001) }, catalogue).ok).toBe(false);
  });
});

describe("canMarkDangerous", () => {
  it("allows raising minor and Other only", () => {
    expect(canMarkDangerous(minor)).toBe(true);
    expect(canMarkDangerous(null)).toBe(true);
    expect(canMarkDangerous(dangerous)).toBe(false);
  });
});
