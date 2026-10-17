import { afterEach, beforeEach, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ memoryOnly: true, rows: [] as unknown[] }));
vi.mock("./idbStore", () => ({
  idbLoadAll: async () => storage.rows,
  idbPut: vi.fn(), idbDelete: vi.fn(),
  isMemoryOnly: () => storage.memoryOnly,
}));
const auth = vi.hoisted(() => ({
  owner: "driver-a" as string | null,
  changed: undefined as undefined | ((event: string, session: unknown) => void),
}));
vi.mock("../supabase/browser", () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: auth.owner ? { user: { id: auth.owner } } : null }, error: null }),
  onAuthStateChange: (handler: typeof auth.changed) => { auth.changed = handler; },
} }) }));

const handlers = new Map<string, (event: unknown) => void>();
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  handlers.clear();
  auth.owner = "driver-a";
  auth.changed = undefined;
  storage.memoryOnly = true;
  storage.rows = [{ id: "photo-a", seq: 1, payload: { kind: "pod_photo", ownerId: "driver-a", blob: new Blob(["synthetic evidence"]) }, nextAttemptAt: 1e15 }];
  vi.stubGlobal("window", { addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function start() {
  const queue = await import("../../app/driver/driverQueue");
  queue.subscribe(() => {});
  await vi.waitFor(() => expect(queue.getQueueSnapshot().pending).toHaveLength(1));
  return queue;
}
function leave() {
  const event = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };
  handlers.get("beforeunload")!(event);
  return event;
}

it.each([null, "driver-b"])("warns about volatile evidence after account changes to %s without exposing its contents", async (nextOwner) => {
  const queue = await start();
  auth.owner = nextOwner;
  auth.changed!(nextOwner ? "SIGNED_IN" : "SIGNED_OUT", nextOwner ? { user: { id: nextOwner } } : null);
  await vi.advanceTimersByTimeAsync(0);
  expect(queue.getQueueSnapshot()).toMatchObject({ pending: [], heldForOthers: 1, memoryOnly: true });
  const event = leave();
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.returnValue).toBe("");
});

it("retains the existing warning for the signed-in driver's durable queue", async () => {
  storage.memoryOnly = false;
  await start();
  expect(leave().preventDefault).toHaveBeenCalledOnce();
});

it("does not warn when another driver's evidence is durable", async () => {
  storage.memoryOnly = false;
  const queue = await start();
  auth.owner = null;
  auth.changed!("SIGNED_OUT", null);
  await vi.advanceTimersByTimeAsync(0);
  expect(queue.getQueueSnapshot().heldForOthers).toBe(1);
  expect(leave().preventDefault).not.toHaveBeenCalled();
});

it("does not warn for an empty queue even if storage is unavailable", async () => {
  storage.rows = [];
  const queue = await import("../../app/driver/driverQueue");
  queue.subscribe(() => {});
  await vi.waitFor(() => expect(handlers.has("beforeunload")).toBe(true));
  expect(leave().preventDefault).not.toHaveBeenCalled();
});
