import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { beforeAll, describe, expect, it } from "vitest";
import UnassignedPool from "../../app/planning/UnassignedPool";
import VehicleLane from "../../app/planning/VehicleLane";
import PlanJobCard from "../../app/planning/PlanJobCard";
import type { PlanJob } from "./types";

// Real components, deliberately hostile long text. These are SSR/CSS guards,
// not claims about layout measurement, browser interaction or live acceptance.
const job: PlanJob = {
  id: "job-layout-fixture", tenant_id: "tenant-fixture",
  reference: "RMA" + "1234567890".repeat(15), customer_name: "Customer".repeat(30),
  status: "pending_acceptance", collection_eta: null, delivery_eta: null,
  acceptance_note: null, accepted_at: null, accepted_by: null, vehicle_id: null,
  driver_id: null, subcontractor_id: null, route_order: null, stops: [],
};
const noop = () => {};

describe("planning mobile containment", () => {
  it("stacks the entire board until desktop, not only the job cards", () => {
    const source = readFileSync("app/planning/page.tsx", "utf8");
    expect(source).toContain('className="flex min-w-0 w-full flex-col items-start gap-4 lg:flex-row"');
    expect(source).toContain('className="flex min-w-0 w-full flex-1 flex-col gap-3"');
    expect(source).not.toContain('className="flex items-start gap-4"');
    // The existing authenticated-shell rule reserves the fixed mobile menu's
    // 56px height only for main elements; a generic div silently misses it.
    expect(source).toContain('<main className="flex min-w-0 max-w-full');
    const globalCss = readFileSync("app/globals.css", "utf8");
    expect(globalCss).toContain(".tms-has-shell main");
    expect(globalCss).toContain("padding-top: 4.5rem");
  });

  it("renders an unconstrained mobile pool with the desktop 240px rail retained", () => {
    const html = renderToStaticMarkup(createElement(UnassignedPool, {
      jobs: [job], subcontracted: [], geocodeSettled: false,
      displacedNotes: {}, selectedJobIds: new Set([job.id]),
      onToggleJob: noop, onOpenJob: noop, onAcceptJob: noop, onDropJob: noop,
    }));
    expect(html).toContain("min-w-0 w-full");
    expect(html).toContain("lg:w-[240px]");
    expect(html).toContain('aria-label="Unassigned jobs" tabindex="0"');
    expect(html).toContain("max-h-96");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("lg:max-h-none lg:overflow-y-visible");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("1 selected");
    expect(html).toContain(job.reference!);
  });

  it("wraps real lane controls, bounds the native driver select, and retains compliance", () => {
    const html = renderToStaticMarkup(createElement(VehicleLane, {
      vehicle: { id: "vehicle-fixture", registration: "MX69 UJZ" }, jobs: [job],
      driverId: "driver-fixture", drivers: [{ id: "driver-fixture", name: "Driver".repeat(40) }],
      selected: true, summary: "2 jobs · 245 km · 5 h 42 m",
      regimeSummary: { status: "empty", regime: null, reviewRequired: false, hasOverrides: false, warningCount: 0, jobs: [] },
      compliance: { status: "incomplete", statusLabel: "Not checked", dataComplete: false,
        plannedDrivingSeconds: null, dailyDrivingRemainingSeconds: null, breakDueAfterSeconds: null, warnings: [], missing: ["Recorded hours"] },
      geocodeSettled: false, onSelect: noop, onDriverChange: noop, onOpenJob: noop,
      onAcceptJob: noop, onMoveJob: noop, onDropJob: noop,
    }));
    expect(html).toContain('class="mb-2 flex min-w-0 flex-wrap items-center gap-3"');
    expect(html).toContain('aria-label="Driver for MX69 UJZ"');
    expect(html).toContain("min-h-11 min-w-0 w-full max-w-full");
    expect(html).toContain("sm:max-w-[16rem]");
    expect(html).toContain("Rest and WTD not checked");
    expect(html).toContain("Missing: Recorded hours");
    expect(html).toContain('selected=""');
  });

  it("preserves selectable, keyboard-openable, draggable jobs and bounded text", () => {
    const html = renderToStaticMarkup(createElement(PlanJobCard, {
      job, sequence: 1, geocodeSettled: false, onOpen: noop, onAccept: noop,
      onSelectedChange: noop, onMoveUp: noop, onMoveDown: noop,
      canMoveUp: false, canMoveDown: true,
    }));
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('draggable="true"');
    expect(html).toContain("min-w-0 max-w-full");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toMatch(/class="min-h-11[^"]*"[^>]*>Up<\/button>/);
    expect(html).toMatch(/class="min-h-11[^"]*"[^>]*>Down<\/button>/);
    expect(html).toContain("Accept</button>");
  });
});

