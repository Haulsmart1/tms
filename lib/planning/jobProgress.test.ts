import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlanJobCard from "../../app/planning/PlanJobCard";
import { planningJobProgress } from "./jobProgress";
import type { PlanJob, PlanStop } from "./types";

const collection: PlanStop = { id: "collect", type: "collection", stop_order: 1, address_line: "1 Test Road", city: "Test", postcode: "AA1 1AA", lat: null, lng: null };
const delivery: PlanStop = { ...collection, id: "deliver", type: "delivery", stop_order: 2 };
const job: PlanJob = { id: "job", tenant_id: "tenant", reference: "TEST-1", status: "accepted", collection_eta: null, delivery_eta: null, acceptance_note: null, accepted_at: null, accepted_by: null, vehicle_id: "van", driver_id: null, subcontractor_id: null, route_order: 1, customer_name: "Customer", stops: [collection, delivery] };

describe("van job progress", () => {
  it("does not mistake assignment or acceptance for collection", () => {
    expect(planningJobProgress(job)).toBe("pending");
    expect(planningJobProgress({ status: "planned", stops: [] })).toBe("pending");
  });
  it("uses collection completion even while the job is still accepted", () => {
    expect(planningJobProgress({ ...job, stops: [{ ...collection, collected_at: "2026-11-06T08:00:00Z" }, delivery] })).toBe("collected");
    expect(planningJobProgress({ ...job, stops: [{ ...collection, pod_status: "collected" }, delivery] })).toBe("collected");
  });
  it("recognises the older collection POD format without treating it as delivery", () => {
    expect(planningJobProgress({ ...job, stops: [{ ...collection, pod_status: "delivered", delivered_at: "2026-11-06T08:00:00Z" }, delivery] })).toBe("collected");
  });
  it("distinguishes partial collection and partial delivery", () => {
    expect(planningJobProgress({ ...job, stops: [{ ...collection, pod_status: "collected" }, collection, delivery] })).toBe("part_collected");
    expect(planningJobProgress({ ...job, stops: [{ ...collection, pod_status: "collected" }, { ...delivery, pod_status: "delivered" }, delivery] })).toBe("collected");
  });
  it("turns fully delivered work green even if the job status update lagged", () => {
    expect(planningJobProgress({ ...job, stops: [collection, { ...delivery, pod_status: "delivered" }] })).toBe("delivered");
    expect(planningJobProgress({ ...job, status: "completed" })).toBe("delivered");
  });
  it("does not treat failed or cancelled collections as successful", () => {
    expect(planningJobProgress({ ...job, stops: [{ ...collection, status: "failed" }, delivery] })).toBe("pending");
    expect(planningJobProgress({ ...job, status: "cancelled", stops: [{ ...collection, pod_status: "collected" }, delivery] })).toBe("pending");
  });
  it("offers undo only for active van-card collection failures", () => {
    const failed = { ...collection, status: "failed", pod_status: "failed", last_failed_attempt: {
      reason: "goods_not_available", clientId: "attempt", flags: ["office"],
    } };
    const render = (stop: PlanStop, readOnly = false) => renderToStaticMarkup(createElement(PlanJobCard, {
      job: { ...job, stops: [stop, delivery] }, sequence: 1, geocodeSettled: false,
      onSignOff: async () => {}, readOnly,
    }));
    expect(render(failed)).toContain("Goods not available");
    expect(render(failed)).toContain('aria-label="Undo failed collection at 1 Test Road"');
    expect(render({ ...failed, last_failed_attempt: { clientId: "driver-attempt", flags: [] } })).not.toContain("Undo");
    expect(render({ ...failed, status: "planned", pod_status: "pending" })).not.toContain("Undo");
    expect(render(failed, true)).not.toContain("Undo");
  });
  it("keeps amber progress visible when the card is selected", () => {
    const markup = renderToStaticMarkup(createElement(PlanJobCard, { job: { ...job, stops: [{ ...collection, pod_status: "collected" }, delivery] }, sequence: 1, geocodeSettled: false, selected: true }));
    expect(markup).toContain("bg-warning-tint");
    expect(markup).toContain("ring-2 ring-primary");
    expect(markup).toContain("Collected · On van");
  });
  it("keeps the green delivered card inspectable but not draggable", () => {
    const markup = renderToStaticMarkup(createElement(PlanJobCard, { job: { ...job, status: "completed" }, sequence: null, geocodeSettled: false, readOnly: true, onOpen: () => {} }));
    expect(markup).toContain('draggable="false"');
    expect(markup).toContain('role="button"');
    expect(markup).toContain("bg-success-tint");
    expect(markup).toContain("Delivered");
    expect(markup).not.toContain("Select job");
  });
});
