import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriverQueuePayload } from "./driverSync";
import type { StoredItem } from "./idbStore";
import { parseDriverEvent } from "../shifts/events";

const state = vi.hoisted(() => ({ rows: [] as StoredItem<DriverQueuePayload>[], deletes: [] as string[], reflect: vi.fn(), upload: vi.fn() }));
vi.mock("./idbStore", () => ({
  idbLoadAll: async () => [...state.rows],
  idbPut: async (item: StoredItem<DriverQueuePayload>) => { state.rows = [...state.rows.filter(row => row.id !== item.id), item]; },
  idbDelete: async (id: string) => { state.deletes.push(id); state.rows = state.rows.filter(row => row.id !== id); },
  isMemoryOnly: () => false,
}));
vi.mock("./snapshotStore", () => ({ reflectAcceptedShift: state.reflect }));
vi.mock("../supabase/browser", () => ({ createClient: () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: "driver-a" } } }, error: null }), onAuthStateChange: vi.fn() },
  storage: { from: () => ({ uploadToSignedUrl: state.upload }) },
}) }));

const event: DriverQueuePayload = { kind: "event", ownerId: "driver-a", event: {
  type: "check_submitted", clientId: "11111111-1111-4111-8111-111111111111", occurredAt: "2026-10-18T10:00:00Z",
  phase: "start", shiftClientId: null, vehicleId: "22222222-2222-4222-8222-222222222222", confirmation: "registration",
  qrPayload: null, typedRegistration: "AB12CDE", mismatchReason: null, odometer: 1000, previousEndOdometer: null,
  declarationAccepted: true, checklistItemIds: ["33333333-3333-4333-8333-333333333333"],
  defects: [{ clientId: "44444444-4444-4444-8444-444444444444", catalogueItemId: null, driverSeverity: "minor", note: "Mirror cracked" }],
} };
const photo: DriverQueuePayload = { kind: "photo", ownerId: "driver-a", defectClientId: "defect-a", blob: new Blob(["original defect photo"]), mimeType: "image/jpeg", filename: "defect.jpg" };
let body: unknown;
let malformed = false;
let status = 200;
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); state.rows = []; state.deletes = []; state.reflect.mockReset(); state.reflect.mockResolvedValue(undefined); state.upload.mockReset(); state.upload.mockResolvedValue({ error: null });
  body = {}; malformed = false; status = 200;
  vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/upload-url")
    ? new Response(JSON.stringify({ path: "walkaround-path", token: "signed-token" }), { status: 200 })
    : new Response(status === 204 ? null : malformed ? "<html>Sign in</html>" : JSON.stringify(body), { status })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function flush(payload: DriverQueuePayload) {
  if (payload.kind === "event") expect(parseDriverEvent(payload.event).ok).toBe(true);
  state.rows = [{ id: "queued-a", seq: 1, payload, attempts: 0, serverFailures: 0, nextAttemptAt: 1e15, lastError: null }];
  const queue = await import("../../app/driver/driverQueue");
  await queue.flushDriverQueue(); return queue;
}

it.each([event, photo])("retains $kind after HTML 200 without projecting acceptance", async payload => {
  malformed = true;
  const queue = await flush(payload);
  expect(state.rows).toHaveLength(1); expect(state.rows[0].payload).toBe(payload);
  expect(state.deletes).toEqual([]); expect(state.reflect).not.toHaveBeenCalled();
  expect(queue.getQueueSnapshot().sent).toEqual([]);
});

it.each([event, photo])("retains $kind after repeated unconfirmed 200 replies", async payload => {
  body = { error: "Not saved" }; const queue = await flush(payload);
  for (let attempt = 0; attempt < 6; attempt += 1) await queue.flushDriverQueue();
  expect(state.rows).toHaveLength(1); expect(state.rows[0].payload).toBe(payload);
  expect(state.deletes).toEqual([]); expect(state.reflect).not.toHaveBeenCalled();
  expect(queue.getQueueSnapshot().rejected).toEqual([]);
});

it.each([event, photo])("accepts $kind only after explicit success", async payload => {
  body = { ok: true, duplicate: true }; const queue = await flush(payload);
  expect(state.rows).toEqual([]); expect(state.deletes).toEqual(["queued-a"]);
  expect(queue.getQueueSnapshot().pending).toEqual([]);
  expect(state.reflect).toHaveBeenCalledTimes(payload.kind === "event" ? 1 : 0);
});

it.each([{}, null, [], { ok: false }, { ok: "true" }].map(value => ({ value })))("retains the original defect photo for ambiguous JSON $value", async ({ value }) => {
  body = value; await flush(photo); expect(state.rows).toHaveLength(1); expect(state.rows[0].payload).toBe(photo); expect(state.deletes).toEqual([]);
});

it.each([event, photo])("retains $kind for an empty 204 response", async payload => {
  status = 204; await flush(payload); expect(state.rows).toHaveLength(1); expect(state.deletes).toEqual([]);
});

it("recovers a retained event on an explicit idempotent retry ACK", async () => {
  const queue = await flush(event); expect(state.rows).toHaveLength(1);
  body = { ok: true, duplicate: true }; await queue.flushDriverQueue();
  expect(state.rows).toEqual([]); expect(state.deletes).toEqual(["queued-a"]); expect(state.reflect).toHaveBeenCalledTimes(1);
});
