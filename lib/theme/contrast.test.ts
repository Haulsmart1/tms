import { describe, it, expect } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTokenBlocks } from "./parseTokens";

describe("contrastRatio", () => {
  it("returns 21:1 for black on white, the WCAG maximum", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
  });

  // Self-contrast is 1 by construction (same luminance both sides of the
  // ratio), so this pins the contract rather than exercising the maths.
  it("returns 1:1 for a colour against itself", () => {
    expect(contrastRatio("#2953E3", "#2953E3")).toBeCloseTo(1, 5);
  });

  // Symmetry cannot fail given the Math.max/Math.min ordering in
  // contrastRatio, so this pins the contract rather than exercising the maths.
  it("is order-independent, since WCAG ratios are symmetric", () => {
    expect(contrastRatio("#0B1220", "#F2F4F8")).toBeCloseTo(
      contrastRatio("#F2F4F8", "#0B1220"), 5,
    );
  });

  it("accepts shorthand hex", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 2);
  });

  it("matches a known third-party value: #2953E3 on white is 6.10:1", () => {
    expect(contrastRatio("#2953E3", "#FFFFFF")).toBeCloseTo(6.10, 2);
  });

  // Independent third-party cross-check at a mid-range value, to guard
  // against a wrong sRGB linearisation constant. #767676 on white is the
  // well-known WCAG boundary value, independently confirmed at 4.542225 by a
  // from-scratch implementation.
  it("matches a known WCAG boundary value: #767676 on white is 4.54:1", () => {
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  it("throws on 8-digit hex with alpha instead of silently scoring it as opaque", () => {
    expect(() => contrastRatio("#0B1220E6", "#FFFFFF")).toThrow();
  });

  it("throws on non-hex colour forms rather than returning NaN", () => {
    expect(() => contrastRatio("rgba(0,0,0,.45)", "#FFFFFF")).toThrow();
    expect(() => contrastRatio("white", "#000000")).toThrow();
    expect(() => contrastRatio("", "#FFFFFF")).toThrow();
  });

  it("still accepts whitespace-padded and shorthand hex", () => {
    expect(contrastRatio("#FFF ", "#000000")).toBeCloseTo(21, 2);
    expect(contrastRatio("#abc", "#000000")).toBeGreaterThan(1);
  });

  it("relativeLuminance is 1 for white and 0 for black", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 10);
  });
});

const css = readFileSync(resolve(process.cwd(), "app/tokens.css"), "utf8");
const blocks = parseTokenBlocks(css);

/* Both themes must declare EVERY token. The previous .dark scaffold overrode
   only some of them and silently inherited light values for the rest, which is
   how the focus ring ended up at 2.85:1 on a dark surface. Parity is asserted
   structurally so that failure mode cannot recur. */
describe("token block structure", () => {
  it("declares :root (dark default), .dark (the pin) and .light (the opt-out)", () => {
    expect(blocks[":root"]).toBeDefined();
    expect(blocks[".dark"]).toBeDefined();
    expect(blocks[".light"]).toBeDefined();
  });

  it("declares the same token names in every block, with no partial overrides", () => {
    const root = Object.keys(blocks[":root"]).sort();
    expect(Object.keys(blocks[".light"]).sort()).toEqual(root);
    expect(Object.keys(blocks[".dark"]).sort()).toEqual(root);
  });

  it("gives .dark values identical to :root, since it exists only to let a subtree resist an ancestor .light", () => {
    expect(blocks[".dark"]).toEqual(blocks[":root"]);
  });
});

type Pair = { fg: string; bg: string; min: number; label: string };

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/* The same pairs are asserted against both themes: a token's job does not
   change between them, only its value does. */
