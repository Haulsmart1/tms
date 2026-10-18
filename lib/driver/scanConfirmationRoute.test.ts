import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DriverQueuePayload } from "../offline/driverSync";
import type { StoredItem } from "../offline/idbStore";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), session: vi.fn() }));
const queueStore = vi.hoisted(() => ({ rows: [] as StoredItem<DriverQueuePayload>[], deletes: [] as string[] }));
vi.mock("../offline/idbStore", () => ({
  idbLoadAll: async () => [...queueStore.rows],
  idbPut: async (item: StoredItem<DriverQueuePayload>) => { queueStore.rows = [...queueStore.rows.filter(row => row.id !== item.id), item]; },
  idbDelete: async (id: string) => { queueStore.deletes.push(id); queueStore.rows = queueStore.rows.filter(row => row.id !== id); },
  isMemoryOnly: () => false,
}));
vi.mock("../supabase/browser", () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: { user: { id: "user" } } }, error: null }),
  onAuthStateChange: vi.fn(),
} }) }));
vi.mock("../supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("./server", () => ({
  requireDriverSession: mocks.session,
  driverErrorResponse: () => ({ status: 500, message: "Unable to process driver request." }),
}));

import { POST } from "../../app/api/driver/jobs/[jobId]/stops/[stopId]/scans/route";
import { eventOutcome } from "../offline/driverSync";
import { shouldHoldPodFailure } from "../offline/podFailureRetention";

const jobId = "11111111-1111-4111-8111-111111111111";
const stopId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const savedScan = { id: "scan-id", stop_id: stopId, job_item_id: itemId, serial_number: "SN-123", scan_format: "manual", scanned_by: "user", scanned_at: "2026-10-18T00:00:00Z" };
let mode: "unconfirmed" | "concurrent" | "existing" | "new" | "read-error" | "initial-read-error";
let reads: number;
let inserts: number;
let jobDriver: string;
let jobTenant: string;
let jobSubcontractor: string;
let requests: URL[];
let jobStatus: string;
let podStatus: string;
let stopType: string;
let expectedSerials: string[];
let priorScan: typeof savedScan;

beforeEach(() => {
  mode = "unconfirmed";
  reads = 0;
  inserts = 0;
  jobDriver = "driver";
  jobTenant = "tenant";
  jobSubcontractor = "subcontractor";
  requests = [];
  jobStatus = "planned";
  podStatus = "pending";
  stopType = "delivery";
  expectedSerials = ["SN-123"];
  priorScan = savedScan;
  queueStore.rows = [];
  queueStore.deletes = [];
  mocks.session.mockResolvedValue({ tenantId: "tenant", driverId: "driver", subcontractorId: "subcontractor", userId: "user" });
  const client = createClient("https://scan-confirmation.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      const table = url.pathname.split("/").at(-1);
      const params = url.searchParams;
      let data: unknown;
      let status = 200;
      if (table === "jobs") {
        expect(params.get("id")).toBe(`eq.${jobId}`);
        expect(params.get("tenant_id")).toBe("eq.tenant");
        expect(params.get("driver_id")).toBe("eq.driver");
        expect(params.get("subcontractor_id")).toBe("eq.subcontractor");
        data = jobDriver === "driver" && jobTenant === "tenant" && jobSubcontractor === "subcontractor"
          ? { id: jobId, status: jobStatus, subcontractor_id: "subcontractor", created_at: "2026-10-01T00:00:00Z" } : null;
      } else if (table === "job_stops") {
        expect(params.get("job_id")).toBe(`eq.${jobId}`);
        expect(params.get("tenant_id")).toBe("eq.tenant");
        data = { id: stopId, type: stopType, pod_status: podStatus };
      } else if (table === "job_items") {
        expect(params.get("job_id")).toBe(`eq.${jobId}`);
        expect(params.get("tenant_id")).toBe("eq.tenant");
        data = [{ id: itemId, serial_numbers: expectedSerials }];
      } else if (table === "job_item_scans") {
        if (init?.method === "POST") {
          inserts++;
          if (mode === "new") { data = savedScan; status = 201; }
          else { data = { code: "23505", message: "Synthetic unique constraint violation" }; status = 409; }
        } else {
          reads++;
          expect(params.get("tenant_id")).toBe("eq.tenant");
          expect(params.get("job_id")).toBe(`eq.${jobId}`);
          expect(params.get("job_item_id")).toBe(`eq.${itemId}`);
          expect(params.get("serial_number")).toBe("eq.SN-123");
          if (mode === "initial-read-error" || (mode === "read-error" && reads > 1)) { data = { code: "08006", message: "Synthetic read failure" }; status = 500; }
          else data = mode === "existing" || (mode === "concurrent" && reads > 1) ? priorScan : null;
        }
      } else throw new Error(`Unexpected table ${table}`);
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    } },
  });
  mocks.admin.mockReturnValue(client);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function scan() {
  return POST(new Request("https://example.test/scans", {
    method: "POST", body: JSON.stringify({ serial_number: "SN-123", scan_format: "manual" }),
  }), { params: Promise.resolve({ jobId, stopId }) });
}

it("does not acknowledge an offline scan when a unique conflict has no confirmed scoped scan", async () => {
  const response = await scan();
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body).not.toHaveProperty("ok", true);
  const outcome = eventOutcome(response.status, body.error);
  expect(outcome.kind).toBe("rejected");
  if (outcome.kind !== "stop") expect(shouldHoldPodFailure("pod_scan", outcome)).toBe(true);
  expect(reads).toBe(2);
  expect(inserts).toBe(1);
});

it("still acknowledges a confirmed concurrent duplicate", async () => {
  mode = "concurrent";
  const response = await scan();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, duplicate: true, scan: savedScan });
  expect(inserts).toBe(1);
});

