import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/planning/collection-email/route";
import { createApiSupabase } from "../api/server";
import { authorizeOfficeTenant } from "../jobs/officeAccess";
import { TenantAccessError } from "../auth/serverTenantAccess";
import { loadCollectionEmails, sendCollectionEmail } from "./collectionEmailServer";
import { exampleJob, appointment } from "./collectionEmailFixtures";
import { buildCollectionEmail } from "./collectionEmail";

vi.mock("../api/server", () => ({ createApiSupabase: vi.fn() }));
vi.mock("../supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ test: true })) }));
vi.mock("../jobs/officeAccess", async (original) => ({ ...await original<typeof import("../jobs/officeAccess")>(), authorizeOfficeTenant: vi.fn() }));
vi.mock("./collectionEmailServer", () => ({ loadCollectionEmails: vi.fn(), sendCollectionEmail: vi.fn() }));
const request = (extra: Record<string, unknown> = {}) => new NextRequest("https://tms.example.test/api/planning/collection-email", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", tenantId: exampleJob.tenant_id, jobIds: [exampleJob.id], options: appointment, ...extra }),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  vi.mocked(createApiSupabase).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "operator" } }, error: null }) } } as any);
  vi.mocked(authorizeOfficeTenant).mockResolvedValue({} as any);
  const message = buildCollectionEmail(exampleJob, appointment, "Carrier"); message.preview.fingerprint = "reviewed";
  vi.mocked(loadCollectionEmails).mockResolvedValue([{ ...message, key: "test-key" }]);
  vi.mocked(sendCollectionEmail).mockResolvedValue({ status: "accepted", message: "Sent to Microsoft 365." });
});
afterEach(() => vi.useRealTimers());
it("requires a signed-in user before reading private contacts", async () => {
  vi.mocked(createApiSupabase).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } } as any);
  expect((await POST(request())).status).toBe(401);
  expect(loadCollectionEmails).not.toHaveBeenCalled();
});
it("requires office authorization for the record tenant before reading contacts", async () => {
  vi.mocked(authorizeOfficeTenant).mockRejectedValue(new TenantAccessError(403, "forbidden"));
  expect((await POST(request())).status).toBe(403);
  expect(loadCollectionEmails).not.toHaveBeenCalled();
  expect(sendCollectionEmail).not.toHaveBeenCalled();
});
it("preview never sends and cannot supply an arbitrary recipient", async () => {
  const response = await POST(request({ to: "attacker@example.test" }));
  expect(response.status).toBe(200);
  expect((await response.json()).rows[0].email).toBe("collect@example.test");
  expect(sendCollectionEmail).not.toHaveBeenCalled();
});
it("requires a fresh preview and explicit confirmation for a receipt", async () => {
  const options = { ...appointment, kind: "collection_receipt" };
  expect((await POST(request({ action: "send", options, fingerprint: "reviewed" }))).status).toBe(409);
  expect((await POST(request({ action: "send", options, fingerprint: "stale", confirmCollected: true }))).status).toBe(409);
  expect(sendCollectionEmail).not.toHaveBeenCalled();
  expect((await POST(request({ action: "send", options, fingerprint: "reviewed", confirmCollected: true }))).status).toBe(200);
  expect(sendCollectionEmail).toHaveBeenCalledTimes(1);
});
it("rejects invalid selections and never sends an unbounded batch in one request", async () => {
  expect((await POST(request({ jobIds: [] }))).status).toBe(400);
  expect((await POST(request({ jobIds: ["invalid"] }))).status).toBe(400);
  expect((await POST(request({ action: "send", jobIds: [exampleJob.id, "10000000-0000-4000-8000-000000000002"] }))).status).toBe(400);
  expect(sendCollectionEmail).not.toHaveBeenCalled();
});
