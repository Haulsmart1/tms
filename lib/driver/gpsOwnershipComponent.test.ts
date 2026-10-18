import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  owner: "owner-a" as string | null,
  effects: [] as (() => void | (() => void))[],
  authListeners: [] as ((event: string, session: unknown) => void)[],
  queueRef: null as null | { current: Record<string, unknown>[] },
  pendingSessionRead: null as null | Promise<unknown>,
}));
vi.mock("react", async () => ({
  ...(await vi.importActual("react")),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (current: unknown) => { const ref = { current }; if (Array.isArray(current)) state.queueRef = ref as typeof state.queueRef; return ref; },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { state.effects.push(effect); },
}));
vi.mock("../supabase/browser", () => ({ createClient: () => ({ auth: {
  getSession: async () => {
    if (state.pendingSessionRead) { const pending = state.pendingSessionRead; state.pendingSessionRead = null; return pending; }
    return { data: { session: state.owner ? { user: { id: state.owner } } : null }, error: null };
  },
  onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
    state.authListeners.push(callback);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  },
} }) }));
import DriverGpsTracker from "../../app/driver/DriverGpsTracker";

let online: () => void;
let position: PositionCallback;
let clearWatch: ReturnType<typeof vi.fn>;
let requests: { owner: string | null; body: Record<string, unknown> }[];
let offline: boolean;
let rejectOwner: boolean;
let pendingResponse: Promise<Response> | null;
let cleanups: (() => void)[];
let start: () => unknown;
beforeEach(async () => {
  state.owner = "owner-a";
  state.effects = [];
  state.authListeners = [];
  state.queueRef = null;
  state.pendingSessionRead = null;
  requests = [];
  cleanups = [];
  offline = true;
  rejectOwner = false;
  pendingResponse = null;
  clearWatch = vi.fn();
  const storage = new Map();
  vi.stubGlobal("window", {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    addEventListener: (event: string, callback: () => void) => { if (event === "online") online = callback; },
    removeEventListener: vi.fn(), setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(),
  });
  vi.stubGlobal("navigator", { onLine: false, geolocation: {
    watchPosition: (callback: PositionCallback) => { position = callback; return 1; }, clearWatch,
  } });
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    requests.push({ owner: state.owner, body: JSON.parse(String(init.body)) });
    if (pendingResponse) { const pending = pendingResponse; pendingResponse = null; return pending; }
    if (offline) throw new TypeError("Synthetic offline");
    if (rejectOwner) return new Response(JSON.stringify({ error: "Synthetic session owner changed at the server" }), { status: 409 });
    return new Response(JSON.stringify({ ok: true }));
  });
  const tree = DriverGpsTracker();
  start = tree.props.children[1].props.onClick;
  for (const effect of state.effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
  await start();
});
afterEach(() => { cleanups.forEach(fn => fn()); vi.unstubAllGlobals(); });
const fix = () => position({ coords: { latitude: 0, longitude: 0, accuracy: 1, speed: 0, heading: null }, timestamp: Date.now() } as GeolocationPosition);
function changeOwner(owner: string | null) {
  state.owner = owner;
  for (const callback of state.authListeners) callback(owner ? "SIGNED_IN" : "SIGNED_OUT", owner ? { user: { id: owner } } : null);
}

it("binds captured GPS fixes to owner A and never sends their retries under owner B", async () => {
  fix();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].body.ownerId).toBe("owner-a");
  changeOwner("owner-b");
  offline = false;
  online();
  await Promise.resolve();
  expect(requests).toHaveLength(1);
  expect(clearWatch).toHaveBeenCalled();
});

it("retains A's pending GPS fix across B's session and sends it only when A restarts", async () => {
  fix();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const recordedAt = requests[0].body.recordedAt;
  changeOwner("owner-b");
  offline = false;
  online();
  await Promise.resolve();
  expect(requests).toHaveLength(1);
  changeOwner("owner-a");
  await start();
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toMatchObject({ owner: "owner-a", body: { ownerId: "owner-a", recordedAt } });
});

it("does not relabel A's pending GPS fix when a session changes before the auth callback arrives", async () => {
  fix();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  state.owner = "owner-b";
  offline = false;
  online();
  await Promise.resolve();
  await Promise.resolve();
  expect(requests).toHaveLength(1);
});

