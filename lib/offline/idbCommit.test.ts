import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const item = { id: "pod-photo", seq: 1, payload: { blob: new Blob(["evidence"]) }, attempts: 0, serverFailures: 0, nextAttemptAt: 0, lastError: null };

async function fixture() {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  let request: { result: unknown; onsuccess?: () => void };
  const tx: { objectStore?: () => unknown; oncomplete?: () => void; onabort?: () => void; error: Error | null } = { error: null };
  tx.objectStore = () => ({ put: () => (request = { result: item.id }), index: () => ({ getAll: () => (request = { result: [] }) }) });
  vi.stubGlobal("window", {});
  vi.stubGlobal("indexedDB", { open: () => {
    const openRequest: { result: unknown; onsuccess?: () => void } = { result: { transaction: () => tx } };
    queueMicrotask(() => openRequest.onsuccess?.());
    return openRequest;
  } });
  const store = await import("./idbStore");
  return { store, tx, ready: () => Boolean(request), success: () => request.onsuccess?.() };
}

it("does not claim a queued photograph is durable before its transaction commits", async () => {
  const { store, tx, success, ready } = await fixture();
  let resolved = false;
  const pending = store.idbPut(item).then(() => { resolved = true; });
  await vi.waitFor(() => expect(ready()).toBe(true));
  success();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(resolved).toBe(false);
  tx.oncomplete?.();
  await pending;
  expect(store.isMemoryOnly()).toBe(false);
});

it("marks an aborted successful request as memory-only and retains the photograph on reload", async () => {
  const { store, tx, success, ready } = await fixture();
  const pending = store.idbPut(item);
  await vi.waitFor(() => expect(ready()).toBe(true));
  success();
  tx.error = new Error("commit aborted");
  tx.onabort?.();
  await pending;
  expect(store.isMemoryOnly()).toBe(true);
  expect(await store.idbLoadAll()).toEqual([item]);
});
