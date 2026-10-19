import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriverQueuePayload } from "./driverSync";
import type { StoredItem } from "./idbStore";

const state = vi.hoisted(() => ({ rows: [] as StoredItem<DriverQueuePayload>[], deletes: [] as string[], owner: "driver-a", upload: vi.fn(), reflect: vi.fn() }));
vi.mock("./idbStore", () => ({
  idbLoadAll: async () => [...state.rows].sort((a, b) => a.seq - b.seq),
  idbPut: async (item: StoredItem<DriverQueuePayload>) => { state.rows = [...state.rows.filter(row => row.id !== item.id), item].sort((a, b) => a.seq - b.seq); },
  idbDelete: async (id: string) => { state.deletes.push(id); state.rows = state.rows.filter(row => row.id !== id); },
  isMemoryOnly: () => false,
}));
vi.mock("./snapshotStore", () => ({ reflectAcceptedShift: state.reflect }));
vi.mock("../supabase/browser", () => ({ createClient: () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: state.owner } } }, error: null }), onAuthStateChange: vi.fn() },
  storage: { from: () => ({ uploadToSignedUrl: state.upload }) },
}) }));
const event: DriverQueuePayload = { kind: "event", ownerId: "driver-a", event: {
  type: "check_submitted", clientId: "11111111-1111-4111-8111-111111111111", occurredAt: "2026-10-18T10:00:00Z",
  phase: "start", shiftClientId: null, vehicleId: "22222222-2222-4222-8222-222222222222", confirmation: "qr",
  qrPayload: "original cab QR", typedRegistration: null, mismatchReason: null, odometer: 1000, previousEndOdometer: null,
  declarationAccepted: true, checklistItemIds: ["33333333-3333-4333-8333-333333333333"],
  defects: [{ clientId: "44444444-4444-4444-8444-444444444444", catalogueItemId: null, driverSeverity: "minor", note: "Mirror cracked" }],
} };
const photo: DriverQueuePayload = { kind: "photo", ownerId: "driver-a", defectClientId: "44444444-4444-4444-8444-444444444444", blob: new Blob(["original defect photo"]), mimeType: "image/jpeg", filename: "defect.jpg" };
let status = 503;
let failedEndpoint: "event" | "upload-url" | "photo-record" = "event";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); state.rows = []; state.deletes = []; state.owner = "driver-a";
  state.reflect.mockReset(); state.reflect.mockResolvedValue(undefined); state.upload.mockReset(); state.upload.mockResolvedValue({ error: null });
  status = 503; failedEndpoint = "event";
  vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  fetchMock = vi.fn(async (url: string) => {
    const endpoint = url.endsWith("/upload-url") ? "upload-url" : url.endsWith("/shift/events") ? "event" : "photo-record";
    const code = endpoint === failedEndpoint ? status : 200;
    return new Response(JSON.stringify(code >= 400 ? { error: "Temporarily unavailable" } : endpoint === "upload-url" ? { path: "walkaround-path", token: "signed-token" } : { ok: true, duplicate: true }), { status: code });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function begin(payloads: DriverQueuePayload[]) {
  state.rows = payloads.map((payload, index) => ({ id: `queued-${index}`, seq: index + 1, payload, attempts: 0, serverFailures: 0, nextAttemptAt: 1e15, lastError: null }));
  const queue = await import("../../app/driver/driverQueue");
  for (let attempt = 0; attempt < 7; attempt += 1) await queue.flushDriverQueue();
  return queue;
}

it("keeps a repeatedly failing check and its original QR plus dependent photo instead of deleting both", async () => {
  const queue = await begin([event, photo]);
  expect(state.rows.map(row => row.payload)).toEqual([event, photo]); expect(state.deletes).toEqual([]);
  expect(queue.getQueueSnapshot().paused).toMatch(/not sent/); expect(queue.getQueueSnapshot().rejected).toEqual([]);
  expect(state.reflect).not.toHaveBeenCalled(); expect(state.upload).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.every(call => String(call[0]).endsWith("/shift/events"))).toBe(true);
});

it.each(["upload-url", "photo-record"] as const)("keeps original bytes after repeated %s server failures", async endpoint => {
  failedEndpoint = endpoint; const queue = await begin([photo]);
  expect(state.rows).toHaveLength(1); expect(state.rows[0].payload).toBe(photo); expect(state.deletes).toEqual([]);
  expect(queue.getQueueSnapshot().paused).toMatch(/not sent/); expect(queue.getQueueSnapshot().rejected).toEqual([]);
});

it("can confirm the same retained event and photo on a manual retry without losing either payload", async () => {
  const queue = await begin([event, photo]); expect(state.rows).toHaveLength(2);
  status = 200;
  await queue.flushDriverQueue();
  expect(state.rows.map(row => row.payload)).toEqual([photo]); expect(state.deletes).toEqual(["queued-0"]);
  await queue.flushDriverQueue();
  expect(state.rows).toEqual([]); expect(state.deletes).toEqual(["queued-0", "queued-1"]);
  expect(state.reflect).toHaveBeenCalledTimes(1); expect(state.upload.mock.calls[0][2]).toBe(photo.blob);
});

it("holds the original owner's failed check when another driver signs in", async () => {
  const queue = await begin([event, photo]); expect(state.rows).toHaveLength(2);
  const previousCalls = fetchMock.mock.calls.length; state.owner = "driver-b";
  await queue.flushDriverQueue();
  expect(fetchMock.mock.calls).toHaveLength(previousCalls); expect(state.rows.map(row => row.payload)).toEqual([event, photo]);
  expect(state.deletes).toEqual([]); expect(queue.getQueueSnapshot().pending).toEqual([]); expect(queue.getQueueSnapshot().heldForOthers).toBe(2);
});

it("does not change the explicit event 409 refusal policy", async () => {
  status = 409; const queue = await begin([event, photo]);
  expect(state.rows).toEqual([]); expect(state.deletes).toEqual(["queued-1", "queued-0"]); expect(queue.getQueueSnapshot().rejected).toHaveLength(1);
});