it("rejects a delayed callback from A's old watch after B starts a new watch, retaining A's queued fix", async () => {
  const oldWatchCallback = position;
  fix();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  const firstAt = requests[0].body.recordedAt;
  changeOwner("owner-b");
  offline = false;
  await start();
  oldWatchCallback({ coords: { latitude: 1, longitude: 1, accuracy: 1, speed: 0, heading: null }, timestamp: Date.now() } as GeolocationPosition);
  await Promise.resolve();
  expect(requests).toHaveLength(1);
  fix();
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toMatchObject({ owner: "owner-b", body: { ownerId: "owner-b", latitude: 0, longitude: 0 } });
  changeOwner("owner-a");
  await start();
  await vi.waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2]).toMatchObject({ owner: "owner-a", body: { ownerId: "owner-a", recordedAt: firstAt } });
});

it("keeps legacy unbound positions quarantined without guessing their owner", async () => {
  const unbound = { latitude: 1, longitude: 1, accuracy: 1, recordedAt: new Date().toISOString() };
  state.queueRef!.current.push(unbound);
  offline = false;
  online();
  await Promise.resolve();
  expect(requests).toHaveLength(0);
  expect(state.queueRef!.current).toEqual([unbound]);
  fix();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].body.ownerId).toBe("owner-a");
  await vi.waitFor(() => expect(state.queueRef!.current).toEqual([unbound]));
});

it("pauses capture at capacity without evicting any queued GPS points", async () => {
  const held = Array.from({ length: 40 }, (_, i) => ({ ownerId: "owner-a", latitude: 0, longitude: 0, recordedAt: new Date(Date.now() - i * 1000).toISOString() }));
  state.queueRef!.current.push(...held);
  fix();
  expect(state.queueRef!.current).toEqual(held);
  expect(clearWatch).toHaveBeenCalled();
  expect(requests).toHaveLength(0);
  offline = false;
  await start();
  await vi.waitFor(() => expect(requests).toHaveLength(40));
  expect(requests.map(request => request.body.recordedAt)).toEqual(held.map(point => point.recordedAt));
  await vi.waitFor(() => expect(state.queueRef!.current).toEqual([]));
});

it("retains an owner-bound position when the server observes a different cookie owner", async () => {
  offline = false;
  rejectOwner = true;
  fix();
  await vi.waitFor(() => expect(clearWatch).toHaveBeenCalled());
  expect(state.queueRef!.current).toHaveLength(1);
  const original = { ...state.queueRef!.current[0] };
  expect(original.ownerId).toBe("owner-a");
  rejectOwner = false;
  await start();
  await vi.waitFor(() => expect(state.queueRef!.current).toEqual([]));
  expect(requests[1].body).toEqual(original);
});

it.each([200, 409])("does not stop B's new watch or remove B's point when A's old request settles with %s", async (status) => {
  offline = false;
  let answer!: (response: Response) => void;
  pendingResponse = new Promise(resolve => { answer = resolve; });
  fix();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  changeOwner("owner-b");
  await start();
  fix();
  expect(state.queueRef!.current).toHaveLength(2);
  answer(new Response(JSON.stringify(status === 200 ? { ok: true } : { error: "Synthetic ownership conflict" }), { status }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(clearWatch).toHaveBeenCalledTimes(1);
  online();
  await vi.waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]).toMatchObject({ owner: "owner-b", body: { ownerId: "owner-b" } });
  await vi.waitFor(() => expect(state.queueRef!.current.every(point => point.ownerId === "owner-a")).toBe(true));
  expect(state.queueRef!.current).toHaveLength(status === 200 ? 0 : 1);
});

it("does not stop B's new watch when A's pending session read resolves as B", async () => {
  offline = false;
  let answer!: (result: unknown) => void;
  state.pendingSessionRead = new Promise(resolve => { answer = resolve; });
  fix();
  expect(state.queueRef!.current).toHaveLength(1);
  changeOwner("owner-b");
  await start();
  fix();
  answer({ data: { session: { user: { id: "owner-b" } } }, error: null });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(clearWatch).toHaveBeenCalledTimes(1);
  online();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ owner: "owner-b", body: { ownerId: "owner-b" } });
  await vi.waitFor(() => expect(state.queueRef!.current).toHaveLength(1));
  expect(state.queueRef!.current[0].ownerId).toBe("owner-a");
});
