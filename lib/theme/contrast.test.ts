import { describe, it, expect } from "vitest";
import { contrastRatio, relativeLuminance } from "./contrast";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

// Resolved relative to this file, not process.cwd(), so the test does not
// depend on the directory vitest happens to be invoked from (e.g. running
// vitest from a subdirectory would otherwise throw ENOENT).
const TOKENS_PATH = fileURLToPath(new URL("../../app/tokens.css", import.meta.url));
const css = readFileSync(TOKENS_PATH, "utf8");
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

/* Skeleton placeholders are decorative: every one carries aria-hidden, so they
   are not "visual information required to identify a component" and WCAG
   1.4.11's 3:1 does not apply. They must still be perceptible against every
   surface they can sit on.

   DO NOT raise this to AA_NON_TEXT. A bar at 3:1 reads as real content rather
   than a placeholder, which is the exact confusion a skeleton exists to avoid.
   The shipped values measure 1.30 to 1.54 across both themes. */
const SKELETON_VISIBLE = 1.25;

/* The same pairs are asserted against both themes: a token's job does not
   change between them, only its value does. */
/* DELIBERATELY NOT ASSERTED: badge borders against --surface.
   components/Badge.tsx renders a tinted pill with a coloured border, and those
   borders measure roughly 1.2 to 1.6:1 against the card in light, 1.3 to 3.3:1
   in dark. That is not a WCAG failure. 1.4.11 governs visual information
   REQUIRED to identify a component or its state, and a badge is not an
   interactive component: its state is carried by its text, which passes 4.5:1
   in both themes (asserted above as the "*-strong on tint" pairs). The border
   is decorative reinforcement. The dark borders were nonetheless strengthened
   relative to light because status scanning is the main job of the jobs board,
   which is a legibility improvement, not a conformance one. */
const PAIRS: Pair[] = [
  { label: "ink on surface",              fg: "--ink",               bg: "--surface",       min: AA_TEXT },
  { label: "ink on canvas",               fg: "--ink",               bg: "--canvas",        min: AA_TEXT },
  { label: "ink on surface-2",            fg: "--ink",               bg: "--surface-2",     min: AA_TEXT },
  { label: "ink-2 on surface",            fg: "--ink-2",             bg: "--surface",       min: AA_TEXT },
  { label: "ink-2 on canvas",             fg: "--ink-2",             bg: "--canvas",        min: AA_TEXT },
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
  { label: "success-strong on surface",   fg: "--success-strong",    bg: "--surface",       min: AA_TEXT },
  { label: "danger-strong on surface",    fg: "--danger-strong",     bg: "--surface",       min: AA_TEXT },
  { label: "focus on canvas",             fg: "--focus",             bg: "--canvas",        min: AA_NON_TEXT },
  { label: "focus on surface",            fg: "--focus",             bg: "--surface",       min: AA_NON_TEXT },
  { label: "focus on chrome",             fg: "--focus",             bg: "--chrome",        min: AA_NON_TEXT },
  { label: "skeleton on surface",         fg: "--skeleton",          bg: "--surface",       min: SKELETON_VISIBLE },
  { label: "skeleton on surface-2",       fg: "--skeleton",          bg: "--surface-2",     min: SKELETON_VISIBLE },
  { label: "skeleton on canvas",          fg: "--skeleton",          bg: "--canvas",        min: SKELETON_VISIBLE },
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
      const ratio = contrastRatio(fg, bg);
      expect(
        ratio,
        `${pair.label} in ${selector}: ${pair.fg} on ${pair.bg} measures ${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
      ).toBeGreaterThanOrEqual(pair.min);
    },
  );
});

/* Pairs asserted against the dark default only. Their light-theme counterparts
   are pre-existing shipped failures recorded in KNOWN_GAPS below, which this
   branch deliberately does not fix, so they cannot go in PAIRS (which runs
   against both themes). */
const DARK_ONLY_PAIRS: Pair[] = [
  { label: "line-strong on surface (input and control borders)", fg: "--line-strong", bg: "--surface", min: AA_NON_TEXT },
];

describe(":root only contrast", () => {
  it.each(DARK_ONLY_PAIRS.map((p) => [p.label, p] as const))("%s", (_label, pair) => {
    const block = blocks[":root"];
    const fg = block[pair.fg];
    const bg = block[pair.bg];
    expect(fg, `${pair.fg} missing from :root`).toBeDefined();
    expect(bg, `${pair.bg} missing from :root`).toBeDefined();
    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `${pair.label} in :root: ${pair.fg} on ${pair.bg} measures ${ratio.toFixed(2)}:1, needs ${pair.min}:1`,
    ).toBeGreaterThanOrEqual(pair.min);
  });
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
  { selector: ".light", fg: "--ink-3",       bg: "--surface", floor: 4.15, target: 4.5, note: "needs 4.5 as body text" },
  { selector: ".light", fg: "--ink-4",       bg: "--surface", floor: 2.62, target: 4.5, note: "needs 4.5; unused by any component" },
  { selector: ".light", fg: "--line-strong", bg: "--surface", floor: 1.84, target: 3,   note: "needs 3 as a UI component boundary" },
  { selector: ":root",  fg: "--ink-4",       bg: "--surface", floor: 3.10, target: 4.5, note: "needs 4.5; unused by any component" },
] as const;

describe("known contrast gaps (documented, must not regress)", () => {
  it.each(KNOWN_GAPS.map((g) => [`${g.selector} ${g.fg} on ${g.bg} (${g.note})`, g] as const))(
    "%s",
    (_label, gap) => {
      const block = blocks[gap.selector];
      const ratio = contrastRatio(block[gap.fg], block[gap.bg]);
      expect(
        ratio,
        `${gap.selector} ${gap.fg} on ${gap.bg}: measures ${ratio.toFixed(2)}:1, below the documented floor of ${gap.floor}:1. This is a regression, not a known gap.`,
      ).toBeGreaterThanOrEqual(gap.floor);
      // If this trips, it's good news: the gap has been fixed. Move the pair
      // from KNOWN_GAPS into PAIRS above instead of raising this floor.
      expect(
        ratio,
        `${gap.selector} ${gap.fg} on ${gap.bg}: this gap has been fixed (now ${ratio.toFixed(2)}:1, target was ${gap.target}:1). Move it from KNOWN_GAPS into PAIRS.`,
      ).toBeLessThan(gap.target);
    },
  );
});
