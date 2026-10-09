import { describe, expect, it, vi } from "vitest";
import { MAX_SNAPSHOT_AGE, readDriverSnapshot, unreflectedEvents, type Snapshot, type SnapshotStore } from "./driverCache";
import { projectDriverState } from "../shifts/projection";
import type { DriverShiftState } from "../walkaround/driverState";

function fixture() {
  const rows = new Map<string, Snapshot<unknown>>();
  const store: SnapshotStore = {
    get: async <T>(owner: string, url: string) => rows.get(`${owner}:${url}`) as Snapshot<T> | undefined,
    put: async (row) => { rows.set(`${row.owner}:${row.url}`, structuredClone(row)); },
    remove: async (owner, url) => { rows.delete(`${owner}:${url}`); },
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ jobs: [] }));
  const options = { owner: "bob", url: "/api/driver/me", store, fetcher, isCurrent: () => true, now: () => 100_000 };
  return { rows, store, fetcher, options };
}
describe("durable driver read snapshots", () => {
  it("does not double-project an accepted event after a crash before queue-row deletion", () => {
    const accepted = { clientId: "accepted", type: "break_started" };
    const next = { clientId: "next", type: "break_ended" };
    expect(unreflectedEvents([accepted, next], ["accepted"])).toEqual([next]);
  });
  it("reopens the exact saved 25-job route offline, then replaces it on reconnect", async () => {
    const { options, fetcher } = fixture();
    const refs = ["RTNMUK10186", "RTNMUK10160", "RTNMUK10321", "RTNMUK09904", ...Array.from({ length: 21 }, (_, i) => `other-${i}`)];
    const data = { jobs: refs.map((reference, route_order) => ({ id: reference, reference, route_order, planning_date: "2026-10-09" })) };
    fetcher.mockResolvedValueOnce(Response.json(data));
    expect((await readDriverSnapshot(options)).cached).toBe(false);
    fetcher.mockRejectedValueOnce(new TypeError("offline"));
    expect((await readDriverSnapshot(options)).data).toEqual(data);
    fetcher.mockResolvedValueOnce(Response.json({ jobs: [] }));
    expect((await readDriverSnapshot(options)).data).toEqual({ jobs: [] });
    fetcher.mockRejectedValueOnce(new TypeError("offline"));
    expect((await readDriverSnapshot(options)).data).toEqual({ jobs: [] });
  });
  it("saves and reopens job stops, scans and POD evidence without rebuilding assignments", async () => {
    const { options, fetcher } = fixture();
    options.url = "/api/driver/jobs/job-1";
    const job = { id: "job-1", stops: [{ id: "stop-1", status: "planned" }], scans: [], items: [], evidence: [] };
    fetcher.mockResolvedValueOnce(Response.json({ job }));
    await readDriverSnapshot(options);
    fetcher.mockRejectedValueOnce(new Error("offline"));
    expect((await readDriverSnapshot(options)).data).toEqual({ job });
  });
  it("restores a cached shift and still projects pending offline events", async () => {
    const { options, fetcher } = fixture();
    options.url = "/api/driver/shift";
    const shift: DriverShiftState = { today: "2026-10-09", timeZone: "Europe/London", companyName: null, onCallPhone: null,
      assignedVehicle: null, vehicles: [], catalogue: [], blockingCheck: null, syncPending: false,
      openShift: { id: "shift", clientId: "shift-client", startedAt: "2026-10-09T05:00:00Z", onBreak: false, breaks: [], currentVehicle: null } };
    fetcher.mockResolvedValueOnce(Response.json(shift));
    await readDriverSnapshot(options);
    fetcher.mockRejectedValueOnce(new Error("offline"));
    const saved = await readDriverSnapshot<DriverShiftState>(options);
    expect(projectDriverState(saved.data, [{ type: "break_started", clientId: "break", shiftClientId: "shift-client", occurredAt: "2026-10-09T06:00:00Z" }]).openShift?.onBreak).toBe(true);
    expect(saved.data.openShift?.onBreak).toBe(false);
  });
  it("never gives another driver the previous driver's cached data", async () => {
    const { options, fetcher } = fixture();
    await readDriverSnapshot(options);
    fetcher.mockRejectedValueOnce(new Error("offline"));
    await expect(readDriverSnapshot({ ...options, owner: "alice" })).rejects.toThrow("No saved data");
  });
  it.each([401, 403, 404, 409])("does not hide HTTP %s behind stale data and removes that snapshot", async (status) => {
    const { options, fetcher, rows } = fixture();
    await readDriverSnapshot(options);
    fetcher.mockResolvedValueOnce(new Response("denied", { status }));
    await expect(readDriverSnapshot(options)).rejects.toMatchObject({ status });
    expect(rows.size).toBe(0);
  });
  it("permits an offline snapshot on a temporary server failure", async () => {
    const { options, fetcher } = fixture();
    await readDriverSnapshot(options);
    fetcher.mockResolvedValueOnce(new Response("down", { status: 503 }));
    expect((await readDriverSnapshot(options)).cached).toBe(true);
  });
  it("rejects expired and future-dated snapshots", async () => {
    const { options, fetcher } = fixture();
    await readDriverSnapshot(options);
    fetcher.mockRejectedValue(new Error("offline"));
    await expect(readDriverSnapshot({ ...options, now: () => 100_001 + MAX_SNAPSHOT_AGE })).rejects.toThrow("No saved data");
    await expect(readDriverSnapshot({ ...options, now: () => 99_999 })).rejects.toThrow("No saved data");
  });
  it("fails safely on an offline first visit", async () => {
    const { options, fetcher } = fixture();
    fetcher.mockRejectedValue(new Error("offline"));
    await expect(readDriverSnapshot(options)).rejects.toThrow("Connect to load it first");
  });
  it("reports storage refusal without losing a successful online read", async () => {
    const { options, store } = fixture();
    store.put = async () => { throw new Error("quota"); };
    expect((await readDriverSnapshot(options)).durable).toBe(false);
  });
  it("discards an in-flight server read when the account changes", async () => {
    const { options, rows, fetcher } = fixture();
    let current = true;
    fetcher.mockImplementation(async () => { current = false; return Response.json({ jobs: ["secret"] }); });
    await expect(readDriverSnapshot({ ...options, isCurrent: () => current })).rejects.toMatchObject({ status: 401 });
    expect(rows.size).toBe(0);
  });
  it("discards a cached read when the account changes during IndexedDB access", async () => {
    const { options, store, fetcher } = fixture();
    await readDriverSnapshot(options);
    let current = true;
    const get = store.get;
    store.get = async (owner, url) => { current = false; return get(owner, url); };
    fetcher.mockRejectedValue(new Error("offline"));
    await expect(readDriverSnapshot({ ...options, isCurrent: () => current })).rejects.toMatchObject({ status: 401 });
  });
  it.each(["/api/driver/jobs/x/stops/y/complete", "/api/customers", "https://example.com/api/driver/me"])("refuses caching outside the read allowlist: %s", async (url) => {
    const { options, fetcher } = fixture();
    await expect(readDriverSnapshot({ ...options, url })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
