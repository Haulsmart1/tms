import { createClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sdk: null as unknown, gateCalls: 0 }));
const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  job: "22222222-2222-4222-8222-222222222222",
  stop: "33333333-3333-4333-8333-333333333333",
  client: "44444444-4444-4444-8444-444444444444",
  user: "55555555-5555-4555-8555-555555555555",
  driver: "66666666-6666-4666-8666-666666666666",
  other: "77777777-7777-4777-8777-777777777777",
};
vi.mock("./server", () => ({
  requireDriverSession: async () => ({
    tenantId: "11111111-1111-4111-8111-111111111111",
    userId: "55555555-5555-4555-8555-555555555555",
    driverId: "66666666-6666-4666-8666-666666666666",
    subcontractorId: null,
  }),
  driverErrorResponse: (error: Error) => ({ status: 500, message: error.message }),
}));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => state.sdk }));
vi.mock("../walkaround/server", () => ({
  jobGateResponse: async () => { state.gateCalls++; return null; },
  queuedJobGate: async () => { state.gateCalls++; return {}; },
}));
import { POST } from "../../app/api/driver/jobs/[jobId]/stops/[stopId]/evidence/route";
import { eventOutcome } from "../offline/driverSync";
import { shouldHoldPodFailure } from "../offline/podFailureRetention";

beforeEach(() => { state.gateCalls = 0; });

function fixture(overrides: Record<string, unknown> = {}, jobOverrides: Record<string, unknown> = {}, readFails = false) {
  const path = `${ids.tenant}/${ids.job}/${ids.stop}/photos/q-${ids.client}-pod.jpg`;
  const row = {
    id: "evidence-one", tenant_id: ids.tenant, job_id: ids.job, stop_id: ids.stop,
    storage_path: path, evidence_type: "photo", mime_type: "image/jpeg",
    file_size_bytes: 120, original_filename: "pod.jpg", created_by: ids.user, ...overrides,
  };
  const job = {
    id: ids.job, tenant_id: ids.tenant, driver_id: ids.driver, status: "planned",
    subcontractor_id: null, created_at: "2026-10-01T00:00:00Z", ...jobOverrides,
  };
  const stop = {
    id: ids.stop, tenant_id: ids.tenant, job_id: ids.job, type: "delivery",
    pod_status: "delivered", pod_photo_url: null, delivered_at: "2026-10-18T00:00:00Z",
  };
  const requests: { url: URL; method: string }[] = [];
  state.sdk = createClient("https://synthetic.supabase.co", "synthetic-only-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? "GET";
      requests.push({ url, method });
      // Only read-only synthetic REST queries are permitted. Any storage access
      // or write makes the test fail, including a destructive remove/download.
      if (method !== "GET" || !url.pathname.startsWith("/rest/v1/")) throw new Error("Unexpected write or storage access");
      if (url.pathname.endsWith("/pod_evidence") && readFails) {
        return new Response(JSON.stringify({ message: "Evidence read unavailable" }), { status: 503 });
      }
      const rows = url.pathname.endsWith("/jobs") ? [job]
        : url.pathname.endsWith("/job_stops") ? [stop]
          : url.pathname.endsWith("/pod_evidence") ? [row] : [];
      const matching = rows.filter(r => [...url.searchParams].every(([key, value]) =>
        !value.startsWith("eq.") || (r as Record<string, unknown>)[key] === value.slice(3)));
      return new Response(JSON.stringify(matching), { headers: { "Content-Type": "application/json" } });
    } },
  });
  return { path, row, requests };
}

async function submit(path: string, body: Record<string, unknown> = {}) {
  return POST(new Request("https://tms.synthetic/evidence", {
    method: "POST", body: JSON.stringify({ clientId: ids.client, storagePath: path,
      mimeType: "image/jpeg", originalFilename: "pod.jpg", ...body }),
  }), { params: Promise.resolve({ jobId: ids.job, stopId: ids.stop }) });
}

it("acknowledges a matching delivered-stop retry without shift re-gating or touching its object", async () => {
  const f = fixture(); const response = await submit(f.path);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, evidence: { created_by: ids.user } });
  expect(state.gateCalls).toBe(0);
  expect(f.requests).toHaveLength(3);
  expect(f.requests.every(r => r.method === "GET" && r.url.pathname.startsWith("/rest/v1/"))).toBe(true);
  expect(Object.fromEntries(f.requests[2].url.searchParams)).toMatchObject({
    tenant_id: `eq.${ids.tenant}`, storage_path: `eq.${f.path}`,
  });
});

it.each(["job_id", "stop_id", "created_by", "evidence_type", "mime_type", "original_filename", "id"])(
  "holds a queued photo when the existing %s differs", async field => {
    const f = fixture({ [field]: field === "id" ? "" : ids.other });
    const response = await submit(f.path); const body = await response.json();
    expect(response.status).toBe(409); expect(body.ok).not.toBe(true); expect(body.evidence).toBeUndefined();
    const outcome = eventOutcome(response.status, body.error);
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind !== "stop") expect(shouldHoldPodFailure("pod_photo", outcome)).toBe(true);
    expect(state.gateCalls).toBe(0);
    expect(f.requests).toHaveLength(3);
    expect(f.requests.every(r => r.method === "GET" && r.url.pathname.startsWith("/rest/v1/"))).toBe(true);
  },
);

it("rejects a whitespace-only persisted evidence id", async () => {
  const f = fixture({ id: " " }); expect((await submit(f.path)).status).toBe(409);
});

it("uses the same 255-character filename storage rule when confirming a retry", async () => {
  const name = "x".repeat(280); const f = fixture({ original_filename: name.slice(0, 255) });
  expect((await submit(f.path, { originalFilename: name })).status).toBe(200);
});

it("matches the null filename stored for a missing or empty original name", async () => {
  for (const name of [null, ""]) {
    const f = fixture({ original_filename: null });
    expect((await submit(f.path, { originalFilename: name })).status).toBe(200);
  }
});

it.each(["tenant_id", "driver_id"])("keeps the current job %s authorization check before any retry lookup", async field => {
  const f = fixture({}, { [field]: ids.other }); const response = await submit(f.path);
  expect(response.status).toBe(404); expect(f.requests).toHaveLength(1);
});

it("does not confirm a different evidence tenant through the path lookup", async () => {
  const f = fixture({ tenant_id: ids.other }); const response = await submit(f.path);
  expect(response.status).toBe(409); expect((await response.json()).ok).not.toBe(true);
});

it("preserves the photo for retry when evidence confirmation cannot be read", async () => {
  const f = fixture({}, {}, true); const response = await submit(f.path);
  expect(response.status).toBe(500); expect((await response.json()).ok).not.toBe(true);
  expect(f.requests.every(r => r.method === "GET" && r.url.pathname.startsWith("/rest/v1/"))).toBe(true);
});
