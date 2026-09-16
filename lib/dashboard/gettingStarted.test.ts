import { createElement } from "react";
/* @types/react-dom is not installed in this repo (only @types/react), so the
   server renderer has no declaration file. Suppressed rather than adding a
   dev dependency for one test; renderToStaticMarkup is typed any here. */
// @ts-ignore TS7016: no declaration file for react-dom/server
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildGettingStartedSteps, isGettingStartedComplete } from "./gettingStarted";
import GettingStartedPanel from "../../components/dashboard/GettingStartedPanel";
import { CARD_SETUP_SENTENCE } from "../billing/pricingCopy";

const V1_SENTENCE = "first charge is taken today";

describe("buildGettingStartedSteps", () => {
  it("returns card, vehicle and driver in that order with the given links", () => {
    const steps = buildGettingStartedSteps(
      { cardCount: 0, vehicleCount: 0, driverCount: 0 },
      { cardDescription: "x" },
    );
    expect(steps.map((s) => s.key)).toEqual(["card", "vehicle", "driver"]);
    expect(steps.map((s) => s.href)).toEqual(["/settings/billing", "/vehicles", "/drivers"]);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("marks a step done when its count is positive", () => {
    const steps = buildGettingStartedSteps(
      { cardCount: 1, vehicleCount: 0, driverCount: 3 },
      { cardDescription: "x" },
    );
    expect(steps.map((s) => s.done)).toEqual([true, false, true]);
  });

  it("treats a NaN or negative count as not done", () => {
    const steps = buildGettingStartedSteps(
      { cardCount: Number.NaN, vehicleCount: -1, driverCount: 0 },
      { cardDescription: "x" },
    );
    expect(steps.every((s) => !s.done)).toBe(true);
  });
});

describe("isGettingStartedComplete", () => {
  it("is true only when all three counts are positive", () => {
    expect(isGettingStartedComplete({ cardCount: 1, vehicleCount: 1, driverCount: 1 })).toBe(true);
    expect(isGettingStartedComplete({ cardCount: 0, vehicleCount: 1, driverCount: 1 })).toBe(false);
    expect(isGettingStartedComplete({ cardCount: 1, vehicleCount: 0, driverCount: 1 })).toBe(false);
    expect(isGettingStartedComplete({ cardCount: 1, vehicleCount: 1, driverCount: 0 })).toBe(false);
  });
});

describe("GettingStartedPanel", () => {
  function render(counts: { cardCount: number; vehicleCount: number; driverCount: number }) {
    return renderToStaticMarkup(createElement(GettingStartedPanel, counts));
  }

  it("renders three steps with their links when nothing is done", () => {
    const html = render({ cardCount: 0, vehicleCount: 0, driverCount: 0 });
    expect(html).toContain("Getting started");
    expect(html).toContain("3 steps left");
    expect(html.match(/data-step="/g)?.length).toBe(3);
    for (const href of ["/settings/billing", "/vehicles", "/drivers"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain(CARD_SETUP_SENTENCE.replace(/'/g, "&#x27;"));
  });

  it("marks done steps and drops their links", () => {
    const html = render({ cardCount: 1, vehicleCount: 0, driverCount: 0 });
    expect(html).toContain('data-step="card" data-done="true"');
    expect(html).toContain('data-step="vehicle" data-done="false"');
    expect(html).not.toContain('href="/settings/billing"');
    expect(html).toContain('href="/vehicles"');
    expect(html).toContain("2 steps left");
  });

  it("says one step left in the singular", () => {
    const html = render({ cardCount: 1, vehicleCount: 1, driverCount: 0 });
    expect(html).toContain("One step left");
  });

  it("renders nothing when all three exist", () => {
    expect(render({ cardCount: 1, vehicleCount: 2, driverCount: 3 })).toBe("");
  });

  it("never renders the v1 charge sentence", () => {
    for (const counts of [
      { cardCount: 0, vehicleCount: 0, driverCount: 0 },
      { cardCount: 0, vehicleCount: 1, driverCount: 1 },
    ]) {
      expect(render(counts).toLowerCase()).not.toContain(V1_SENTENCE);
    }
    expect(CARD_SETUP_SENTENCE.toLowerCase()).not.toContain(V1_SENTENCE);
  });
});
