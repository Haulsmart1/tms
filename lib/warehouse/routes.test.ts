import { createClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ sdk: null as unknown, deny: 0, rpcError: false, vehicleTenant: "", legacyChecks: 0 }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenantId = id(1), actor = id(2);
vi.mock("../pod/officeEvidence", async (original) => {
  const actual = await original<typeof import("../pod/officeEvidence")>();
  return { ...actual, requireOfficeCaller: async (tenant: unknown) => {
    if (state.deny) throw new actual.OfficeEvidenceError(state.deny, "Access denied.");
    if (tenant !== tenantId) throw new actual.OfficeEvidenceError(403, "Access denied.");
    return { admin: state.sdk, tenantId, userId: actor, authorized: { tier: "staff", tenant: { id: tenantId, companyId: id(3) } } };
  } };
});
vi.mock("../auth/serverTenantAccess", async original => {
  const actual = await original<typeof import("../auth/serverTenantAccess")>();
  return { ...actual, authorizeVehicleTenant: async () => { state.legacyChecks++; throw new actual.TenantAccessError(403, "forbidden"); } };
});
import { GET } from "../../app/api/warehouse/route";
import { POST } from "../../app/api/warehouse/actions/route";
let requests: { url: URL; body: Record<string, unknown> | null; method: string }[];
beforeEach(() => {
  state.deny = 0; state.rpcError = false; state.vehicleTenant = tenantId; state.legacyChecks = 0; requests = [];
  state.sdk = createClient("https://fixture.invalid", "synthetic-key", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)), body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url, body, method: init?.method ?? "GET" });
    if (url.pathname.endsWith("/warehouse_apply_operation")) return state.rpcError
      ? Response.json({ code: "PT404", message: "One or more jobs are not in this workspace." }, { status: 400 })
      : Response.json({ count: 1, references: ["TEST"], action: body.p_action });
    if (url.pathname.endsWith("/warehouse_search_jobs")) return Response.json({ jobs: [], total: 0, stats: {}, page: 0 });
    if (url.pathname.endsWith("/vehicles") && url.searchParams.has("id")) return Response.json([{ tenant_id: state.vehicleTenant }]);
    return Response.json([]);
  } } });
});
function submit(patch = {}) { return POST(new Request("https://tms.invalid/api/warehouse/actions", { method: "POST",
  body: JSON.stringify({ tenantId, requestId: id(4), action: "deliver", jobIds: [id(5)], ...patch }) })); }
it.each([401, 403])("blocks unauthorized caller %s before database access", async status => {
  state.deny = status;
  expect((await GET(new Request(`https://tms.invalid/api/warehouse?tenantId=${tenantId}`))).status).toBe(status);
  expect((await submit()).status).toBe(status); expect(requests).toHaveLength(0);
});
it("passes only the authenticated actor to one atomic RPC, without direct table writes", async () => {
  expect((await submit({ actorId: id(99), p_tenant: id(99) })).status).toBe(200);
  expect(requests).toHaveLength(1);
  expect(requests[0].body).toMatchObject({ p_tenant: tenantId, p_actor: actor, p_action: "deliver", p_jobs: [id(5)] });
});
it("scopes search, history, drivers, plans and vehicles to the authorized workspace", async () => {
  expect((await GET(new Request(`https://tms.invalid/api/warehouse?tenantId=${tenantId}&q=FD%20C10930&scan=1`))).status).toBe(200);
  expect(requests[0].body).toMatchObject({ p_tenant: tenantId, p_exact: true });
  for (const request of requests.slice(1)) expect(request.url.searchParams.get("tenant_id")).toContain(tenantId);
  expect(requests.find(r => r.url.pathname.endsWith("/vehicles"))?.url.searchParams.get("tenant_id")).not.toContain(id(3));
});
it("allows an office staff move within their own tenant", async () => {
  expect((await submit({ action: "move", vehicleId: id(7), planningDate: "2026-11-10" })).status).toBe(200);
  expect(state.legacyChecks).toBe(0);
});
it("refuses a forged cross-tenant vehicle before the mutation RPC", async () => {
  state.vehicleTenant = id(98);
  expect((await submit({ action: "move", vehicleId: id(7), planningDate: "2026-11-10" })).status).toBe(403);
  expect(requests.some(r => r.url.pathname.endsWith("/warehouse_apply_operation"))).toBe(false);
});
it("reports a rejected transaction without claiming success", async () => {
  state.rpcError = true; const response = await submit(); expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "One or more jobs are not in this workspace." });
});
it("rejects malformed jobs before making a mutation", async () => {
  expect((await submit({ jobIds: ["bad"] })).status).toBe(400); expect(requests).toHaveLength(0);
});
