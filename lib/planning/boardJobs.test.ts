import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadPlanningBoardJobs, savedPlanBoardReady } from "./boardJobs";

const today = "2026-10-08";
function clientFor(rows: Array<Record<string, unknown>>, failIds = false) {
  const requests: URL[] = [];
  const client = createClient("https://board-test.invalid", "test-key", {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const ids = url.searchParams.get("id");
      if (ids && failIds) return new Response(JSON.stringify({ message: "snapshot lookup failed", code: "TEST" }), { status: 500 });
      const tenants = url.searchParams.get("tenant_id")!.slice(4, -1).split(",");
      const allowed = ids?.slice(4, -1).split(",");
      const data = rows.filter((row) => tenants.includes(String(row.tenant_id)) && (
        allowed ? allowed.includes(String(row.id)) : (row.planning_date ?? row.scheduled_date) === today
      ));
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    } },
  });
  return { client, requests };
}

describe("saved plan board loading", () => {
  it("loads all 25 HT21 EOR snapshot jobs despite older source dates without borrowing another tenant's job", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `job-${i + 1}`);
    const rows = ids.map((id) => ({ id, tenant_id: "bob-tenant", scheduled_date: "2026-10-04", planning_date: null }));
    const { client, requests } = clientFor([
      ...rows,
      { id: "today-pool", tenant_id: "bob-tenant", scheduled_date: today },
      { id: "foreign-job", tenant_id: "other-tenant", scheduled_date: "2026-10-04" },
    ]);
    const result = await loadPlanningBoardJobs(client, { tenantIds: ["bob-tenant"], planningDate: today, savedJobIds: [...ids, ids[0], "foreign-job"] });
    expect(result.error).toBeNull();
    expect(result.data!.map((row) => row.id)).toEqual(["today-pool", ...ids]);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.searchParams.get("tenant_id") === "in.(bob-tenant)")).toBe(true);
    expect(requests.every((request) => !request.searchParams.get("select")!.includes("*"))).toBe(true);
  });

  it("fails the load when a snapshot read fails instead of silently dropping its jobs", async () => {
    const { client } = clientFor([], true);
    const result = await loadPlanningBoardJobs(client, { tenantIds: ["bob-tenant"], planningDate: today, savedJobIds: ["job-1"] });
    expect(result.error?.message).toBe("snapshot lookup failed");
  });

  it("does not query without an authorized tenant scope", async () => {
    const { client, requests } = clientFor([]);
    expect(await loadPlanningBoardJobs(client, { tenantIds: [], planningDate: today, savedJobIds: ["foreign"] })).toEqual({ data: [], error: null });
    expect(requests).toEqual([]);
  });
});

it("waits for the new tenant/day load before staging the saved 25-job route", () => {
  const input = {
    loading: false, loadedScope: "previous-day", requestedScope: "saved-plan-day",
    tenantId: "bob-tenant", planningDate: today,
    savedPlan: { tenantId: "bob-tenant", planningDate: today },
  };
  expect(savedPlanBoardReady(input)).toBe(false);
  expect(savedPlanBoardReady({ ...input, loadedScope: null })).toBe(false);
  expect(savedPlanBoardReady({ ...input, loading: true, loadedScope: input.requestedScope })).toBe(false);
  expect(savedPlanBoardReady({ ...input, loadedScope: input.requestedScope })).toBe(true);
  expect(savedPlanBoardReady({ ...input, loadedScope: input.requestedScope, tenantId: "different-tenant" })).toBe(false);
});
