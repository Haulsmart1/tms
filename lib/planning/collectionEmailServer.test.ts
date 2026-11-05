import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { exampleJob, appointment, deliveryJob } from "./collectionEmailFixtures";
import { loadCollectionEmails, sendCollectionEmail } from "./collectionEmailServer";
import { sendMicrosoftGraphEmail } from "../documents/delivery";
import { documentEmailAllowed } from "../documents/emailLimits";
vi.mock("../pod/brandingServer", () => ({ loadPodBranding: vi.fn(async () => ({ carrierName: "Example Carrier" })) }));
vi.mock("../documents/emailLimits", () => ({ documentEmailAllowed: vi.fn(async () => true) }));
vi.mock("../documents/delivery", () => ({ sendMicrosoftGraphEmail: vi.fn(async () => ({ acknowledgementId: "graph-accepted" })) }));

function database({ conflict = false, logUpdateFails = false, foreign = false } = {}) {
  const records: Record<string, any> = {};
  const requests: { url: URL; method: string }[] = [];
  const client = createClient("https://email-test.invalid", "test-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? "GET"; requests.push({ url, method });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname.endsWith("/jobs")) return json(foreign ? [] : [deliveryJob]);
    if (method === "POST") {
      const body = JSON.parse(String(init?.body));
      if (conflict || records[body.idempotency_key]) return json({ code: "23505" }, 409);
      records[body.idempotency_key] = { ...body, id: "log-1" }; return json({ id: "log-1" });
    }
    if (method === "PATCH") {
      if (logUpdateFails) return json({ code: "TEST" }, 500);
      Object.assign(Object.values(records)[0], JSON.parse(String(init?.body))); return new Response(null, { status: 204 });
    }
    const key = url.searchParams.get("idempotency_key")?.slice(3);
    return json(key && records[key] ? { status: records[key].status } : null);
  } } });
  return { client, records, requests };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(documentEmailAllowed).mockResolvedValue(true); vi.mocked(sendMicrosoftGraphEmail).mockResolvedValue({ acknowledgementId: "graph-accepted" }); });
describe("collection email delivery", () => {
  it("keeps collection and delivery times distinct and deduplicates only the same appointment", async () => {
    const db = database();
    const load = async (options: typeof appointment) => (await loadCollectionEmails(db.client, exampleJob.tenant_id, [exampleJob.id], options))[0];
    const original = await load(appointment);
    const explicitCollection = await load({ ...appointment, stopType: "collection", timeFrom: "unused" });
    expect(explicitCollection.key).toBe(original.key);
    const options = { ...appointment, stopType: "delivery" as const, window: "CUSTOM" as const, timeFrom: "14:30" };
    const message = await load(options);
    expect((await load({ ...options, timeTo: "" })).key).toBe(message.key);
    expect((await load({ ...options, timeFrom: "15:00" })).key).not.toBe(message.key);
    expect((await load({ ...options, timeTo: "16:00" })).key).not.toBe(message.key);
    expect((await load({ ...options, stopType: "collection" })).key).not.toBe(message.key);
    expect((await load({ ...options, timeFrom: "15:00" })).preview.fingerprint).not.toBe(message.preview.fingerprint);
    await sendCollectionEmail(db.client, "operator", message, options);
    const record = Object.values(db.records)[0];
    expect(record.recipient_email).toBe("deliver@example.test");
    expect(record.stop_id).toBe(deliveryJob.job_stops[1].id);
    expect(record.metadata).toMatchObject({ stopType: "delivery", timeFrom: "14:30", deliveryDate: appointment.date });
    expect(record.metadata).not.toHaveProperty("collectionDate");
    expect(sendMicrosoftGraphEmail).toHaveBeenCalledWith(expect.objectContaining({ recipient: "deliver@example.test" }));
    expect((await sendCollectionEmail(db.client, "operator", message, options)).status).toBe("already_sent");
    expect(sendMicrosoftGraphEmail).toHaveBeenCalledTimes(1);
  });
  it("scopes job lookups to the tenant and fails closed on missing/foreign jobs", async () => {
    const db = database({ foreign: true });
    await expect(loadCollectionEmails(db.client, exampleJob.tenant_id, [exampleJob.id], appointment)).rejects.toThrow("unavailable");
    expect(db.requests[0].url.searchParams.get("tenant_id")).toBe(`eq.${exampleJob.tenant_id}`);
    expect(sendMicrosoftGraphEmail).not.toHaveBeenCalled();
  });
  it("claims before sending, records acceptance and never repeats an accepted email", async () => {
    const db = database(); const [message] = await loadCollectionEmails(db.client, exampleJob.tenant_id, [exampleJob.id], appointment);
    expect((await sendCollectionEmail(db.client, "operator", message, appointment)).status).toBe("accepted");
    expect((await sendCollectionEmail(db.client, "operator", message, appointment)).status).toBe("already_sent");
    expect(sendMicrosoftGraphEmail).toHaveBeenCalledTimes(1);
    expect(Object.values(db.records)[0].status).toBe("accepted");
    expect(db.requests.filter((r) => r.method !== "GET").every((r) => r.url.pathname.endsWith("job_notification_log"))).toBe(true);
  });
  it("does not send after a concurrent claim or a rate refusal", async () => {
    const db = database({ conflict: true }); const [message] = await loadCollectionEmails(db.client, exampleJob.tenant_id, [exampleJob.id], appointment);
    expect((await sendCollectionEmail(db.client, "operator", message, appointment)).status).toBe("skipped");
    vi.mocked(documentEmailAllowed).mockResolvedValue(false);
    expect((await sendCollectionEmail(db.client, "operator", message, appointment)).message).toContain("limit");
    expect(sendMicrosoftGraphEmail).not.toHaveBeenCalled();
  });
  it("keeps ambiguous failures claimed so retry cannot duplicate a possibly accepted message", async () => {
    const db = database(); const [message] = await loadCollectionEmails(db.client, exampleJob.tenant_id, [exampleJob.id], appointment);
    vi.mocked(sendMicrosoftGraphEmail).mockRejectedValue(new Error("timeout"));
    expect((await sendCollectionEmail(db.client, "operator", message, appointment)).status).toBe("failed");
    expect((await sendCollectionEmail(db.client, "operator", message, appointment)).status).toBe("skipped");
    expect(sendMicrosoftGraphEmail).toHaveBeenCalledTimes(1);
  });
  it("does not turn provider acceptance into failure when the final log update fails", async () => {
    const db = database({ logUpdateFails: true }); const [message] = await loadCollectionEmails(db.client, exampleJob.tenant_id, [exampleJob.id], appointment);
    expect((await sendCollectionEmail(db.client, "operator", message, appointment)).status).toBe("accepted");
    expect((await sendCollectionEmail(db.client, "operator", message, appointment)).status).toBe("skipped");
    expect(sendMicrosoftGraphEmail).toHaveBeenCalledTimes(1);
  });
});
