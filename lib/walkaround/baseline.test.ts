import { describe, expect, it } from "vitest";
import { BASELINE_CATALOGUE } from "./baseline";

describe("BASELINE_CATALOGUE", () => {
  it("has unique codes in the dotted lower-case form", () => {
    const codes = BASELINE_CATALOGUE.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z0-9_]+\.[a-z0-9_]+$/);
  });

  it("never uses the company prefix reserved for company items", () => {
    for (const e of BASELINE_CATALOGUE) expect(e.code.startsWith("co.")).toBe(false);
  });

  it("classes the core roadworthiness defects as dangerous", () => {
    const dangerous = new Set(BASELINE_CATALOGUE.filter((e) => e.severity === "dangerous").map((e) => e.code));
    for (const code of [
      "brakes.air_leak",
      "brakes.pressure_build",
      "steering.excessive_play",
      "tyres.tread",
      "wheels.nut_loose",
      "leaks.fuel",
      "lights.brake_lamp",
      "coupling.insecure",
      "load.insecure",
      "mirrors_glass.windscreen_view",
    ]) {
      expect(dangerous.has(code), code).toBe(true);
    }
  });

  it("gives every entry guidance and ascending sort order", () => {
    let last = -1;
    for (const e of BASELINE_CATALOGUE) {
      expect(e.guidance.length).toBeGreaterThan(10);
      expect(e.sortOrder).toBeGreaterThan(last);
      last = e.sortOrder;
    }
  });

  it("contains no em-dashes", () => {
    expect(JSON.stringify(BASELINE_CATALOGUE)).not.toContain("—");
  });
});
