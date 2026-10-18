import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriverQueuePayload } from "./driverSync";
import type { StoredItem } from "./idbStore";

const state = vi.hoisted(() => ({ rows: [] as StoredItem<DriverQueuePayload>[], deletes: [] as string[], upload: vi.fn(), owner: "driver" }));
vi.mock("./idbStore", () => ({ idbLoadAll: async () => [...state.rows].sort((a, b) => a.seq - b.seq),
  idbPut: async (item: StoredItem<DriverQueuePayload>) => { state.rows = [...state.rows.filter(row => row.id !== item.id), item].sort((a, b) => a.seq - b.seq); },
  idbDelete: async (id: string) => { state.deletes.push(id); state.rows = state.rows.filter(row => row.id !== id); }, isMemoryOnly: () => false }));
vi.mock("../supabase/browser", () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { user: { id: state.owner } } }, error: null }), onAuthStateChange: vi.fn() },
  storage: { from: () => ({ uploadToSignedUrl: state.upload }) } }) }));
const photo: DriverQueuePayload = { kind: "photo", ownerId: "driver", defectClientId: "defect", blob: new Blob(["original defect photograph"]), mimeType: "image/jpeg", filename: "defect.jpg" };
const pod: DriverQueuePayload = { kind: "pod_scan", ownerId: "driver", clientId: "scan", jobId: "job", stopId: "stop", jobItemId: "item", serialNumber: "serial", scanFormat: null };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); state.rows = []; state.deletes = []; state.upload.mockReset(); state.owner = "driver";
  vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  let uploadStarts = 0;
  fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/upload-url") ? { path: `defect-path-${++uploadStarts}`, token: "signed-token" } : { ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function begin() {
  state.rows = [photo, pod].map((payload, i) => ({ id: i ? "scan" : "photo", seq: i + 1, payload, attempts: 0, serverFailures: 0, nextAttemptAt: 1e15, lastError: null }));
  const runner = await import("../../app/driver/driverQueue");
  let settled = false;
  const pending = runner.flushDriverQueue().then(() => { settled = true; });
  await vi.waitFor(() => expect(state.upload).toHaveBeenCalledTimes(1));
  return { runner, pending, settled: () => settled };
}
it("releases the shared flush lock after a stalled defect upload while retaining the photo and later POD in order", async () => {
  let locked = false;
  vi.stubGlobal("navigator", { locks: { request: async (_name: string, work: () => Promise<void>) => { locked = true; try { await work(); } finally { locked = false; } } } });
  state.upload.mockImplementation(() => new Promise(() => {}));
  const { runner, pending, settled } = await begin();
  expect(locked).toBe(true);
  await vi.advanceTimersByTimeAsync(20_001);
  expect(settled()).toBe(true);
  await pending;
  expect(locked).toBe(false);
  expect(state.deletes).toEqual([]);
  expect(state.rows.map(row => row.payload)).toEqual([photo, pod]);
  expect(state.rows[0].attempts).toBe(1);
  expect(runner.getQueueSnapshot().pending).toHaveLength(2);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each(["success", "rejection"])("ignores late defect upload %s without recording or deleting its evidence", async outcome => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  state.upload.mockImplementation(() => new Promise((res, rej) => { resolve = res; reject = rej; }));
  const { pending } = await begin();
  await vi.advanceTimersByTimeAsync(20_001);
  await pending;
  if (outcome === "success") resolve({ error: null }); else reject(new Error("late SDK failure"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state.deletes).toEqual([]);
  expect(state.rows.map(row => row.payload)).toEqual([photo, pod]);
});
it("retries the original defect bytes and records success before later work can proceed", async () => {
  state.upload.mockImplementationOnce(() => new Promise(() => {}));
  const { runner, pending } = await begin();
  await vi.advanceTimersByTimeAsync(20_001); await pending;
  state.upload.mockResolvedValue({ error: null });
  await runner.flushDriverQueue();
  expect(state.upload).toHaveBeenCalledTimes(2);
  state.upload.mock.calls.forEach((call, i) => expect(call).toEqual([`defect-path-${i + 1}`, "signed-token", photo.blob, { contentType: "image/jpeg", upsert: false }]));
  expect(state.deletes).toEqual(["photo"]);
  expect(state.rows[0].payload).toBe(pod);
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/driver/walkaround/photos/upload-url", "/api/driver/walkaround/photos/upload-url", "/api/driver/walkaround/photos"]);
});
it("still rechecks ownership before recording a successful defect upload", async () => {
  state.upload.mockImplementation(async () => { state.owner = "other"; return { error: null }; });
  const { pending } = await begin(); await pending;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(state.deletes).toEqual([]);
  expect(state.rows.map(row => row.payload)).toEqual([photo, pod]);
});
