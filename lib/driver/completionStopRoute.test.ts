import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  loadCalls: 0,
  confirmed: "pending" as "pending" | "delivered" | "missing" | "error",
  updated: false,
  jobWrites: 0,
}));
vi.mock("./server", () => ({
  requireDriverSession: async () => ({ tenantId: "tenant", driverId: "driver" }),
  driverErrorResponse: () => ({ status: 500, message: "Read failed" }),
}));
vi.mock("./jobAccess", () => ({ loadDriverJobStop: async () => {
  state.loadCalls++;
  const reread = state.loadCalls > 1;
  if (reread && state.confirmed === "missing") return null;
  if (reread && state.confirmed === "error") throw new Error("Read failed");
  return {
    job: { status: "planned" },
    stop: {
      type: "delivery",
      pod_status: reread && state.confirmed === "delivered" ? "delivered" : "pending",
      delivered_at: reread && state.confirmed === "delivered" ? "2026-10-17T12:00:00Z" : null,
    },
  };
} }));
vi.mock("../walkaround/server", () => ({
  jobGateResponse: async () => null,
  queuedJobGate: async () => ({ at: "2026-10-17T11:00:00Z", trusted: true }),
}));
vi.mock("../supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    let writing = false;
    const result = () => {
      if (table === "pod_evidence") return { count: 1, data: null, error: null };
      if (table === "job_stops") return {
        data: writing ? (state.updated ? [{ id: "stop" }] : [])
          : [{ id: "stop", pod_status: "delivered", delivered_at: "2026-10-17T12:00:00Z" }],
        error: null,
      };
      if (table === "jobs") return { data: { id: "job" }, error: null };
      return { data: [], error: null };
    };
    const query = {
      select: () => query,
      update: () => { writing = true; if (table === "jobs") state.jobWrites++; return query; },
      eq: () => query, in: () => query, or: () => query,
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  },
}) }));

import { POST } from "../../app/api/driver/jobs/[jobId]/stops/[stopId]/complete/route";
import { eventOutcome } from "../offline/driverSync";
import { shouldHoldPodFailure } from "../offline/podFailureRetention";
beforeEach(() => {
  state.loadCalls = 0;
  state.confirmed = "pending";
  state.updated = false;
  state.jobWrites = 0;
});
async function complete(queued = false) {
  return POST(new Request("https://example.test/complete", {
    method: "POST", body: JSON.stringify({ recipient_name: "Recipient", ...(queued ? {
      clientId: "33333333-3333-4333-8333-333333333333",
      shiftClientId: "44444444-4444-4444-8444-444444444444", recordedAt: "2026-10-17T11:00:00Z",
    } : {}) }),
  }), { params: Promise.resolve({
    jobId: "11111111-1111-4111-8111-111111111111", stopId: "22222222-2222-4222-8222-222222222222",
  }) });
}
it.each(["pending", "missing"] as const)("does not acknowledge completion when the stop read-back is %s", async (confirmed) => {
  state.confirmed = confirmed;
  const response = await complete(true);
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body).not.toHaveProperty("ok", true);
  const outcome = eventOutcome(response.status, body.error);
  expect(outcome.kind).toBe("rejected");
  if (outcome.kind !== "stop") expect(shouldHoldPodFailure("pod_complete", outcome)).toBe(true);
  expect(state.jobWrites).toBe(0);
});
it("fails retryably if stop confirmation cannot be read", async () => {
  state.confirmed = "error";
  expect((await complete(true)).status).toBe(500);
  expect(state.jobWrites).toBe(0);
});
it("acknowledges a concurrent stop completion using its persisted time", async () => {
  state.confirmed = "delivered";
  expect(await (await complete()).json()).toMatchObject({
    ok: true, alreadyCompleted: true, completedAt: "2026-10-17T12:00:00Z",
  });
  expect(state.loadCalls).toBe(2);
});
it("does not add a confirmation read when the update returned the saved stop", async () => {
  state.updated = true;
  expect(await (await complete()).json()).toMatchObject({ ok: true, alreadyCompleted: false });
  expect(state.loadCalls).toBe(1);
});