it("does not insert an already confirmed scan", async () => {
  mode = "existing";
  expect(await (await scan()).json()).toMatchObject({ ok: true, duplicate: true, scan: savedScan });
  expect(inserts).toBe(0);
});

it("still acknowledges a newly persisted scan", async () => {
  mode = "new";
  const response = await scan();
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ ok: true, duplicate: false, scan: savedScan });
});

it("keeps confirmation read errors retryable", async () => {
  mode = "read-error";
  const response = await scan();
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(eventOutcome(response.status, body.error).kind).toBe("retry");
});

it.each(["tenant", "driver", "subcontractor"])("does not reveal a scan when job %s ownership differs", async (boundary) => {
  jobStatus = "completed";
  podStatus = "delivered";
  if (boundary === "tenant") jobTenant = "other";
  if (boundary === "driver") jobDriver = "other";
  if (boundary === "subcontractor") jobSubcontractor = "other";
  mode = "existing";
  const response = await scan();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Job stop not found." });
  expect(requests.some((url) => url.pathname.endsWith("/job_item_scans"))).toBe(false);
  expect(inserts).toBe(0);
});

it.each(["completed", "cancelled"])("acknowledges an existing job-wide scan after the job becomes %s without inserting", async status => {
  mode = "existing";
  jobStatus = status;
  podStatus = "delivered";
  const response = await scan();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, duplicate: true, scan: savedScan });
  expect(reads).toBe(1);
  expect(inserts).toBe(0);
});

it("recovers a committed scan whose acknowledgement was lost before the stop completed", async () => {
  mode = "new";
  // The client never receives this first successful response.
  expect((await scan()).status).toBe(201);
  mode = "existing";
  podStatus = "delivered";
  const replay = await scan();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ ok: true, duplicate: true, scan: savedScan });
  expect(inserts).toBe(1);
});

it.each(["completed", "cancelled"])("does not create or acknowledge an unrecorded scan on a %s job", async status => {
  jobStatus = status;
  const response = await scan();
  expect(response.status).toBe(409);
  expect(await response.json()).not.toHaveProperty("ok", true);
  expect(inserts).toBe(0);
});

it("holds an unrecorded scan when its delivery stop is already complete", async () => {
  podStatus = "delivered";
  const response = await scan();
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body).not.toHaveProperty("ok", true);
  const outcome = eventOutcome(response.status, body.error);
  if (outcome.kind === "stop") throw new Error("Expected retained rejection");
  expect(shouldHoldPodFailure("pod_scan", outcome)).toBe(true);
  expect(inserts).toBe(0);
});

it("still requires a delivery stop before looking up any prior verification", async () => {
  mode = "existing";
  stopType = "collection";
  expect((await scan()).status).toBe(409);
  expect(reads).toBe(0);
  expect(inserts).toBe(0);
});

it("does not acknowledge an unexpected serial even for a completed job", async () => {
  mode = "existing";
  jobStatus = "completed";
  expectedSerials = ["OTHER"];
  const response = await scan();
  expect(response.status).toBe(422);
  expect(await response.json()).not.toHaveProperty("ok", true);
  expect(reads).toBe(0);
  expect(inserts).toBe(0);
});

it("keeps a failed prior-scan read retryable even on a completed delivery", async () => {
  mode = "initial-read-error";
  jobStatus = "completed";
  podStatus = "delivered";
  const response = await scan();
  expect(response.status).toBe(500);
  expect(await response.json()).not.toHaveProperty("ok", true);
  expect(inserts).toBe(0);
});

it("preserves the job-wide once-per-serial model across delivery stops and scanners", async () => {
  mode = "existing";
  jobStatus = "completed";
  podStatus = "delivered";
  priorScan = { ...savedScan, stop_id: "44444444-4444-4444-8444-444444444444", scanned_by: "another-driver" };
  const response = await scan();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, duplicate: true, scan: priorScan });
  expect(inserts).toBe(0);
});

it("does not query a prior scan before authenticating the driver", async () => {
  mocks.session.mockRejectedValueOnce(new Error("Synthetic unauthenticated session"));
  expect((await scan()).status).not.toBe(200);
  expect(requests).toEqual([]);
});

it.each(["existing", "unconfirmed", "initial-read-error"] as const)("actual queue and route remove only a confirmed replay after completion (%s)", async replayMode => {
  vi.useFakeTimers();
  vi.resetModules();
  mode = replayMode;
  jobStatus = "completed";
  podStatus = "delivered";
  const payload: DriverQueuePayload = { kind: "pod_scan", ownerId: "user", clientId: "queued-scan", jobId, stopId,
    jobItemId: itemId, serialNumber: "SN-123", scanFormat: "manual" };
  queueStore.rows = [{ id: "queued-scan", seq: 1, payload, attempts: 0, serverFailures: 0, nextAttemptAt: 1e15, lastError: null }];
  vi.stubGlobal("window", { addEventListener: vi.fn(), localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() } });
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => POST(
    new Request(`https://example.test${url}`, init), { params: Promise.resolve({ jobId, stopId }) },
  )));
  const queue = await import("../../app/driver/driverQueue");
  await queue.flushDriverQueue();
  if (replayMode === "existing") {
    expect(queueStore.deletes).toEqual(["queued-scan"]);
    expect(queueStore.rows).toEqual([]);
    expect(queue.getQueueSnapshot().pending).toEqual([]);
  } else {
    expect(queueStore.deletes).toEqual([]);
    expect(queueStore.rows[0].payload).toBe(payload);
    expect(queue.getQueueSnapshot().pending).toHaveLength(1);
  }
  expect(inserts).toBe(0);
});
