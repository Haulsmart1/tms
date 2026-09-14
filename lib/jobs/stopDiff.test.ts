import { describe, expect, it } from "vitest";
import { isStopLocked, planStopChanges, type ExistingStop } from "./stopDiff";

function existing(overrides: Partial<ExistingStop> & { id: string }): ExistingStop {
  return {
    stop_order: 1,
    type: "delivery",
    address_line: "1 High St",
    city: "Leeds",
    postcode: "LS1 1AA",
    status: "planned",
    pod_status: "pending",
    delivered_at: null,
    collected_at: null,
    evidenceCount: 0,
    scanCount: 0,
    ...overrides,
  };
}

const col = existing({ id: "c1", stop_order: 1, type: "collection", address_line: "Depot", city: "York", postcode: "YO1" });
const del = existing({ id: "d1", stop_order: 2 });

describe("isStopLocked", () => {
  it("treats pending stops as editable", () => {
    expect(isStopLocked(del)).toBe(false);
    expect(isStopLocked({ ...del, pod_status: null })).toBe(false);
  });

  it("locks delivered, collected or completed stops", () => {
    expect(isStopLocked({ ...del, pod_status: "delivered" })).toBe(true);
    expect(isStopLocked({ ...del, pod_status: "collected" })).toBe(true);
    expect(isStopLocked({ ...del, status: "completed" })).toBe(true);
    expect(isStopLocked({ ...del, delivered_at: "2026-09-14T10:00:00Z" })).toBe(true);
  });
});

describe("planStopChanges", () => {
  it("changes nothing when the form matches the stops", () => {
    const plan = planStopChanges([col, del], [
      { id: "c1", type: "collection", address_line: "Depot", city: "York", postcode: "YO1" },
      { id: "d1", type: "delivery", address_line: "1 High St", city: "Leeds", postcode: "LS1 1AA" },
    ]);
    expect(plan).toEqual({ ok: true, updates: [], inserts: [], deletes: [] });
  });

  it("updates in place, keeps ids and inserts new stops", () => {
    const plan = planStopChanges([col, del], [
      { id: "c1", type: "collection", address_line: "Depot 2", city: "York", postcode: "" },
      { id: "d1", type: "delivery", address_line: "1 High St", city: "Leeds", postcode: "LS1 1AA" },
      { type: "delivery", address_line: " 9 Low Rd ", city: "", postcode: "M1" },
    ]);
    expect(plan).toEqual({
      ok: true,
      updates: [{ id: "c1", patch: { stop_order: 1, type: "collection", address_line: "Depot 2", city: "York", postcode: null } }],
      inserts: [{ stop_order: 3, type: "delivery", address_line: "9 Low Rd", city: null, postcode: "M1" }],
      deletes: [],
    });
  });

  it("deletes a removed stop that has no POD, evidence or scans", () => {
    const plan = planStopChanges([col, del], [{ id: "c1", type: "collection", address_line: "Depot", city: "York", postcode: "YO1" }]);
    expect(plan).toEqual({ ok: true, updates: [], inserts: [], deletes: ["d1"] });
  });

  it("refuses to remove a stop with evidence or scans", () => {
    const submitted = [{ id: "c1", type: "collection" as const, address_line: "Depot", city: "York", postcode: "YO1" }];
    expect(planStopChanges([col, { ...del, evidenceCount: 1 }], submitted)).toMatchObject({ ok: false });
    expect(planStopChanges([col, { ...del, scanCount: 2 }], submitted)).toMatchObject({
      ok: false,
      message: "Delivery stop 2 has POD evidence or barcode scans and cannot be removed.",
    });
  });

  it("refuses to remove or re-address a delivered stop, but allows reordering it", () => {
    const delivered = { ...del, pod_status: "delivered", recipient_name: "Ann" };
    expect(planStopChanges([col, delivered], [{ id: "c1", type: "collection", address_line: "Depot", city: "York", postcode: "YO1" }])).toEqual({
      ok: false,
      message: "Delivery stop 2 has POD recorded and cannot be removed.",
    });
    expect(
      planStopChanges([col, delivered], [
        { id: "c1", type: "collection", address_line: "Depot", city: "York", postcode: "YO1" },
        { id: "d1", type: "delivery", address_line: "2 High St", city: "Leeds", postcode: "LS1 1AA" },
      ]),
    ).toMatchObject({ ok: false });
    expect(
      planStopChanges([col, delivered], [
        { id: "d1", type: "delivery", address_line: "1 High St", city: "Leeds", postcode: "LS1 1AA" },
        { id: "c1", type: "collection", address_line: "Depot", city: "York", postcode: "YO1" },
      ]),
    ).toEqual({
      ok: true,
      updates: [{ id: "d1", patch: { stop_order: 1 } }, { id: "c1", patch: { stop_order: 2, type: "collection", address_line: "Depot", city: "York", postcode: "YO1" } }],
      inserts: [],
      deletes: [],
    });
  });

  it("refuses unknown or duplicated stop ids", () => {
    expect(planStopChanges([del], [{ id: "zzz", type: "delivery", address_line: "x", city: "", postcode: "" }])).toMatchObject({ ok: false });
    expect(
      planStopChanges([del], [
        { id: "d1", type: "delivery", address_line: "1 High St", city: "Leeds", postcode: "LS1 1AA" },
        { id: "d1", type: "delivery", address_line: "1 High St", city: "Leeds", postcode: "LS1 1AA" },
      ]),
    ).toMatchObject({ ok: false });
  });
});
