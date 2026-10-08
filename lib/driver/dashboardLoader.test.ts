import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/driver/me/route";
import { isDriverJobForDate } from "./dashboardJobs";
import { loadPlanningBoardJobs } from "../planning/boardJobs";
import { createSavedPlanSnapshot } from "../planning/savedPlan";
import { loadSavedPlan } from "../planning/savedPlanStore";
import { computeSaveDiff } from "../planning/saveDiff";
import { buildPlanningSavePlan, savePlanningAssignments } from "../planning/planningSave";
import type { PlanJob } from "../planning/types";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), session: vi.fn(), zone: vi.fn() }));
vi.mock("../supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("./server", () => ({
  requireDriverSession: mocks.session,
  driverErrorResponse: () => ({ status: 500, message: "Unable to process driver request." }),
}));
vi.mock("./operatorTimeZone", () => ({ loadOperatorTimeZone: mocks.zone }));

const today = "2026-10-08";
const job = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, tenant_id: "tenant-bob", driver_id: "bob", subcontractor_id: null,
  planning_date: null, scheduled_date: today, job_date: "2026-08-26",
  route_order: 2, reference: id, ...overrides,
});
const fixtures = [
  job("bob-planned", { planning_date: today, scheduled_date: "2026-10-04", route_order: 1 }),
  job("kent-moved-away", { planning_date: "2026-10-09" }),
  job("kent-old", { planning_date: "2026-10-06", scheduled_date: "2026-10-04" }),
  job("scheduled-fallback"),
  job("job-date-fallback", { scheduled_date: null, job_date: today }),
  job("job-date-superseded", { scheduled_date: null, job_date: today, planning_date: "2026-10-09" }),
  job("no-date", { scheduled_date: null, job_date: null }),
  job("other-driver", { driver_id: "alice", planning_date: today }),
  job("other-tenant", { tenant_id: "other", planning_date: today }),
  job("subcontracted", { subcontractor_id: "sub-a" }),
];

// Evaluate only the PostgREST filter grammar used here. The real Supabase
// client constructs the request, and the transport is entirely local: no
// environment files, database credentials or network calls are involved.
function terms(expression: string): string[] {
  let depth = 0;
  let start = 0;
  const result: string[] = [];
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === "(") depth++;
    if (expression[i] === ")") depth--;
    if (expression[i] === "," && depth === 0) {
      result.push(expression.slice(start, i));
      start = i + 1;
    }
  }
  result.push(expression.slice(start));
  return result;
}
function matches(row: Record<string, unknown>, expression: string): boolean {
  if (expression.startsWith("and(")) return terms(expression.slice(4, -1)).every((t) => matches(row, t));
  const [column, operator, value] = expression.split(".");
  if (operator === "is" && value === "null") return row[column] === null;
  if (operator === "eq") return row[column] === value;
  if (operator === "in") return value.slice(1, -1).split(",").includes(String(row[column]));
  throw new Error(`Unexpected filter: ${expression}`);
}

