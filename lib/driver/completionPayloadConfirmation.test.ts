import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriverQueuePayload } from "../offline/driverSync";
import type { StoredItem } from "../offline/idbStore";

const state = vi.hoisted(() => ({ reads: 0, writes: 0, race: false, initialDelivered: true, readError: false,
  recipient: "Office recipient" as string | null | undefined, notes: "Office notes" as string | null | undefined,
  rows: [] as StoredItem<DriverQueuePayload>[], deletes: [] as string[] }));
vi.mock("./server", () => ({ requireDriverSession: async () => ({ tenantId: "tenant", driverId: "driver" }),
  driverErrorResponse: () => ({ status: 500, message: "Read failed" }) }));
vi.mock("./jobAccess", () => ({ loadDriverJobStop: async () => {
  state.reads++;
  if (state.readError && state.reads > 1) throw new Error("Readback failed");
  const delivered = state.initialDelivered || state.reads > 1;
  return { job: { status: state.initialDelivered ? "completed" : "planned" }, stop: { type: "delivery", pod_status: delivered ? "delivered" : "pending",
    delivered_at: delivered ? "2026-10-17T12:00:00Z" : null, recipient_name: delivered ? state.recipient : null, pod_notes: delivered ? state.notes : null } };
} }));
vi.mock("../walkaround/server", () => ({ jobGateResponse: async () => null,
  queuedJobGate: async () => ({ at: "2026-10-17T11:00:00Z", trusted: true }) }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let writing = false;
  const result = () => table === "pod_evidence" ? { count: 1, data: null, error: null }
    : table === "job_stops" ? { data: writing ? (state.race ? [] : [{ id: "stop" }]) : [{ id: "stop", pod_status: "delivered", delivered_at: "2026-10-17T12:00:00Z" }], error: null }
    : table === "jobs" ? { data: { id: "job" }, error: null } : { data: [], error: null };
  const query = { select: () => query, eq: () => query, in: () => query, or: () => query,
    update: () => { state.writes++; writing = true; return query; }, maybeSingle: async () => result(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
  return query;
} }) }));
vi.mock("../offline/idbStore", () => ({ idbLoadAll: async () => [...state.rows],
  idbPut: async (item: StoredItem<DriverQueuePayload>) => { state.rows = [...state.rows.filter(row => row.id !== item.id), item]; },
  idbDelete: async (id: string) => { state.deletes.push(id); state.rows = state.rows.filter(row => row.id !== id); }, isMemoryOnly: () => false }));
vi.mock("../supabase/browser", () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { user: { id: "driver" } } }, error: null }), onAuthStateChange: vi.fn() } }) }));
import { POST } from "../../app/api/driver/jobs/[jobId]/stops/[stopId]/complete/route";
import { eventOutcome } from "../offline/driverSync";
import { shouldHoldPodFailure } from "../offline/podFailureRetention";

const target = { jobId: "11111111-1111-4111-8111-111111111111", stopId: "22222222-2222-4222-8222-222222222222" };
const queued = { clientId: "33333333-3333-4333-8333-333333333333", recordedAt: "2026-10-17T11:00:00Z", shiftClientId: null,
  recipient_name: "Driver recipient", pod_notes: "Original driver notes" };
const post = (body: unknown = queued) => POST(new Request("https://example.test/complete", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve(target) });
beforeEach(() => { state.reads = 0; state.writes = 0; state.race = false; state.initialDelivered = true; state.readError = false;
  state.recipient = "Office recipient"; state.notes = "Office notes"; state.rows = []; state.deletes = []; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["initial", "zero-row-race"])("holds unsaved queued recipient/notes on %s completion", async mode => {
  state.initialDelivered = mode === "initial"; state.race = mode !== "initial";
  const response = await post();
  expect(response.status).toBe(409);
  const outcome = eventOutcome(response.status, (await response.json()).error);
  if (outcome.kind !== "stop") expect(shouldHoldPodFailure("pod_complete", outcome)).toBe(true);
  expect(state.writes).toBe(mode === "initial" ? 0 : 1);
});
it.each(["initial", "zero-row-race"])("acknowledges genuinely saved queued fields on %s replay", async mode => {
  state.initialDelivered = mode === "initial"; state.race = mode !== "initial";
  state.recipient = queued.recipient_name; state.notes = queued.pod_notes;
  expect(await (await post()).json()).toMatchObject({ ok: true, alreadyCompleted: true });
});
it.each(["", "   ", null])("uses first-save trimming and null notes normalization for %j", async notes => {
  state.recipient = "Recipient"; state.notes = null;
  expect(await (await post({ ...queued, recipient_name: "  Recipient  ", pod_notes: notes })).json()).toMatchObject({ ok: true });
});
it.each([[queued.recipient_name, "Different notes"], ["Different recipient", queued.pod_notes], [undefined, undefined], [null, null]])(
  "holds missing/different persisted recipient/notes (%j / %j)", async (recipient, notes) => {
    state.recipient = recipient; state.notes = notes;
    expect((await post()).status).toBe(409);
    expect(state.writes).toBe(0);
  });
it("keeps the actual runner's original queued payload when saved POD conflicts", async () => {
  vi.useFakeTimers(); vi.resetModules();
  vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => POST(new Request("https://example.test/complete", init), { params: Promise.resolve(target) }));
  const payload: DriverQueuePayload = { ...target, kind: "pod_complete", ownerId: "driver", clientId: queued.clientId,
    recordedAt: queued.recordedAt, shiftClientId: null, recipientName: queued.recipient_name, podNotes: queued.pod_notes };
  state.rows = [{ id: "queued-completion", seq: 1, payload, attempts: 0, serverFailures: 0, nextAttemptAt: 1e15, lastError: null }];
  const runner = await import("../../app/driver/driverQueue");
  await runner.flushDriverQueue();
  expect(state.deletes).toEqual([]);
  expect(state.rows[0].payload).toBe(payload);
  expect(runner.getQueueSnapshot().paused).toContain("not confirmed as saved");
  expect(state.writes).toBe(0);
});
it("keeps the bodyless non-queued delivered-stop no-op", async () => {
  const response = await POST(new Request("https://example.test/complete", { method: "POST" }), { params: Promise.resolve(target) });
  expect(await response.json()).toMatchObject({ ok: true, alreadyCompleted: true });
  expect(state.writes).toBe(0);
});
it("keeps the non-queued delivered-stop no-op with different direct caller fields", async () => {
  expect(await (await post({ recipient_name: "Different direct caller" })).json()).toMatchObject({ ok: true, alreadyCompleted: true });
  expect(state.writes).toBe(0);
});
it("acknowledges the first queued save normally", async () => {
  state.initialDelivered = false;
  expect(await (await post()).json()).toMatchObject({ ok: true, alreadyCompleted: false });
  expect(state.writes).toBe(2);
});
it("retains a queued completion on failed confirmation read", async () => {
  state.initialDelivered = false; state.race = true; state.readError = true;
  expect((await post()).status).toBe(500);
  expect(state.writes).toBe(1);
});
it("does not ACK malformed JSON even when another completion exists", async () => {
  const response = await POST(new Request("https://example.test/complete", { method: "POST", body: '{"clientId":' }), { params: Promise.resolve(target) });
  expect(response.status).toBe(400);
  expect(state.writes).toBe(0);
});
