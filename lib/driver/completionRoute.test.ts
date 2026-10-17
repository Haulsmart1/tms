import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ updated: false, status: "cancelled", reads: 0, writes: 0 }));
vi.mock("./server", () => ({
  requireDriverSession: async () => ({ tenantId: "tenant", driverId: "driver" }),
  driverErrorResponse: () => ({ status: 500, message: "Read failed" }),
}));
vi.mock("./jobAccess", () => ({ loadDriverJobStop: async () => ({
  job: { status: "planned" },
  stop: { type: "delivery", pod_status: "delivered", delivered_at: "2026-10-17T12:00:00Z" },
}) }));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    let writing = false;
    const result = () => table === "job_stops"
      ? { data: [{ id: "stop", pod_status: "delivered", delivered_at: "2026-10-17T12:00:00Z" }], error: null }
      : { data: writing ? (state.updated ? { id: "job" } : null) : { status: state.status, pod_status: "delivered" }, error: null };
    const query = {
      select: () => { if (table === "jobs" && !writing) state.reads++; return query; },
      update: () => { writing = true; state.writes++; return query; },
      eq: () => query, in: () => query,
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}) }));
import { POST } from "../../app/api/driver/jobs/[jobId]/stops/[stopId]/complete/route";
beforeEach(() => { state.updated = false; state.status = "cancelled"; state.reads = 0; state.writes = 0; });
async function complete() {
  return POST(new Request("https://example.test/complete", { method: "POST" }), { params: Promise.resolve({
    jobId: "11111111-1111-4111-8111-111111111111", stopId: "22222222-2222-4222-8222-222222222222",
  }) });
}
it("acknowledges saved stop evidence without claiming a cancelled job was completed", async () => {
  const response = await complete();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, alreadyCompleted: true, jobCompleted: false });
  expect(state.writes).toBe(1);
  expect(state.reads).toBe(1);
});
it("recognises a concurrent job completion after a zero-row update", async () => {
  state.status = "completed";
  expect(await (await complete()).json()).toMatchObject({ jobCompleted: true });
  expect(state.reads).toBe(1);
});
it("confirms a successful constrained update without an extra read", async () => {
  state.updated = true;
  expect(await (await complete()).json()).toMatchObject({ jobCompleted: true });
  expect(state.reads).toBe(0);
});
