import { describe, it, expect } from "vitest";
import { podKpis, attentionItems } from "./kpis";
import type { QueueRow } from "./queue";

const NOW = new Date("2026-08-13T12:00:00Z");

const row = (over: Partial<QueueRow> = {}): QueueRow => ({
  stopId: "s1", jobId: "j1", jobReference: "J-1", customerName: "C",
  originCity: "Leeds", destinationCity: "Hull", destinationPostcode: "HU1",
  vehicleRegistration: "AB-12-CDE", vehicleModel: "DAF", driverName: "D",
  dropCount: 1, hasPhoto: false, hasDocument: false,
  ageHours: 10, isOverdue: false, deliveredAt: null, stops: [],
  ...over,
});

describe("podKpis", () => {
  it("counts awaiting stops", () => {
    const k = podKpis([row(), row({ stopId: "s2" })], [], new Map(), NOW);
    expect(k.awaiting).toBe(2);
  });

  it("counts stops delivered today only", () => {
    const completed = [
      row({ stopId: "c1", deliveredAt: "2026-08-13T09:00:00Z" }),
      row({ stopId: "c2", deliveredAt: "2026-08-12T09:00:00Z" }),
    ];
    expect(podKpis([], completed, new Map(), NOW).deliveredToday).toBe(1);
  });

  it("counts overdue stops", () => {
    const k = podKpis([row({ isOverdue: true }), row({ stopId: "s2" })], [], new Map(), NOW);
    expect(k.overdue).toBe(1);
  });

  it("sums job value once per job, not once per stop", () => {
    // A two-drop job has two awaiting stops but one customer_price. Summing per
    // stop would double-count the job's value.
    const prices = new Map([["j1", 1000]]);
    const k = podKpis([row({ stopId: "s1" }), row({ stopId: "s2" })], [], prices, NOW);
    expect(k.valueAwaiting).toBe(1000);
  });

  it("splits value into overdue and recent", () => {
    const prices = new Map([["j1", 800], ["j2", 200]]);
    const rows = [row({ jobId: "j1", isOverdue: true }), row({ jobId: "j2", stopId: "s2" })];
    const k = podKpis(rows, [], prices, NOW);
    expect(k.valueOverdue).toBe(800);
    expect(k.valueRecent).toBe(200);
    expect(k.valueAwaiting).toBe(1000);
  });

  it("treats a job with no price as zero rather than NaN", () => {
    const k = podKpis([row()], [], new Map(), NOW);
    expect(k.valueAwaiting).toBe(0);
  });
});

describe("attentionItems", () => {
  it("returns only overdue rows, oldest first", () => {
    const rows = [
      row({ stopId: "a", isOverdue: true, ageHours: 60 }),
      row({ stopId: "b", isOverdue: false, ageHours: 5 }),
      row({ stopId: "c", isOverdue: true, ageHours: 150 }),
    ];
    expect(attentionItems(rows).map((i) => i.stopId)).toEqual(["c", "a"]);
  });

  it("says what evidence is missing", () => {
    const [none] = attentionItems([row({ isOverdue: true })]);
    expect(none.missing).toBe("no photo, no document");

    const [photoOnly] = attentionItems([row({ isOverdue: true, hasPhoto: true })]);
    expect(photoOnly.missing).toBe("photo only");

    const [both] = attentionItems([row({ isOverdue: true, hasPhoto: true, hasDocument: true })]);
    expect(both.missing).toBe("evidence attached");
  });
});
