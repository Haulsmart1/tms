import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotStore } from "./driverCache";
import { dashboardAssignedJobs } from "../driver/dashboardJobs";

let store: SnapshotStore;
const dashboardUrl = "/api/driver/me";
const detailUrl = (id: string) => `/api/driver/jobs/${encodeURIComponent(id)}`;
const dashboard = (owner: string, savedAt: number, jobs: string[], todayJobs?: string[]) => ({
  owner, url: dashboardUrl, savedAt,
  data: { jobs: jobs.map((id) => ({ id })), ...(todayJobs ? { todayJobs: todayJobs.map((id) => ({ id })) } : {}) },
});
const detail = (owner: string, savedAt: number, id: string) => ({ owner, savedAt, url: detailUrl(id), data: { job: { id } } });

beforeEach(async () => {
  // Execute the actual snapshotStore transaction/cursor code against an isolated
  // IndexedDB implementation. No live phone databases or mutation queues exist.
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  store = (await import("./snapshotStore")).snapshotStore;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("driver detail snapshots follow both authorized dashboard lists", () => {
  it("retains a carried-over detail when a newer dashboard refresh excludes it from recent history", async () => {
    await store.put(dashboard("owner-a", 100, ["recent"], ["carried"]));
    await store.put(detail("owner-a", 101, "carried"));
    expect(await store.get("owner-a", detailUrl("carried"))).toBeDefined();
    await store.put(dashboard("owner-a", 102, ["recent"], ["carried"]));
    expect(await store.get("owner-a", detailUrl("carried"))).toMatchObject({ data: { job: { id: "carried" } } });
  });

  it("allows a today's detail at the dashboard timestamp but rejects unrelated details", async () => {
    await store.put(dashboard("owner-a", 200, ["recent"], ["carried / encoded"]));
    await store.put(detail("owner-a", 200, "carried / encoded"));
    await store.put(detail("owner-a", 200, "not-assigned"));
    expect(await store.get("owner-a", detailUrl("carried / encoded"))).toBeDefined();
    expect(await store.get("owner-a", detailUrl("not-assigned"))).toBeUndefined();
  });

  it("prunes removed assignments for the same owner while preserving another owner's snapshots", async () => {
    await store.put(dashboard("owner-a", 300, ["recent"], ["carried", "removed"]));
    await store.put(detail("owner-a", 301, "carried"));
    await store.put(detail("owner-a", 301, "removed"));
    await store.put(dashboard("owner-b", 300, [], ["removed"]));
    await store.put(detail("owner-b", 301, "removed"));
    await store.put(dashboard("owner-a", 302, [], ["carried"]));
    expect(await store.get("owner-a", detailUrl("removed"))).toBeUndefined();
    expect(await store.get("owner-a", detailUrl("carried"))).toBeDefined();
    expect(await store.get("owner-b", detailUrl("removed"))).toBeDefined();
    expect(await store.get("owner-b", detailUrl("carried"))).toBeUndefined();
  });

  it("cannot restore a removed detail from an older in-flight response", async () => {
    await store.put(dashboard("owner-a", 400, [], []));
    await store.put(detail("owner-a", 399, "removed"));
    expect(await store.get("owner-a", detailUrl("removed"))).toBeUndefined();
  });

  it("keeps the historical dashboard format compatible and ignores older dashboard replacements", async () => {
    await store.put(dashboard("owner-a", 500, ["legacy"]));
    await store.put(detail("owner-a", 501, "legacy"));
    await store.put(dashboard("owner-a", 502, ["legacy"]));
    await store.put(dashboard("owner-a", 499, []));
    expect(await store.get("owner-a", detailUrl("legacy"))).toBeDefined();
    expect(await store.get("owner-a", dashboardUrl)).toMatchObject({ savedAt: 502 });
  });

  it("prepares the first 80 unique assignments through the real phone preparer and store", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requests.push(url);
      return new Response(JSON.stringify({ job: { id: decodeURIComponent(url.split("/").at(-1)!) } }));
    });
    const identity = await import("../../app/driver/driverIdentity");
    identity.observeDriverAuth("SIGNED_IN", "owner-a");
    const data = dashboard("owner-a", Date.now(), Array.from({ length: 100 }, (_, i) => `recent-${i}`), ["carried", "recent-0"]);
    await store.put(data);
    await identity.prepareAssignedJobs("owner-a", dashboardAssignedJobs(data.data));
    expect(requests).toHaveLength(80);
    expect(new Set(requests).size).toBe(80);
    expect(requests[0]).toBe(detailUrl("carried"));
    expect(await store.get("owner-a", detailUrl("carried"))).toBeDefined();
    // Refresh the dashboard, then use the actual offline loader to reopen it.
    await store.put({ ...data, savedAt: Date.now() + 1 });
    vi.stubGlobal("fetch", async () => { throw new TypeError("Synthetic offline"); });
    expect(await identity.loadDriverData("owner-a", detailUrl("carried"))).toMatchObject({ cached: true, data: { job: { id: "carried" } } });
    identity.observeDriverAuth("SIGNED_IN", "owner-b");
    await expect(identity.loadDriverData("owner-a", detailUrl("carried"))).rejects.toMatchObject({ status: 401 });
    await expect(identity.loadDriverData("owner-b", detailUrl("carried"))).rejects.toThrow("No saved data");
  });
});
