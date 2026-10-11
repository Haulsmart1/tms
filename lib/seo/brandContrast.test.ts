import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contrastRatio } from "../theme/contrast";

const css = readFileSync(new URL("../../components/landing/brand.css", import.meta.url), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(match => [match[1], match[2]]));
describe("public brand contrast", () => {
  for (const surface of ["canvas", "surface", "surface-2"]) {
    for (const foreground of ["ink", "ink-2", "ink-3", "primary", "primary-deep"]) {
      it(`${foreground} on ${surface} meets normal-text contrast`, () => {
        expect(contrastRatio(tokens[foreground], tokens[surface])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it("primary buttons and their hover states retain readable labels", () => {
    for (const fill of ["primary", "primary-hover"]) expect(contrastRatio(tokens["on-primary"], tokens[fill])).toBeGreaterThanOrEqual(4.5);
  });
  it("brand focus and input boundaries remain distinguishable", () => {
    for (const surface of ["canvas", "surface", "surface-2"]) {
      expect(contrastRatio(tokens.focus, tokens[surface])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(tokens["line-strong"], tokens[surface])).toBeGreaterThanOrEqual(3);
    }
  });
});
