import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { findSavedPlanForJob, planningJobHref, planningReturnHref, readPlanningReturnContext } from "./navigation";

const context = { tenantId: "20000000-0000-4000-8000-000000000001", date: "2026-11-07",
  planId: "30000000-0000-4000-8000-000000000001", vehicleId: "40000000-0000-4000-8000-000000000001" };
const jobId = "10000000-0000-4000-8000-000000000001";

describe("return from Jobs to the saved plan", () => {
  it("carries the exact plan, workspace, date and vehicle through Jobs and back", () => {
    const jobUrl = new URL(planningJobHref(jobId, context), "https://tms.example");
    expect(jobUrl.searchParams.get("job")).toBe(jobId);
    expect(readPlanningReturnContext(jobUrl.search, true)).toEqual(context);
    const returnUrl = new URL(planningReturnHref(context), "https://tms.example");
    expect(returnUrl.pathname).toBe("/planning");
    expect(readPlanningReturnContext(returnUrl.search)).toEqual(context);
  });
  it("supports live plans without a saved snapshot and rejects arbitrary return URLs and invalid dates", () => {
    const live = { ...context, planId: null };
    expect(readPlanningReturnContext(new URL(planningReturnHref(live), "https://tms.example").search)).toEqual(live);
    expect(planningJobHref(jobId)).toBe(`/jobs?job=${jobId}`);
    expect(readPlanningReturnContext("?returnTo=https://external.example")).toBeNull();
    expect(readPlanningReturnContext(`?tenant=${context.tenantId}&date=2026-02-30&plan=${context.planId}`)).toBeNull();
    expect(readPlanningReturnContext(`?tenant=${context.tenantId}&date=2026-11-07&plan=javascript:alert(1)`)).toBeNull();
  });
  it("finds legacy job links only within their tenant and refuses to guess between saved plans", async () => {
    let rows = [{ id: context.planId, name: "CBA", planning_date: context.date }];
    const urls: URL[] = [];
    const client = createClient("https://test.invalid", "test-key", { auth: { persistSession: false }, global: { fetch: async input => {
      urls.push(new URL(String(input)));
      return new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } });
    } } });
    expect(await findSavedPlanForJob(client, context.tenantId, jobId, context.date)).toEqual(rows[0]);
    expect(urls[0].searchParams.get("tenant_id")).toBe(`eq.${context.tenantId}`);
    expect(urls[0].searchParams.get("planning_date")).toBe(`eq.${context.date}`);
    expect(urls[0].searchParams.get("snapshot")).toContain(jobId);
    expect(urls[0].searchParams.get("limit")).toBe("2");
    rows = [...rows, { ...rows[0], id: "other" }];
    expect(await findSavedPlanForJob(client, context.tenantId, jobId)).toBeNull();
  });
});