describe("compiled planning responsive utilities", () => {
  let css: postcss.Root;
  beforeAll(async () => {
    const content = ["page", "UnassignedPool", "VehicleLane", "PlanJobCard"].map(name => ({
      raw: readFileSync(`app/planning/${name}.tsx`, "utf8"), extension: "tsx",
    }));
    const result = await postcss([tailwindcss({ content, corePlugins: { preflight: false } })]).process("@tailwind utilities;", { from: undefined });
    css = result.root;
  });

  function rulesFor(selector: string) {
    const rules: postcss.Rule[] = [];
    css.walkRules(selector, rule => { rules.push(rule); });
    return rules;
  }

  function declarationAtWidth(selectors: string[], property: string, width: number) {
    let value: string | undefined;
    css.walkRules(rule => {
      if (!selectors.includes(rule.selector)) return;
      let parent: postcss.Container | postcss.Document | undefined = rule.parent;
      while (parent) {
        if (parent.type === "atrule" && (parent as postcss.AtRule).name === "media") {
          const minimum = /min-width:\s*(\d+)px/.exec((parent as postcss.AtRule).params);
          if (minimum && width < Number(minimum[1])) return;
        }
        parent = parent.parent;
      }
      rule.walkDecls(property, declaration => { value = declaration.value; });
    });
    return value;
  }

  it.each([320, 375, 390, 768, 1024, 1440])("applies the intended compiled CSS at %ipx (not browser geometry)", width => {
    const desktop = width >= 1024;
    expect(declarationAtWidth([".flex-col", ".lg\\:flex-row"], "flex-direction", width)).toBe(desktop ? "row" : "column");
    expect(declarationAtWidth([".w-full", ".lg\\:w-\\[240px\\]"], "width", width)).toBe(desktop ? "240px" : "100%");
    expect(declarationAtWidth([".max-h-96", ".lg\\:max-h-none"], "max-height", width)).toBe(desktop ? "none" : "24rem");
    expect(declarationAtWidth([".overflow-y-auto", ".lg\\:overflow-y-visible"], "overflow-y", width)).toBe(desktop ? "visible" : "auto");
  });

  it("ships a real 1024px desktop switch and a mobile full-width pool", () => {
    const row = rulesFor(".lg\\:flex-row");
    expect(row).toHaveLength(1);
    expect(row[0].parent?.type).toBe("atrule");
    expect((row[0].parent as postcss.AtRule).params).toBe("(min-width: 1024px)");
    expect(row[0].toString()).toContain("flex-direction: row");
    expect(rulesFor(".flex-col")[0].toString()).toContain("flex-direction: column");
    expect(rulesFor(".w-full")[0].toString()).toContain("width: 100%");
    expect(rulesFor(".min-w-0")[0].toString()).toContain("min-width: 0px");
  });

  it("ships long-token wrapping and 44px targets rather than inert class strings", () => {
    expect(rulesFor(".\\[overflow-wrap\\:anywhere\\]")[0].toString()).toContain("overflow-wrap: anywhere");
    expect(rulesFor(".min-h-11")[0].toString()).toContain("min-height: 2.75rem");
    expect(rulesFor(".max-w-full")[0].toString()).toContain("max-width: 100%");
  });

  it("keeps vehicle panels reachable below a large, independently scrollable pool", () => {
    expect(rulesFor(".max-h-96")[0].toString()).toContain("max-height: 24rem");
    expect(rulesFor(".overflow-y-auto")[0].toString()).toContain("overflow-y: auto");
    const desktopHeight = rulesFor(".lg\\:max-h-none")[0];
    expect((desktopHeight.parent as postcss.AtRule).params).toBe("(min-width: 1024px)");
    expect(desktopHeight.toString()).toContain("max-height: none");
    expect(rulesFor(".lg\\:overflow-y-visible")[0].toString()).toContain("overflow-y: visible");
  });
});
