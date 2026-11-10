// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VehicleLane from "../../app/planning/VehicleLane";
import { useVehicleLayout } from "../../app/planning/useVehicleLayout";
import { createSavedPlanSnapshot, parseSavedPlanSnapshot } from "./savedPlan";
import { summarizeLaneRegimes } from "./laneRegime";
import { evaluatePlanningCompliance } from "./compliance";

vi.mock("../../app/planning/VehicleLabelPrinter", () => ({ default: () => null }));
const vehicles = [{ id: "a", registration: "VAN A" }, { id: "b", registration: "VAN B" }, { id: "c", registration: "VAN C" }];
const noop = () => {};
let root: Root, container: HTMLDivElement;
function Board({ scope = "tenant:date:plan", savedOrder = ["a", "b", "c"] }: { scope?: string; savedOrder?: string[] }) {
  const layout = useVehicleLayout(vehicles, scope, savedOrder);
  const [selected, select] = useState("a");
  return createElement("main", {}, ...layout.vehicles.map((vehicle, index) => createElement(VehicleLane, {
    key: vehicle.id, vehicle, jobs: [], driverId: null, drivers: [], selected: selected === vehicle.id,
    summary: "0 jobs", regimeSummary: summarizeLaneRegimes({ ...vehicle, mam_kg: null, trailer_mam_kg: null, tachograph_fitted: null, tachograph_type: null, home_country_code: null }, []),
    compliance: evaluatePlanningCompliance({ driver: null, hasPlannedJobs: false, plannedDrivingSeconds: 0, driverHours: null, today: "2026-11-10" }),
    geocodeSettled: true, onSelect: () => select(vehicle.id), onDriverChange: noop, onOpenJob: noop,
    onAcceptJob: noop, onMoveJob: noop, onDropJob: noop,
    collapsed: layout.collapsed.has(vehicle.id), onToggleCollapsed: () => layout.toggle(vehicle.id),
    onMoveVehicle: offset => layout.move(vehicle.id, offset), canMoveVehicleUp: index > 0, canMoveVehicleDown: index < vehicles.length - 1,
  })));
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
async function render(props = {}) { await act(async () => root.render(createElement(Board, props))); }
async function click(label: string) { await act(async () => (container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click()); }
function order() { return [...container.querySelectorAll("h3")].map(node => node.textContent); }
it("swaps entire vehicles one level, disables boundaries and preserves the order when selecting a lane", async () => {
  await render();
  expect((container.querySelector('[aria-label="Move VAN A up one level"]') as HTMLButtonElement).disabled).toBe(true);
  await click("Move VAN C up one level"); expect(order()).toEqual(["VAN A", "VAN C", "VAN B"]);
  await click("Route for VAN B"); expect(order()).toEqual(["VAN A", "VAN C", "VAN B"]);
  await click("Move VAN A down one level"); expect(order()).toEqual(["VAN C", "VAN A", "VAN B"]);
  expect((container.querySelector('[aria-label="Move VAN B down one level"]') as HTMLButtonElement).disabled).toBe(true);
});
it("keeps headings/totals accessible when collapsed and restores layout after remount", async () => {
  await render(); await click("Collapse VAN B"); await click("Move VAN B up one level");
  let button = container.querySelector('[aria-label="Expand VAN B"]')!;
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect((document.getElementById(button.getAttribute("aria-controls")!) as HTMLElement).hidden).toBe(true);
  expect(container.querySelector('[aria-label="Route for VAN B"]')?.textContent).toContain("0 jobs");
  await act(async () => root.unmount()); root = createRoot(container); await render();
  expect(order()).toEqual(["VAN B", "VAN A", "VAN C"]);
  expect(container.querySelector('[aria-label="Expand VAN B"]')).toBeTruthy();
  await click("Expand VAN B"); button = container.querySelector('[aria-label="Collapse VAN B"]')!;
  expect(button.getAttribute("aria-expanded")).toBe("true");
});
it("isolates workspace/date/plan layouts and uses saved snapshot lane order on a new device", async () => {
  const snapshot = parseSavedPlanSnapshot(createSavedPlanSnapshot({ planningDate: "2026-11-07",
    lanes: ["c", "a", "b"].map(vehicleId => ({ vehicleId, driverId: null, jobIds: [] })),
    pendingItineraries: {}, persistedItineraries: {} }))!;
  await render({ savedOrder: snapshot.lanes.map(lane => lane.vehicleId) });
  expect(order()).toEqual(["VAN C", "VAN A", "VAN B"]);
  await click("Collapse VAN A"); await click("Move VAN B up one level");
  await render({ scope: "another-tenant:date:plan" });
  expect(order()).toEqual(["VAN A", "VAN B", "VAN C"]);
  expect(container.querySelector('[aria-label="Expand VAN A"]')).toBeNull();
});
it("works when device storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  await render(); await click("Move VAN B up one level"); await click("Collapse VAN B");
  expect(order()).toEqual(["VAN B", "VAN A", "VAN C"]);
  expect(container.querySelector('[aria-label="Expand VAN B"]')).toBeTruthy();
});
