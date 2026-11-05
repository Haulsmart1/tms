import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import StopCard, { type Stop } from "../../app/jobs/StopCard";
import { initialStopPodForm } from "./consolePod";
import { saveStopPod } from "./savePod";

vi.mock("../../lib/supabase/browser", () => ({ createClient: () => ({}) }));
vi.mock("../../app/components/TenantProvider", () => ({ useTenant: () => ({ activeTenantId: "tenant" }) }));

const stop: Stop = {
  id: "stop", stop_order: 1, type: "collection", address_line: "1 Test Street", city: "Test", postcode: "AA1 1AA",
  contact_name: "Collection Contact", contact_phone: "01234", contact_email: "contact@example.test",
  status: "pending", pod_status: "pending", recipient_name: null, delivered_at: null, collected_at: null,
  pod_notes: "Keep this note", pod_photo_url: null,
};
const render = (value: Stop) => renderToStaticMarkup(createElement(StopCard, {
  jobId: "job", tenantId: "tenant", stop: value, podForm: undefined, onPodFieldChange: () => {},
  onMarkCollected: async () => true, onMarkDelivered: async () => true,
}));

describe("office collection confirmation", () => {
  it("offers Mark collected with optional evidence and the collection contact prefilled", () => {
    const markup = render(stop);
    expect(markup).toContain("Mark collected");
    expect(markup).toContain("Collection evidence (optional)");
    expect(markup).toContain('value="Collection Contact"');
    expect(markup).not.toContain("Mark Delivered");
    expect(markup).not.toContain("Send tracking link");
    expect(initialStopPodForm(stop).pod_notes).toBe("Keep this note");
  });
  it("shows the collection timestamp after sign-off and retains a separate delivery action", () => {
    const markup = render({ ...stop, pod_status: "collected", collected_at: "2026-11-05T10:00:00Z" });
    expect(markup).toContain("Collected at:");
    expect(markup).not.toContain("Mark collected");
    const delivery = render({ ...stop, type: "delivery" });
    expect(delivery).toContain("Mark Delivered");
    expect(delivery).not.toContain("Collection evidence (optional)");
    expect(initialStopPodForm({ ...stop, type: "delivery" }).recipient_name).toBe("");
  });
  it("records collection without evidence, scopes the write and leaves delivery/job completion untouched", async () => {
    const requests: { url: URL; method: string; body: any }[] = [];
    const client = createClient("https://test.invalid", "test-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input)), method = init?.method || "GET";
      requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const result = method === "GET" ? { id: "job", status: "planned" } : [{ id: "stop" }];
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    } } });
    const result = await saveStopPod(client, { tenantId: "tenant", jobId: "job", stopId: "stop", stopType: "collection",
      recipientName: "Collection Contact", podNotes: "Office confirmed collection", markComplete: true }, new Date("2026-11-05T10:00:00Z"));
    expect(result.jobCompleted).toBe(false);
    expect(requests).toHaveLength(2);
    const write = requests[1];
    expect(write.url.pathname).toBe("/rest/v1/job_stops");
    expect(write.url.searchParams.get("tenant_id")).toBe("eq.tenant");
    expect(write.url.searchParams.get("job_id")).toBe("eq.job");
    expect(write.url.searchParams.get("type")).toBe("eq.collection");
    expect(write.url.searchParams.get("collected_at")).toBe("is.null");
    expect(write.url.searchParams.get("delivered_at")).toBe("is.null");
    expect(write.url.searchParams.getAll("or")).toEqual(["(pod_status.is.null,pod_status.eq.pending)", "(status.is.null,status.not.in.(completed,collected,delivered))"]);
    expect(write.body).toMatchObject({ status: "completed", pod_status: "collected", collected_at: "2026-11-05T10:00:00.000Z" });
    expect(write.body).not.toHaveProperty("delivered_at");
    expect(write.body).not.toHaveProperty("pod_photo_url");
  });
  it.each(["cancelled", "completed"])("does not write collection for a %s job", async (status) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "job", status }), { headers: { "Content-Type": "application/json" } }));
    const client = createClient("https://test.invalid", "test-key", { auth: { persistSession: false }, global: { fetch } });
    await expect(saveStopPod(client, { tenantId: "tenant", jobId: "job", stopId: "stop", stopType: "collection",
      recipientName: "Contact", podNotes: "", markComplete: true })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not report success when another operator already completed the stop", async () => {
    const client = createClient("https://test.invalid", "test-key", { auth: { persistSession: false }, global: { fetch: async (_input, init) =>
      new Response(JSON.stringify(init?.method === "PATCH" ? [] : { id: "job", status: "planned" }), { headers: { "Content-Type": "application/json" } })
    } });
    await expect(saveStopPod(client, { tenantId: "tenant", jobId: "job", stopId: "stop", stopType: "collection",
      recipientName: "Contact", podNotes: "", markComplete: true })).rejects.toThrow("already completed");
  });

});
