import { createClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), session: vi.fn() }));
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
let mode: "unconfirmed" | "concurrent" | "existing" | "new" | "read-error";
let reads: number;
let inserts: number;
let jobDriver: string;
let jobTenant: string;
let jobSubcontractor: string;
let requests: URL[];

beforeEach(() => {
  mode = "unconfirmed";
  reads = 0;
  inserts = 0;
  jobDriver = "driver";
  jobTenant = "tenant";
  jobSubcontractor = "subcontractor";
  requests = [];
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
          ? { id: jobId, status: "planned", subcontractor_id: "subcontractor", created_at: "2026-10-01T00:00:00Z" } : null;
      } else if (table === "job_stops") {
        expect(params.get("job_id")).toBe(`eq.${jobId}`);
        expect(params.get("tenant_id")).toBe("eq.tenant");
        data = { id: stopId, type: "delivery", pod_status: "pending" };
      } else if (table === "job_items") {
        expect(params.get("job_id")).toBe(`eq.${jobId}`);
        expect(params.get("tenant_id")).toBe("eq.tenant");
        data = [{ id: itemId, serial_numbers: ["SN-123"] }];
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
          if (mode === "read-error" && reads > 1) { data = { code: "08006", message: "Synthetic read failure" }; status = 500; }
          else data = mode === "existing" || (mode === "concurrent" && reads > 1) ? savedScan : null;
        }
      } else throw new Error(`Unexpected table ${table}`);
      return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    } },
  });
  mocks.admin.mockReturnValue(client);
});

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