const PAIRS: Pair[] = [
  { label: "ink on surface",              fg: "--ink",               bg: "--surface",       min: AA_TEXT },
  { label: "ink on canvas",               fg: "--ink",               bg: "--canvas",        min: AA_TEXT },
  { label: "ink on surface-2",            fg: "--ink",               bg: "--surface-2",     min: AA_TEXT },
  { label: "ink-2 on surface",            fg: "--ink-2",             bg: "--surface",       min: AA_TEXT },
  { label: "chrome-text on chrome",       fg: "--chrome-text",       bg: "--chrome",        min: AA_TEXT },
  { label: "chrome-text-strong on chrome",fg: "--chrome-text-strong",bg: "--chrome",        min: AA_TEXT },
  { label: "chrome-text on chrome-raised",fg: "--chrome-text",       bg: "--chrome-raised", min: AA_TEXT },
  { label: "chrome-link on chrome",       fg: "--chrome-link",       bg: "--chrome",        min: AA_TEXT },
  { label: "primary link on surface",     fg: "--primary",           bg: "--surface",       min: AA_TEXT },
  { label: "on-primary on primary",       fg: "--on-primary",        bg: "--primary",       min: AA_TEXT },
  { label: "on-primary on primary-hover", fg: "--on-primary",        bg: "--primary-hover", min: AA_TEXT },
  { label: "on-primary on primary-active",fg: "--on-primary",        bg: "--primary-active",min: AA_TEXT },
  { label: "on-danger on danger",         fg: "--on-danger",         bg: "--danger",        min: AA_TEXT },
  { label: "success-strong on tint",      fg: "--success-strong",    bg: "--success-tint",  min: AA_TEXT },
  { label: "warning-strong on tint",      fg: "--warning-strong",    bg: "--warning-tint",  min: AA_TEXT },
  { label: "danger-strong on tint",       fg: "--danger-strong",     bg: "--danger-tint",   min: AA_TEXT },
  { label: "primary-deep on tint",        fg: "--primary-deep",      bg: "--primary-tint",  min: AA_TEXT },
  { label: "accent-text on tint",         fg: "--accent-text",       bg: "--accent-tint",   min: AA_TEXT },
  { label: "focus on canvas",             fg: "--focus",             bg: "--canvas",        min: AA_NON_TEXT },
  { label: "focus on surface",            fg: "--focus",             bg: "--surface",       min: AA_NON_TEXT },
  { label: "focus on chrome",             fg: "--focus",             bg: "--chrome",        min: AA_NON_TEXT },
];

describe.each([
  [":root", "dark (default)"],
  [".light", "light (opt-out)"],
] as const)("%s contrast: %s", (selector, _themeLabel) => {
  const block = blocks[selector];
  it.each(PAIRS.map((p) => [p.label, p] as const))(
    "%s",
    (_label, pair) => {
      const fg = block[pair.fg];
      const bg = block[pair.bg];
      expect(fg, `${pair.fg} missing from ${selector}`).toBeDefined();
      expect(bg, `${pair.bg} missing from ${selector}`).toBeDefined();
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(pair.min);
    },
  );
});

/* KNOWN GAPS, documented in the spec rather than fixed.

   Three of these are pre-existing in the already-shipped light theme and are
   NOT caused by the dark work; fixing them means changing shipped light values,
   which is its own decision. The fourth is a dark token that no component uses.

   These assert the ratio does not get WORSE, so the gaps stay documented and
   cannot silently regress further. Raising any of them to its AA minimum and
   moving the pair into PAIRS above is a welcome future change. */
/* Floors are the measured ratio truncated DOWN to two decimals, never rounded.
   Rounding a floor to the nearest value makes it unsatisfiable whenever the
   measurement rounds up: --ink-4 on .light measures 2.628180 and a floor of
   2.63 can never be met. Both floors below that would have rounded up were
   originally written that way and failed for exactly this reason. Truncate.
   Exact measurements at the time of writing, for reference:
     .light --ink-3        4.150979
     .light --ink-4        2.628180
     .light --line-strong  1.844191
     :root  --ink-4        3.106927 */
const KNOWN_GAPS = [
  { selector: ".light", fg: "--ink-3",       bg: "--surface", floor: 4.15, note: "needs 4.5 as body text" },
  { selector: ".light", fg: "--ink-4",       bg: "--surface", floor: 2.62, note: "needs 4.5; unused by any component" },
  { selector: ".light", fg: "--line-strong", bg: "--surface", floor: 1.84, note: "needs 3 as a UI component boundary" },
  { selector: ":root",  fg: "--ink-4",       bg: "--surface", floor: 3.10, note: "needs 4.5; unused by any component" },
] as const;

describe("known contrast gaps (documented, must not regress)", () => {
  it.each(KNOWN_GAPS.map((g) => [`${g.selector} ${g.fg} on ${g.bg} (${g.note})`, g] as const))(
    "%s",
    (_label, gap) => {
      const block = blocks[gap.selector];
      expect(contrastRatio(block[gap.fg], block[gap.bg])).toBeGreaterThanOrEqual(gap.floor);
    },
  );
});
