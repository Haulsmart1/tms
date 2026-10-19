import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriverQueuePayload } from "./driverSync";
import type { StoredItem } from "./idbStore";

const store = vi.hoisted(() => ({ rows: [] as StoredItem<DriverQueuePayload>[], deletes: [] as string[] }));
vi.mock("./idbStore", () => ({
  idbLoadAll: async () => [...store.rows],
  idbPut: async (item: StoredItem<DriverQueuePayload>) => { store.rows = [...store.rows.filter((row) => row.id !== item.id), item]; },
  idbDelete: async (id: string) => { store.deletes.push(id); store.rows = store.rows.filter((row) => row.id !== id); },
  isMemoryOnly: () => false,
}));
vi.mock("../supabase/browser", () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { user: { id: "driver-a" } } }, error: null }),
  onAuthStateChange: vi.fn(),
} }) }));

const base = { ownerId: "driver-a", clientId: "client-a", jobId: "job-a", stopId: "stop-a", shiftClientId: null, recordedAt: "2026-10-18T05:00:00Z" };
const payloads: DriverQueuePayload[] = [
  { ...base, kind: "pod_photo", blob: new Blob(["original photo"]), mimeType: "image/jpeg", filename: "proof.jpg" },
  { ...base, kind: "pod_scan", jobItemId: "item-a", serialNumber: "SERIAL-A", scanFormat: "CODE_128" },
  { ...base, kind: "pod_complete", recipientName: "Recipient", podNotes: "Delivered" },
];
let responseBody: unknown;
let malformed = false;
let responseStatus = 200;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  store.rows = [];
  store.deletes = [];
  responseBody = {};
  malformed = false;
  responseStatus = 200;
  vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/upload-url")) return new Response(JSON.stringify({ path: "saved-photo-path", token: null }), { status: 200 });
    return new Response(responseStatus === 204 ? null : malformed ? "<html>Sign in</html>" : JSON.stringify(responseBody), { status: responseStatus });
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function flush(payload: DriverQueuePayload) {
  store.rows = [{ id: "queued-a", seq: 1, payload, attempts: 0, serverFailures: 0, nextAttemptAt: 1e15, lastError: null }];
  const queue = await import("../../app/driver/driverQueue");
  await queue.flushDriverQueue();
  return queue;
}

it.each(payloads)("keeps $kind after a non-JSON 200 response", async (payload) => {
  malformed = true;
  const queue = await flush(payload);
  expect(store.deletes).toEqual([]);
  expect(queue.getQueueSnapshot().pending).toHaveLength(1);
  expect(store.rows[0].payload).toBe(payload);
});

it.each(payloads)("keeps $kind after a JSON 200 without confirmed success", async (payload) => {
  responseBody = { error: "Not saved" };
  const queue = await flush(payload);
  expect(store.deletes).toEqual([]);
  expect(queue.getQueueSnapshot().pending).toHaveLength(1);
});

it.each(payloads)("removes $kind only after explicit success", async (payload) => {
  // The real routes supply these additional fields. The acknowledgement
  // marker is their shared persistence contract, not the transport status.
  responseBody = payload.kind === "pod_photo" ? { ok: true, evidence: { id: "evidence-a" } }
    : payload.kind === "pod_scan" ? { ok: true, duplicate: true, scan: { id: "scan-a" } }
    : { ok: true, alreadyCompleted: true, completedAt: base.recordedAt, jobCompleted: false };
  const queue = await flush(payload);
  expect(store.deletes).toEqual(["queued-a"]);
  expect(queue.getQueueSnapshot().pending).toHaveLength(0);
});

it.each([{}, [], null, { ok: false }, { ok: "true" }])("keeps a photo for an ambiguous JSON success body %j", async (body) => {
  responseBody = body;
  await flush(payloads[0]);
  expect(store.deletes).toEqual([]);
  expect(store.rows).toHaveLength(1);
});

it("keeps a completion after an empty 204 acknowledgement", async () => {
  responseStatus = 204;
  await flush(payloads[2]);
  expect(store.deletes).toEqual([]);
  expect(store.rows).toHaveLength(1);
});

it("keeps the original photo after repeated ambiguous acknowledgements and then accepts a real retry ACK", async () => {
  const queue = await flush(payloads[0]);
  for (let attempt = 0; attempt < 6; attempt += 1) await queue.flushDriverQueue();
  expect(store.deletes).toEqual([]);
  expect(store.rows[0].payload).toBe(payloads[0]);
  expect(queue.getQueueSnapshot().rejected).toEqual([]);
  responseBody = { ok: true, evidence: { id: "evidence-a" } };
  await queue.flushDriverQueue();
  expect(store.deletes).toEqual(["queued-a"]);
});

it.each([401, 403, 409, 503])("retains POD for an HTTP %s despite an untrusted ok:true body", async (status) => {
  responseStatus = status;
  responseBody = { ok: true };
  await flush(payloads[2]);
  expect(store.deletes).toEqual([]);
  expect(store.rows).toHaveLength(1);
});