let requests: URL[];
let dashboardRows: Array<Record<string, unknown>>;
let storedSnapshot: unknown;
beforeEach(() => {
  vi.useFakeTimers();
  // Already Oct 8 in Europe/Paris, still Oct 7 in UTC and London.
  vi.setSystemTime(new Date("2026-10-07T22:30:00Z"));
  mocks.zone.mockResolvedValue("Europe/Paris");
  mocks.session.mockResolvedValue({ tenantId: "tenant-bob", driverId: "bob", portalType: "driver", subcontractorId: null });
  requests = [];
  dashboardRows = fixtures.map((row) => ({ ...row }));
  storedSnapshot = null;
  const admin = createClient("https://dashboard-test.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      const table = url.pathname.split("/").at(-1);
      let data: unknown;
      if (table === "jobs") {
        const params = url.searchParams;
        const rows = dashboardRows.filter((row) => {
          if (!["tenant_id", "driver_id", "subcontractor_id", "id"].every((col) =>
            !params.has(col) || matches(row, `${col}.${params.get(col)}`))) return false;
          const or = params.get("or");
          return !or || terms(or.slice(1, -1)).some((term) => matches(row, term));
        });
        const order = params.get("order");
        if (order?.startsWith("route_order")) rows.sort((a, b) =>
          Number(a.route_order ?? Number.MAX_SAFE_INTEGER) - Number(b.route_order ?? Number.MAX_SAFE_INTEGER) || String(a.reference).localeCompare(String(b.reference)));
        const columns = params.get("select")!.split(",");
        data = rows.map((row) => Object.fromEntries(columns.map((col) => [col, (row as Record<string, unknown>)[col] ?? null])));
      } else if (table === "planning_saved_plans") {
        expect(url.searchParams.get("tenant_id")).toBe("eq.tenant-bob");
        data = { id: "saved-ht21", tenant_id: "tenant-bob", name: "HT21 EOR 25 jobs", planning_date: today, snapshot: storedSnapshot, created_at: "2026-10-08T06:00:00Z", updated_at: "2026-10-08T06:00:00Z" };
      } else if (table === "save_planning_assignments") {
        const args = JSON.parse(String(init?.body));
        expect(args.p_tenant_id).toBe("tenant-bob");
        expect(args.p_planning_date).toBe(today);
        for (const update of args.p_updates) {
          const row = dashboardRows.find((row) => row.id === update.id)!;
          expect(update.expected_scheduled_date).toBe(row.scheduled_date);
          expect(update.expected_planning_date).toBe(row.planning_date);
          Object.assign(row, { vehicle_id: update.vehicle_id, driver_id: update.driver_id, route_order: update.route_order, planning_date: update.planning_date });
        }
        data = args.p_updates.length;
      } else if (table === "drivers") data = { id: "bob", name: "Bob" };
      else if (table === "vehicle_assignments") data = [];
      else throw new Error(`Unexpected table: ${table}`);
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    } },
  });
  mocks.admin.mockReturnValue(admin);
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("driver dashboard API", () => {
  it("loads the planned route on the operator's day and excludes superseded Kent dates", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.today).toBe(today);
    expect(body.timeZone).toBe("Europe/Paris");
    expect(body.todayJobs.map((row: { id: string }) => row.id)).toEqual([
      "bob-planned", "job-date-fallback", "scheduled-fallback", "subcontracted",
    ]);
    // The client re-filters the API result: it must retain the planned work.
    expect(body.todayJobs.filter((row: Parameters<typeof isDriverJobForDate>[0]) => isDriverJobForDate(row, body.today))).toEqual(body.todayJobs);
    expect(body.todayJobs[0]).toMatchObject({ planning_date: today, scheduled_date: "2026-10-04", route_order: 1 });
    expect(body.jobs.some((row: { id: string }) => row.id === "kent-old")).toBe(true);
    expect(body.jobs.some((row: { id: string }) => ["other-driver", "other-tenant"].includes(row.id))).toBe(false);
    expect(requests.filter((url) => url.pathname.endsWith("/jobs"))).toHaveLength(2);
  });

  it("keeps subcontractor restrictions on both today's work and assignment history", async () => {
    mocks.session.mockResolvedValue({ tenantId: "tenant-bob", driverId: "bob", portalType: "subcontractor", subcontractorId: "sub-a" });
    const response = await GET();
    const body = await response.json();
    expect(body.todayJobs.map((row: { id: string }) => row.id)).toEqual(["subcontracted"]);
    expect(body.jobs.map((row: { id: string }) => row.id)).toEqual(["subcontracted"]);
  });
});

it("traces a saved 25-job HT21 EOR snapshot through board loading, date-aware assignment RPC and Bob's ordered dashboard queue", async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `ht21-job-${i + 1}`);
  const plannedOrder = [...ids].reverse();
  dashboardRows = ids.map((id) => job(id, {
    driver_id: null, vehicle_id: null, route_order: null,
    scheduled_date: "2026-10-04", planning_date: null,
  }));
  dashboardRows.push(job("older-kent", { planning_date: "2026-10-04", scheduled_date: "2026-10-04" }));
  storedSnapshot = createSavedPlanSnapshot({
    planningDate: today,
    lanes: [{ vehicleId: "ht21-eor", driverId: "bob", jobIds: plannedOrder }],
    pendingItineraries: {}, persistedItineraries: {},
  });
  expect((await (await GET()).json()).todayJobs).toEqual([]);

  const client = mocks.admin();
  const saved = await loadSavedPlan(client, "tenant-bob", "saved-ht21");
  const board = await loadPlanningBoardJobs(client, {
    tenantIds: [saved.tenantId], planningDate: saved.planningDate,
    savedJobIds: saved.snapshot.lanes.flatMap((lane) => lane.jobIds),
  });
  expect(board.error).toBeNull();
  expect(board.data).toHaveLength(25);
  const jobs = board.data as unknown as PlanJob[];
  const diff = computeSaveDiff(jobs, saved.snapshot.lanes, [], saved.planningDate);
  const save = buildPlanningSavePlan(diff, new Map(jobs.map((row) => [row.id, row])), saved.tenantId);
  if (!save.ok) throw new Error("Snapshot did not build a tenant-scoped save");
  expect((await savePlanningAssignments(client, save, saved.planningDate)).error).toBeNull();

  const response = await GET();
  expect(response.status).toBe(200);
  const dashboard = await response.json();
  expect(dashboard.todayJobs.map((row: { id: string }) => row.id)).toEqual(plannedOrder);
  expect(dashboard.todayJobs.every((row: { vehicle_id: string; route_order: number; planning_date: string }, index: number) =>
    row.vehicle_id === "ht21-eor" && row.route_order === index + 1 && row.planning_date === today)).toBe(true);
  expect(dashboard.todayJobs.filter((row: Parameters<typeof isDriverJobForDate>[0]) => isDriverJobForDate(row, dashboard.today))).toHaveLength(25);
  expect(dashboard.jobs.some((row: { id: string }) => row.id === "older-kent")).toBe(true);
  // One date-aware publication; no offline queue or snapshot reads in GET.
  expect(requests.filter((url) => url.pathname.endsWith("/rpc/save_planning_assignments"))).toHaveLength(1);
  expect(requests.filter((url) => url.pathname.endsWith("/planning_saved_plans"))).toHaveLength(1);
});
