import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), session: vi.fn() }));
vi.mock("../supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("./server", () => ({ requireDriverSession: mocks.session, driverErrorResponse: (error: { status?: number }) => ({ status: error.status ?? 500, message: "Driver request failed." }) }));
vi.mock("../rateLimit", () => ({ checkRateLimit: async () => ({ allowed: true }), RATE_LIMITS: { driverLocation: {} } }));
import { POST } from "../../app/api/driver/location/route";

let requests: URL[];
let positions: Record<string, unknown>[];
beforeEach(() => {
  requests = [];
  positions = [];
  mocks.session.mockResolvedValue({ userId: "owner-b", tenantId: "tenant-b", driverId: "driver-b" });
  mocks.admin.mockReturnValue(createClient("https://gps-ownership.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith("/vehicle_assignments")) {
        expect(url.searchParams.get("tenant_id")).toBe("eq.tenant-b");
        expect(url.searchParams.get("driver_id")).toBe("eq.driver-b");
        return new Response(JSON.stringify([{ id: "assignment-b", vehicle_id: "vehicle-b" }]));
      }
      if (url.pathname.endsWith("/telematics_positions")) {
        positions.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 201 });
      }
      throw new Error(`Unexpected synthetic endpoint ${url.pathname}`);
    } },
  }));
});
const point = { latitude: 0, longitude: 0, accuracy: 1, recordedAt: new Date().toISOString() };
const post = (ownerId?: unknown) => POST(new NextRequest("https://tms.invalid/api/driver/location", {
  method: "POST", body: JSON.stringify({ ...point, ...(ownerId === undefined ? {} : { ownerId }) }),
}));

it("does not attribute owner A's queued GPS point to signed-in owner B's vehicle", async () => {
  const response = await post("owner-a");
  expect(response.status).toBe(409);
  expect(positions).toEqual([]);
  expect(requests).toEqual([]);
});
it("holds unbound legacy GPS points instead of assigning the current user's vehicle", async () => {
  expect((await post()).status).toBe(409);
  expect(positions).toEqual([]);
});
it("allows a position bound to the verified current user and derives tenant/vehicle server-side", async () => {
  expect((await post("owner-b")).status).toBe(200);
  expect(positions).toMatchObject([{ tenant_id: "tenant-b", vehicle_id: "vehicle-b", latitude: 0, longitude: 0 }]);
});
it.each([null, 123, {}, ["owner-b"]])("does not infer the owner from malformed identity %j", async ownerId => {
  expect((await post(ownerId)).status).toBe(409);
  expect(requests).toEqual([]);
  expect(positions).toEqual([]);
});
it.each([401, 403])("never queries assignments or writes GPS after verified driver access denies %s", async status => {
  mocks.session.mockRejectedValue({ status });
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await post("owner-b")).status).toBe(status);
  expect(requests).toEqual([]);
  expect(positions).toEqual([]);
  vi.restoreAllMocks();
});
