import { describe, it, expect } from "vitest";
import { splitDeliveryStops, waitingLabel, type PodJob } from "./queue";

const NOW = new Date("2026-08-13T12:00:00Z");

const job = (over: Partial<PodJob> = {}): PodJob => ({
  id: "j1",
  reference: "J-1042",
  status: "planned",
  scheduled_date: "2026-08-11",
  customer_name: "Northern Freight",
  vehicle_registration: "MV-12-TRP",
  vehicle_model: "Scania R450",
  driver_name: "A. Okafor",
  customer_price: 1200,
  stops: [
    { id: "s1", stop_order: 1, type: "collection", city: "Leeds", postcode: "LS1 4AP",
      pod_status: "delivered", planned_at: "2026-08-11T08:00:00Z", delivered_at: "2026-08-11T09:00:00Z",
      pod_photo_url: null, pod_document_url: null },
    { id: "s2", stop_order: 2, type: "delivery", city: "Hull", postcode: "HU1 2BG",
      pod_status: "pending", planned_at: "2026-08-11T08:00:00Z", delivered_at: null,
      pod_photo_url: null, pod_document_url: "doc.pdf" },
  ],
  ...over,
});

describe("splitDeliveryStops", () => {
  it("puts an undelivered delivery stop in awaiting", () => {
    const { awaiting, completed } = splitDeliveryStops([job()], NOW);
    expect(awaiting.map((r) => r.stopId)).toEqual(["s2"]);
    expect(completed).toEqual([]);
  });

  it("excludes collection stops from both lists", () => {
    const { awaiting, completed } = splitDeliveryStops([job()], NOW);
    expect([...awaiting, ...completed].some((r) => r.stopId === "s1")).toBe(false);
  });

  it("puts a delivered delivery stop in completed regardless of job status", () => {
    const j = job({ status: "completed" });
    j.stops[1] = { ...j.stops[1], pod_status: "delivered", delivered_at: "2026-08-12T10:00:00Z" };
    const { awaiting, completed } = splitDeliveryStops([j], NOW);
    expect(awaiting).toEqual([]);
    expect(completed.map((r) => r.stopId)).toEqual(["s2"]);
  });

  it("drops an undelivered stop whose job is completed, matching the dashboard", () => {
    // Anomalous data: the delivered-cascade should make this impossible. It is
    // excluded here for the same reason the dashboard excludes it, so the two
    // pages report the same count.
    const { awaiting } = splitDeliveryStops([job({ status: "completed" })], NOW);
    expect(awaiting).toEqual([]);
  });

  it("sorts awaiting oldest first, with null planned_at last", () => {
    const a = job({ id: "a", reference: "J-A" });
    a.stops[1] = { ...a.stops[1], id: "sa", planned_at: "2026-08-12T08:00:00Z" };
    const b = job({ id: "b", reference: "J-B" });
    b.stops[1] = { ...b.stops[1], id: "sb", planned_at: "2026-08-09T08:00:00Z" };
    const c = job({ id: "c", reference: "J-C" });
    c.stops[1] = { ...c.stops[1], id: "sc", planned_at: null };
    const { awaiting } = splitDeliveryStops([a, b, c], NOW);
    expect(awaiting.map((r) => r.stopId)).toEqual(["sb", "sa", "sc"]);
  });

  it("carries the fields the row renders", () => {
    const { awaiting } = splitDeliveryStops([job()], NOW);
    expect(awaiting[0]).toMatchObject({
      stopId: "s2",
      jobReference: "J-1042",
      customerName: "Northern Freight",
      originCity: "Leeds",
      destinationCity: "Hull",
      destinationPostcode: "HU1 2BG",
      vehicleRegistration: "MV-12-TRP",
      driverName: "A. Okafor",
      hasPhoto: false,
      hasDocument: true,
      isOverdue: true,
    });
    expect(awaiting[0].ageHours).toBeCloseTo(52, 0);
  });

  it("reports no origin when a job has no collection stop", () => {
    const j = job();
    j.stops = [j.stops[1]];
    const { awaiting } = splitDeliveryStops([j], NOW);
    expect(awaiting[0].originCity).toBeNull();
  });
});

describe("waitingLabel", () => {
  it("formats days and hours", () => {
    expect(waitingLabel(52)).toBe("2 d 4 h");
  });

  it("formats hours alone under a day", () => {
    expect(waitingLabel(3.4)).toBe("3 h");
  });

  it("formats minutes under an hour, so a fresh stop does not read as 0 h", () => {
    expect(waitingLabel(0.5)).toBe("30 m");
  });

  it("returns a dash when the age is unknown", () => {
    expect(waitingLabel(null)).toBe("—");
  });
});
