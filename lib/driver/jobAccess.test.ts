import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { loadDriverJobStop } from "./jobAccess";
import type { DriverSession } from "./server";

const session: DriverSession = {
  userId: "user", tenantId: "tenant", driverId: "driver", subcontractorId: "subcontractor", portalType: "subcontractor_driver",
};

function fixture() {
  const job = { id: "job", tenant_id: "tenant", driver_id: "driver", subcontractor_id: "subcontractor", status: "planned", created_at: null };
  const stop = { id: "stop", tenant_id: "tenant", job_id: "job", type: "delivery", pod_status: "delivered", pod_photo_url: null, delivered_at: "2026-10-17T12:00:00Z" };
  const requests: URL[] = [];
  const client = createClient("https://synthetic.supabase.co", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      const rows = url.pathname.endsWith("/jobs") ? [job] : [stop];
      const matching = rows.filter((row) => [...url.searchParams].every(([key, value]) => {
        if (!value.startsWith("eq.")) return true;
        return (row as Record<string, unknown>)[key] === value.slice(3);
      }));
      return new Response(JSON.stringify(matching), { headers: { "Content-Type": "application/json" } });
    } },
  });
  return { client, job, stop, requests };
}

it("loads a stop only through the session's tenant, driver and subcontractor filters", async () => {
  const { client, requests } = fixture();
  expect(await loadDriverJobStop(client, session, "job", "stop")).not.toBeNull();
  expect(Object.fromEntries(requests[0].searchParams)).toMatchObject({
    tenant_id: "eq.tenant", driver_id: "eq.driver", subcontractor_id: "eq.subcontractor",
  });
  expect(Object.fromEntries(requests[1].searchParams)).toMatchObject({ tenant_id: "eq.tenant", job_id: "eq.job", id: "eq.stop" });
});
it.each(["tenant_id", "driver_id", "subcontractor_id"] as const)("rejects a job owned by a different %s", async (field) => {
  const { client, job, requests } = fixture();
  job[field] = "someone-else";
  expect(await loadDriverJobStop(client, session, "job", "stop")).toBeNull();
  expect(requests).toHaveLength(1);
});
it.each(["tenant_id", "job_id"] as const)("rejects a stop belonging to a different %s", async (field) => {
  const { client, stop } = fixture();
  stop[field] = "someone-else";
  expect(await loadDriverJobStop(client, session, "job", "stop")).toBeNull();
});
it("does not reuse earlier authority after dispatch reassigns the job", async () => {
  const { client, job } = fixture();
  expect(await loadDriverJobStop(client, session, "job", "stop")).not.toBeNull();
  job.driver_id = "new-driver";
  expect(await loadDriverJobStop(client, session, "job", "stop")).toBeNull();
});
