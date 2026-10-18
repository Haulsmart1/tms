import { createClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sdk: null as unknown, deny: false }));
const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  job: "22222222-2222-4222-8222-222222222222",
  stop: "33333333-3333-4333-8333-333333333333",
  user: "44444444-4444-4444-8444-444444444444",
};
vi.mock("./officeEvidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./officeEvidence")>();
  return {
    ...actual,
    // Authentication/office authorization is the boundary stub. Stop lookup,
    // content verification and evidence persistence use their real code + SDK.
    requireOfficeCaller: async () => {
      if (state.deny) throw new actual.OfficeEvidenceError(403, "Not authorized.");
      return { admin: state.sdk, tenantId: ids.tenant, userId: ids.user };
    },
  };
});
import { POST } from "../../app/api/pod/evidence/route";
import { MAX_POD_EVIDENCE_BYTES } from "./evidenceRules";
import { verifyUploadedEvidence } from "./evidenceServer";
import { eventOutcome } from "../offline/driverSync";
import { shouldHoldPodFailure } from "../offline/podFailureRetention";

beforeEach(() => { state.deny = false; });

function fixture(options: { bytes?: Uint8Array; jobTenant?: string; stopJob?: string; downloadFails?: boolean; newUpload?: boolean } = {}) {
  const path = `${ids.tenant}/${ids.job}/${ids.stop}/photos/1-existing-pod.jpg`;
  const bytes = options.bytes ?? new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const saved = { id: "evidence-one", tenant_id: ids.tenant, job_id: ids.job, stop_id: ids.stop,
    evidence_type: "photo", storage_path: path, mime_type: "image/jpeg", file_size_bytes: bytes.length,
    original_filename: "pod.jpg", created_by: ids.user };
  let exists = true;
  const requests: { url: URL; method: string }[] = [];
  const sdk = createClient("https://synthetic.supabase.co", "synthetic-only-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)); const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (url.pathname.startsWith("/storage/v1/object/") && method === "GET") {
        if (options.downloadFails) return new Response(JSON.stringify({ message: "Unavailable" }), { status: 503 });
        return new Response(bytes as BodyInit, { headers: { "Content-Type": "application/octet-stream" } });
      }
      if (url.pathname === "/storage/v1/object/pod-files" && method === "DELETE") {
        exists = false;
        return new Response(JSON.stringify([{ name: path }]));
      }
      if (url.pathname === "/rest/v1/pod_evidence" && method === "POST" && options.newUpload) {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ id: "new-evidence", ...body }), { status: 201 });
      }
      if (url.pathname.startsWith("/rest/v1/") && method === "GET") {
        const rows = url.pathname.endsWith("/jobs")
          ? [{ id: ids.job, tenant_id: options.jobTenant ?? ids.tenant, status: "planned" }]
          : url.pathname.endsWith("/job_stops")
            ? [{ id: ids.stop, tenant_id: ids.tenant, job_id: options.stopJob ?? ids.job, type: "delivery", pod_status: "awaiting" }]
            : url.pathname.endsWith("/pod_evidence") ? options.newUpload ? [] : [saved] : [];
        return new Response(JSON.stringify(rows.filter(row => [...url.searchParams].every(([key, value]) =>
          !value.startsWith("eq.") || (row as Record<string, unknown>)[key] === value.slice(3)))),
        { headers: { "Content-Type": "application/json" } });
      }
      throw new Error(`Unexpected ${method} ${url.pathname}`);
    } },
  });
  state.sdk = sdk;
  return { sdk, path, requests, objectExists: () => exists, saved };
}

async function submit(path: string, mimeType = "image/png") {
  return POST(new Request("https://tms.synthetic/api/pod/evidence", { method: "POST",
    body: JSON.stringify({ tenantId: ids.tenant, jobId: ids.job, stopId: ids.stop,
      evidenceType: "photo", mimeType, storagePath: path, originalFilename: "pod.jpg" }),
  }));
}

it("rejects a changed MIME claim without deleting an already recorded JPEG", async () => {
  const f = fixture(); const response = await submit(f.path);
  expect(response.status).toBe(415); expect((await response.json()).ok).not.toBe(true);
  expect(f.objectExists()).toBe(true);
  expect(f.requests.some(r => r.method === "DELETE")).toBe(false);
});

it.each([0, MAX_POD_EVIDENCE_BYTES + 1])("retains rejected size %s without acknowledging or deleting evidence", async size => {
  const f = fixture({ bytes: new Uint8Array(size) }); const response = await submit(f.path, "image/jpeg");
  expect(response.status).toBe(413); expect((await response.json()).ok).not.toBe(true);
  expect(f.objectExists()).toBe(true);
  expect(f.requests.some(r => r.method === "DELETE")).toBe(false);
});

it("does not treat a temporary download failure as permission to clean up", async () => {
  const f = fixture({ downloadFails: true }); expect((await submit(f.path)).status).toBe(404);
  expect(f.objectExists()).toBe(true); expect(f.requests.some(r => r.method !== "GET")).toBe(false);
});

it("still verifies valid JPEG bytes and returns the matching evidence row", async () => {
  const f = fixture(); const response = await submit(f.path, "image/jpeg");
  expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ ok: true, evidence: f.saved });
  expect(f.objectExists()).toBe(true); expect(f.requests.every(r => r.method === "GET")).toBe(true);
});

it("still records valid fresh JPEG uploads with verified size and no cleanup", async () => {
  const f = fixture({ newUpload: true }); const response = await submit(f.path, "image/jpeg");
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ ok: true, evidence: { id: "new-evidence", file_size_bytes: 8,
    tenant_id: ids.tenant, job_id: ids.job, stop_id: ids.stop, created_by: ids.user } });
  expect(f.objectExists()).toBe(true);
  expect(f.requests.filter(r => r.method === "POST")).toHaveLength(1);
  expect(f.requests.some(r => r.method === "DELETE")).toBe(false);
});

it.each([413, 415])("existing driver offline handling retains photos rejected with %s", status => {
  const outcome = eventOutcome(status, "Upload rejected");
  expect(outcome.kind).toBe("rejected");
  if (outcome.kind !== "stop") expect(shouldHoldPodFailure("pod_photo", outcome)).toBe(true);
});

it("checks caller authorization before reading any job or stored bytes", async () => {
  const f = fixture(); state.deny = true;
  expect((await submit(f.path)).status).toBe(403); expect(f.requests).toHaveLength(0);
});

it.each(["jobTenant", "stopJob"])("checks %s scope before accessing stored bytes", async field => {
  const f = fixture({ [field]: "other" }); expect((await submit(f.path)).status).toBe(404);
  expect(f.requests.every(r => r.url.pathname.startsWith("/rest/v1/") && r.method === "GET")).toBe(true);
});

it("rejects a different tenant path before storage access", async () => {
  const f = fixture(); expect((await submit(f.path.replace(ids.tenant, ids.user))).status).toBe(400);
  expect(f.requests.every(r => r.url.pathname.startsWith("/rest/v1/") && r.method === "GET")).toBe(true);
});

it("shared verification rejects untrusted bytes without relying on a race-prone record lookup", async () => {
  const f = fixture({ bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) });
  expect(await verifyUploadedEvidence(f.sdk, f.path, "image/jpeg")).toMatchObject({ ok: false, status: 415 });
  expect(f.objectExists()).toBe(true); expect(f.requests).toHaveLength(1);
});
