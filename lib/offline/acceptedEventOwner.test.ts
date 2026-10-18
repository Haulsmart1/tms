import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriverQueuePayload } from "./driverSync";
import type { StoredItem } from "./idbStore";

const state = vi.hoisted(() => ({ rows: [] as StoredItem<DriverQueuePayload>[], owner: "driver-a" as string | null,
  auth: null as null | ((event: string, session: { user: { id: string } } | null) => void), reflect: vi.fn() }));
vi.mock("./idbStore", () => ({
  idbLoadAll: async () => [...state.rows],
  idbPut: async (item: StoredItem<DriverQueuePayload>) => { state.rows = [...state.rows.filter(row => row.id !== item.id), item]; },
  idbDelete: async (id: string) => { state.rows = state.rows.filter(row => row.id !== id); },
  isMemoryOnly: () => false,
}));
vi.mock("./snapshotStore", () => ({ reflectAcceptedShift: state.reflect }));
vi.mock("../supabase/browser", () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: state.owner ? { user: { id: state.owner } } : null }, error: null }),
  onAuthStateChange: (callback: typeof state.auth) => { state.auth = callback; },
} }) }));

const event: Extract<DriverQueuePayload, { kind: "event" }> = { kind: "event", ownerId: "driver-a", event: {
  type: "check_submitted", clientId: "11111111-1111-4111-8111-111111111111", occurredAt: "2026-10-18T10:00:00Z",
  phase: "start", shiftClientId: null, vehicleId: "22222222-2222-4222-8222-222222222222", confirmation: "qr",
  qrPayload: "private cab QR", typedRegistration: null, mismatchReason: null, odometer: 1000, previousEndOdometer: null,
  declarationAccepted: true, checklistItemIds: ["33333333-3333-4333-8333-333333333333"],
  defects: [{ clientId: "44444444-4444-4444-8444-444444444444", catalogueItemId: null, driverSeverity: "minor", note: "Private driver's defect" }],
} };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); state.rows = [{ id: event.event.clientId, seq: 1, payload: event, attempts: 0, serverFailures: 0, nextAttemptAt: 1e15, lastError: null }];
  state.owner = "driver-a"; state.auth = null; state.reflect.mockReset(); state.reflect.mockResolvedValue(undefined);
  vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([null, "driver-b"])("does not expose a late accepted A event after identity changes to %s", async nextOwner => {
  let finish!: (response: Response) => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  vi.stubGlobal("fetch", vi.fn(() => { began(); return new Promise<Response>(resolve => { finish = resolve; }); }));
  const queue = await import("../../app/driver/driverQueue");
  const snapshots: ReturnType<typeof queue.getQueueSnapshot>[] = [];
  queue.subscribe(snapshot => snapshots.push(snapshot));
  const flush = queue.flushDriverQueue(); await started;
  state.owner = nextOwner; state.auth!(nextOwner ? "SIGNED_IN" : "SIGNED_OUT", nextOwner ? { user: { id: nextOwner } } : null);
  await vi.advanceTimersByTimeAsync(0);
  snapshots.length = 0;
  finish(new Response(JSON.stringify({ ok: true }), { status: 200 })); await flush;
  expect(snapshots.every(snapshot => snapshot.sent.length === 0)).toBe(true);
  expect(queue.getQueueSnapshot().sent).toEqual([]);
  expect(state.rows).toEqual([]); // The confirmed A record may still be acknowledged.
  expect(state.reflect).toHaveBeenCalledWith("driver-a", expect.objectContaining({ qrPayload: null }), expect.any(Number));
});

it("still projects a confirmed same-owner event with its QR removed", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  const queue = await import("../../app/driver/driverQueue");
  await queue.flushDriverQueue();
  expect(queue.getQueueSnapshot().sent).toEqual([{ event: { ...event.event, qrPayload: null }, sentAt: expect.any(Number) }]);
  expect(state.rows).toEqual([]);
});

it("does not expose the event when identity changes during cached reflection", async () => {
  let reflected!: () => void; let finish!: () => void;
  const started = new Promise<void>(resolve => { reflected = resolve; });
  state.reflect.mockImplementation(() => { reflected(); return new Promise<void>(resolve => { finish = resolve; }); });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
  const queue = await import("../../app/driver/driverQueue");
  const snapshots: ReturnType<typeof queue.getQueueSnapshot>[] = [];
  queue.subscribe(snapshot => snapshots.push(snapshot));
  const flush = queue.flushDriverQueue(); await started;
  state.owner = "driver-b"; state.auth!("SIGNED_IN", { user: { id: state.owner } });
  await vi.advanceTimersByTimeAsync(0); snapshots.length = 0; finish(); await flush;
  expect(snapshots.every(snapshot => snapshot.sent.length === 0)).toBe(true);
  expect(state.rows).toEqual([]);
});

it("retains the exact original event when an old-owner reply is unconfirmed", async () => {
  let finish!: (response: Response) => void; let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  vi.stubGlobal("fetch", vi.fn(() => { began(); return new Promise<Response>(resolve => { finish = resolve; }); }));
  const queue = await import("../../app/driver/driverQueue");
  const flush = queue.flushDriverQueue(); await started;
  state.owner = "driver-b"; state.auth!("SIGNED_IN", { user: { id: state.owner } });
  await vi.advanceTimersByTimeAsync(0);
  finish(new Response(JSON.stringify({ message: "not confirmed" }), { status: 200 })); await flush;
  expect(queue.getQueueSnapshot().sent).toEqual([]);
  expect(queue.getQueueSnapshot().pending).toEqual([]);
  expect(queue.getQueueSnapshot().heldForOthers).toBe(1);
  expect(state.rows[0].payload).toBe(event);
  expect(state.reflect).not.toHaveBeenCalled();
});
