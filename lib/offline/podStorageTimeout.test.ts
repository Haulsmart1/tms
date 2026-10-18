import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriverQueuePayload } from "./driverSync";
import type { StoredItem } from "./idbStore";

const state = vi.hoisted(() => ({ rows: [] as StoredItem<DriverQueuePayload>[], deletes: [] as string[], upload: vi.fn() }));
vi.mock("./idbStore", () => ({ idbLoadAll: async () => [...state.rows],
  idbPut: async (item: StoredItem<DriverQueuePayload>) => { state.rows = [...state.rows.filter(row => row.id !== item.id), item]; },
  idbDelete: async (id: string) => { state.deletes.push(id); state.rows = state.rows.filter(row => row.id !== id); },
  isMemoryOnly: () => false }));
vi.mock("../supabase/browser", () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { user: { id: "driver" } } }, error: null }), onAuthStateChange: vi.fn() },
  storage: { from: () => ({ uploadToSignedUrl: state.upload }) } }) }));
const photo: DriverQueuePayload = { kind: "pod_photo", ownerId: "driver", clientId: "photo", jobId: "job", stopId: "stop",
  shiftClientId: null, recordedAt: "2026-10-18T07:00:00Z", blob: new Blob(["original photograph"]), mimeType: "image/jpeg", filename: "proof.jpg" };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); state.rows = []; state.deletes = []; state.upload.mockReset();
  vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/upload-url")
    ? { ok: true, path: "same-photo-path", token: "signed-token" } : { ok: true, evidence: { id: "saved" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function beginUpload() {
  state.rows = [{ id: "photo", seq: 1, payload: photo, attempts: 0, serverFailures: 0, nextAttemptAt: 1e15, lastError: null }];
  const runner = await import("../../app/driver/driverQueue");
  let settled = false;
  const pending = runner.flushDriverQueue().then(() => { settled = true; });
  await vi.waitFor(() => expect(state.upload).toHaveBeenCalledTimes(1));
  return { runner, pending, settled: () => settled };
}

it("bounds a stalled storage upload, retains the original photo, and releases the cross-tab flush lock", async () => {
  let locked = false;
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, work: () => Promise<void>) => {
    locked = true;
    try { await work(); } finally { locked = false; }
  } } });
  state.upload.mockImplementation(() => new Promise(() => {}));
  const { runner, pending, settled } = await beginUpload();
  expect(locked).toBe(true);
  await vi.advanceTimersByTimeAsync(20_001);
  expect(settled()).toBe(true);
  await pending;
  expect(locked).toBe(false);
  expect(state.rows[0].payload).toBe(photo);
  expect(state.deletes).toEqual([]);
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual([expect.stringContaining("/upload-url")]);
  expect(runner.getQueueSnapshot().pending).toHaveLength(1);
});

it.each(["success", "rejection"])("ignores a late storage %s without recording or deleting evidence", async outcome => {
  let resolveUpload!: (value: unknown) => void;
  let rejectUpload!: (error: Error) => void;
  state.upload.mockImplementation(() => new Promise((resolve, reject) => { resolveUpload = resolve; rejectUpload = reject; }));
  const { pending } = await beginUpload();
  await vi.advanceTimersByTimeAsync(20_001);
  await pending;
  if (outcome === "success") resolveUpload({ error: null });
  else rejectUpload(new Error("late SDK failure"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state.deletes).toEqual([]);
  expect(state.rows[0].payload).toBe(photo);
});

it("retries the same original photo/path without upsert, recording only after storage confirmation", async () => {
  state.upload.mockImplementationOnce(() => new Promise(() => {}));
  const { runner, pending } = await beginUpload();
  await vi.advanceTimersByTimeAsync(20_001);
  await pending;
  // The first request may have landed after our wait expired. The retry
  // recognises the existing immutable object and confirms its evidence row.
  state.upload.mockResolvedValueOnce({ error: { status: 409, message: "The resource already exists" } });
  await runner.flushDriverQueue();
  expect(state.upload).toHaveBeenCalledTimes(2);
  for (const call of state.upload.mock.calls) expect(call).toEqual([
    "same-photo-path", "signed-token", photo.blob, { contentType: "image/jpeg", upsert: false },
  ]);
  const bodies = fetchMock.mock.calls.map(call => JSON.parse((call[1] as RequestInit).body as string));
  expect(bodies.map(body => body.clientId)).toEqual(["photo", "photo", "photo"]);
  expect(state.deletes).toEqual(["photo"]);
  expect(state.rows).toEqual([]);
});

it("keeps normal successful uploads and confirmed record acknowledgements working", async () => {
  state.upload.mockResolvedValue({ error: null });
  state.rows = [{ id: "photo", seq: 1, payload: photo, attempts: 0, serverFailures: 0, nextAttemptAt: 1e15, lastError: null }];
  const runner = await import("../../app/driver/driverQueue");
  await runner.flushDriverQueue();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(state.deletes).toEqual(["photo"]);
  expect(vi.getTimerCount()).toBe(0);
});
