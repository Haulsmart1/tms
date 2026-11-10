// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { WarehouseWorkspace } from "../../app/warehouse/WarehouseDashboard";
import type { WarehouseJob, WarehouseResult } from "./types";
vi.mock("next/dynamic", () => ({ default: () => () => null }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let root: Root, container: HTMLDivElement, jobs: WarehouseJob[], posts: Record<string, unknown>[], failSave: boolean, ambiguous: boolean;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  jobs = [{ id: id(2), reference: "WH-ONE", status: "cancelled", pod_status: "pending", vehicle_id: null,
    driver_id: null, planning_date: null, customer_reference: null, external_reference: null,
    barcodes: ["FD C10930 6860 0134"], stops: [] }];
  posts = []; failSave = false; ambiguous = false;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      if (failSave) return Response.json({ error: "Temporary failure" }, { status: 500 });
      return Response.json({ ok: true, result: { count: 1 } });
    }
    const params = new URL(input, "https://fixture.invalid").searchParams;
    const found = params.get("q") === "UNKNOWN" ? [] : ambiguous ? [...jobs, { ...jobs[0], id: id(3), reference: "WH-TWO" }] : jobs;
    const result: WarehouseResult = { jobs: found, total: found.length, page: 0, manifest: false,
      stats: { total: 1, outstanding: 1, delivered: 0, collected: 0, unassigned: 1 }, recent: [],
      options: { vehicles: [{ id: id(4), registration: "HT21 EOR" }], drivers: [], plans: [{ id: id(5), name: "CBA", planning_date: "2026-11-07" }] } };
    return Response.json(result);
  }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(WarehouseWorkspace, { tenantId: id(1) }))); }
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === text)!;
  expect(button, text).toBeTruthy(); await act(async () => button.click());
}
async function selectJob() { await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click()); }
async function scan(text: string) {
  const input = container.querySelector('input[placeholder="Scan here, then press Enter"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
it("signs off a cancelled selection without a required photo and reports successful save", async () => {
  await render(); await selectJob(); await click("Mark delivered");
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ tenantId: id(1), action: "deliver", jobIds: [id(2)] });
  expect(container.textContent).toContain("1 job delivered. Saved successfully.");
  expect(container.textContent).toContain("0 selected");
});
it("retains a failed selection and reuses its request ID on retry", async () => {
  await render(); await selectJob(); failSave = true; await click("Mark delivered");
  expect(container.textContent).toContain("Temporary failure"); expect(container.textContent).toContain("1 selected");
  failSave = false; await click("Mark delivered");
  expect(posts).toHaveLength(2); expect(posts[0].requestId).toBe(posts[1].requestId);
});
it("moves a completed job to a saved plan and destination van", async () => {
  jobs[0].status = "completed"; await render(); await selectJob();
  const selects = container.querySelectorAll("select");
  await act(async () => { selects[2].value = id(4); selects[2].dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { selects[4].value = id(5); selects[4].dispatchEvent(new Event("change", { bubbles: true })); });
  await click("Move selected jobs");
  expect(posts[0]).toMatchObject({ action: "move", vehicleId: id(4), planId: id(5), planningDate: "2026-11-07" });
});
it("shows saved plans before the scanner and opens the saved date and workspace without choosing a van", async () => {
  await render();
  const section = container.querySelector('section[aria-labelledby="warehouse-saved-plans"]')!;
  expect(section.textContent).toContain("CBA");
  expect(section.textContent).toContain("7 November 2026");
  const link = section.querySelector('a[aria-label="Open saved plan CBA"]')!;
  const href = new URL(link.getAttribute("href")!, "https://fixture.invalid");
  expect(href.pathname).toBe("/planning");
  expect(Object.fromEntries(href.searchParams)).toEqual({ date: "2026-11-07", tenant: id(1), plan: id(5) });
  expect(section.compareDocumentPosition(container.querySelector('section[aria-label="Barcode scanner"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(posts).toHaveLength(0);
  expect(container.textContent).toContain("0 selected");
});
it("adds a scanned job once and keeps repeated scans idempotent in the selection", async () => {
  await render(); await scan("FD C10930 6860 0134");
  expect(container.textContent).toContain("1 selected"); await scan("FD C10930 6860 0134");
  expect(container.textContent).toContain("WH-ONE is already selected."); expect(posts).toHaveLength(0);
});
it("does not automatically select ambiguous or unknown barcode matches", async () => {
  await render(); ambiguous = true; await scan("WH-SHARED");
  expect(container.textContent).toContain("2 jobs match. Select the correct job below.");
  expect(container.textContent).toContain("0 selected");
  await scan("UNKNOWN"); expect(container.textContent).toContain("No matching barcode."); expect(posts).toHaveLength(0);
});
