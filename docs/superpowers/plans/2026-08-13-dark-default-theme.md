# Dark-default theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dark the default theme of the console, with a per-device light toggle, without a flash of light on load and without touching business logic.

**Architecture:** Dark token values live in `:root`, so dark is what renders with no JavaScript at all. `.light` is the opt-out and `.dark` re-declares the dark values so a subtree can pin itself against an ancestor `.light`. A synchronous script at the top of `<body>` reads `localStorage["tms-theme"]` and adds `.light` to `<html>` before paint. One route allowlist (`THEMEABLE_ROUTES`) drives both the toggle's visibility and the legacy `.dark` pin.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 3 (Preflight off, tokens via CSS variables), Vitest (node environment, `lib/**/*.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-08-13-dark-default-theme-design.md`

**Branch:** `feat/dark-default-theme` (already exists; spec committed, dead `primary-50..950` ramp already removed).

---

## Deviation from the spec, decided during planning

The spec calls for `scripts/contrast-check.mjs`, a standalone script. This plan implements it instead as a **Vitest test** at `lib/theme/contrast.test.ts` that parses `app/tokens.css` and asserts ratios against the parsed values.

Two reasons. `vitest.config.ts` only includes `lib/**/*.test.ts`, so a test there runs on every `npm test` with no separate command to remember. And parsing the real CSS file means the test verifies the actual source of truth: a future contributor editing a token to a failing colour breaks the build, which a script holding its own copy of the hexes would not catch.

Same intent as the spec (committed, rerunnable contrast verification), stronger mechanism.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `lib/theme/theme.ts` | The `Theme` type, the storage key, and `normalizeTheme` (turns unknown storage values into a valid theme). Pure, no DOM. |
| `lib/theme/theme.test.ts` | Tests for `normalizeTheme`. |
| `lib/theme/themeScript.ts` | The blocking inline script as a string constant, single-sourced so layout and tests agree. |
| `lib/theme/parseTokens.ts` | Pure parser: CSS text in, `{ selector: { tokenName: value } }` out. |
| `lib/theme/parseTokens.test.ts` | Tests for the parser. |
| `lib/theme/contrast.ts` | Pure WCAG relative-luminance and contrast-ratio maths. |
| `lib/theme/contrast.test.ts` | Parses `app/tokens.css` and asserts every pair. The regression net. |
| `lib/nav/themeableRoutes.ts` | `THEMEABLE_ROUTES` and `isThemeableRoute`. The single source of truth for the toggle and the pin. |
| `lib/nav/themeableRoutes.test.ts` | Tests for `isThemeableRoute`. |
| `app/components/ThemeScope.tsx` | Client component. Pins non-themeable routes dark. |
| `app/components/ThemeToggle.tsx` | Client component. The light/dark button. |

**Modify:**

| File | Change |
|---|---|
| `app/tokens.css` | Inverted structure, full dark token set, two new tokens, black-based shadows, contributor header comment. |
| `tailwind.config.ts` | Add `on-primary` and `on-danger` colour keys. |
| `components/Button.tsx:17,20` | `text-white` becomes `text-on-primary` / `text-on-danger`. |
| `app/components/AppShell.tsx:66,82,100` | Same `text-white` fix; mount `ThemeToggle`. |
| `app/components/TenantGate.tsx:9` | Retint the hardcoded panel. |
| `app/layout.tsx:55-68` | Inline theme script, body background retint, `ThemeScope` wrapper. |
| `app/page.tsx:50` | `.light` pin on the landing page root. |
| `README.md:44-53` | Rewrite the Design system section: theme model, stale ds-page list, stale "planned direction" line. |
| `app/dashboard/page.tsx:179` | Split the full-bleed background off the centred container (Task 0). |
| `app/jobs/JobForm.tsx:46,53,60,83,94,105,117` | Stop grid and flex children overflowing their tracks (Task 0). |

**Not touched:** the 14 legacy pages, every query, every auth guard, every validation schema.

---

## Task 0: Pre-existing layout fixes (do these first)

Two layout bugs reported by Ethan on 2026-08-13, after the spec was approved. Both predate
this branch and are unrelated to theming: they came in with the 2026-08-11 design-system
rollout. They are first in the plan for a practical reason: Task 15's manual verification asks
you to eyeball `/dashboard` and `/jobs`, and judging colour on a broken layout is useless.

Neither changes any business logic.

**Files:**
- Modify: `app/dashboard/page.tsx:179` and its closing tag
- Modify: `app/jobs/JobForm.tsx`

### 0a: The dashboard background does not reach the sidebar

`bg-canvas` sits on the same element as `mx-auto max-w-6xl`, so the canvas only paints inside
the centred 72rem column. Everything either side falls through to the body, which is why the
page reads as a floating panel with large unfilled gaps instead of a full page.

`/jobs` already has the correct shape at `app/jobs/page.tsx:249-250`: a full-bleed `.ds
bg-canvas` wrapper with the width-constrained `<main>` nested inside it. This makes the
dashboard match.

- [ ] **Step 1: Split the wrapper from the container**

In `app/dashboard/page.tsx`, replace line 179:

```tsx
      <main className="ds min-h-screen bg-canvas font-sans text-ink mx-auto max-w-6xl px-6 py-8">
```

with two elements, matching the Jobs page pattern exactly:

```tsx
      {/* The full-bleed element carries `ds` and the background so the canvas
          reaches the sidebar; the inner <main> carries only the width
          constraint. Putting both on one element paints the canvas only inside
          max-w-6xl and leaves the page background showing either side. Same
          shape as app/jobs/page.tsx:249-250. */}
      <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-6xl px-6 py-8">
```

- [ ] **Step 2: Close the new element**

At the end of the same file, replace:

```tsx
      </main>
    </TenantGate>
```

with:

```tsx
        </main>
      </div>
    </TenantGate>
```

- [ ] **Step 3: Verify in the browser**

Run `npm run dev` and open `/dashboard`.
Expected: the page background runs edge to edge, meeting the sidebar with no gap, while the
content stays centred at the same width as before. Compare against `/jobs`: the two pages
should now frame their content identically.

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "fix: let the dashboard canvas fill the page instead of the centred column"
```

### 0b: Overlapping fields in the job form

Grid and flex children default to `min-width: auto`, which means they refuse to shrink below
their min-content width. A `<select>`'s min-content width is set by its longest `<option>`, so
a long subcontractor name makes that select wider than its grid track and it spills over the
field beside it. The four selects also lack `w-full`, so they do not fill their track in the
first place. Same mechanism causes the City and Postcode overlap in the stop rows.

The fix is `min-w-0` on the children (letting them shrink) plus `w-full` on the selects
(letting them fill). No layout structure changes.

- [ ] **Step 1: Fix the four selects**

In `app/jobs/JobForm.tsx`, each of the four `<label className="grid gap-1.5">` wrappers
(Customer, Vehicle, Driver, Subcontractor) becomes:

```tsx
        <label className="grid min-w-0 gap-1.5">
```

and each of the four `<select>` elements inside them changes its className from:

```tsx
            className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
```

to:

```tsx
            /* w-full so the select fills its grid track, min-w-0 so it may
               shrink below its longest <option>. Without min-w-0 a long
               subcontractor name widens the select past its track and it
               overlaps the field beside it. */
            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
```

- [ ] **Step 2: Fix the stop rows**

In the same file, in `StopRow`, add `min-w-0` to all three `wrapperClassName` values:

```tsx
        wrapperClassName="min-w-0 flex-1 basis-[220px]"
```

for the Address field (replacing `min-w-[220px] flex-1`: `basis-[220px]` keeps the same
preferred width while `min-w-0` lets it shrink rather than overflow), and:

```tsx
        wrapperClassName="w-40 min-w-0"
```

for City, and:

```tsx
        wrapperClassName="w-32 min-w-0"
```

for Postcode.

- [ ] **Step 3: Verify in the browser with realistic data**

Run `npm run dev` and open `/jobs`. This bug only shows with long option text, so verify
against real content, not an empty form:

1. Confirm Subcontractor and Subcontractor cost sit side by side with a visible gap, with the
   longest subcontractor name in the list selected.
2. Confirm City and Postcode in both a collection and a delivery stop row do not touch.
3. Narrow the browser to roughly 900px and then to mobile width. Fields should wrap or
   reflow, never overlap.

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add app/jobs/JobForm.tsx
git commit -m "fix: stop job-form selects and stop rows overflowing their tracks"
```

---

## Task 1: Theme type and storage key

**Files:**
- Create: `lib/theme/theme.ts`
- Test: `lib/theme/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/theme/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeTheme, STORAGE_KEY } from "./theme";

describe("normalizeTheme", () => {
  it("passes through the two valid themes", () => {
    expect(normalizeTheme("dark")).toBe("dark");
    expect(normalizeTheme("light")).toBe("light");
  });

  it("falls back to dark for anything else, so a corrupted or stale storage value cannot produce a bright screen in a control room", () => {
    expect(normalizeTheme(null)).toBe("dark");
    expect(normalizeTheme("")).toBe("dark");
    expect(normalizeTheme("LIGHT")).toBe("dark");
    expect(normalizeTheme("solarized")).toBe("dark");
  });
});

describe("STORAGE_KEY", () => {
  it("is the exact key the inline script reads; changing it silently strands every existing preference", () => {
    expect(STORAGE_KEY).toBe("tms-theme");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/theme/theme.test.ts`
Expected: FAIL, `Failed to resolve import "./theme"`.

- [ ] **Step 3: Write the implementation**

Create `lib/theme/theme.ts`:

```ts
/* Dark is the default and the fallback, deliberately. This app is used in dim
   control rooms, so an unreadable storage value must degrade to dark, never to
   a bright screen. See docs/superpowers/specs/2026-08-13-dark-default-theme-design.md */

export type Theme = "dark" | "light";

/** The localStorage key. Must stay in sync with THEME_SCRIPT in ./themeScript.ts. */
export const STORAGE_KEY = "tms-theme";

export function normalizeTheme(value: string | null): Theme {
  return value === "light" ? "light" : "dark";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/theme/theme.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/theme/theme.ts lib/theme/theme.test.ts
git commit -m "feat: add Theme type and storage key, defaulting to dark"
```

---

## Task 2: The themeable-route allowlist

This is the activation switch. Adding a path here is what moves a legacy page onto the theme once its styles are tokenised.

**Files:**
- Create: `lib/nav/themeableRoutes.ts`
- Test: `lib/nav/themeableRoutes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/nav/themeableRoutes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isThemeableRoute, THEMEABLE_ROUTES } from "./themeableRoutes";

describe("isThemeableRoute", () => {
  it("returns true for the five pages that paint their own bg-canvas on a .ds wrapper", () => {
    expect(isThemeableRoute("/")).toBe(true);
    expect(isThemeableRoute("/login")).toBe(true);
    expect(isThemeableRoute("/dashboard")).toBe(true);
    expect(isThemeableRoute("/jobs")).toBe(true);
    expect(isThemeableRoute("/super-admin/requests")).toBe(true);
  });

  it("returns false for legacy inline-styled pages, which pin themselves dark", () => {
    expect(isThemeableRoute("/pod")).toBe(false);
    expect(isThemeableRoute("/tracking")).toBe(false);
    expect(isThemeableRoute("/invoices")).toBe(false);
    expect(isThemeableRoute("/stats")).toBe(false);
  });

  it("returns false for an unknown route, so a new page is legacy-safe by default rather than half-themed", () => {
    expect(isThemeableRoute("/some-page-added-next-year")).toBe(false);
  });

  it("matches exactly and does not treat a sibling as themeable", () => {
    // "/super-admin/requests" is themeable but "/super-admin/billing" is not,
    // so a prefix match here would wrongly theme the whole super-admin area.
    expect(isThemeableRoute("/super-admin/billing")).toBe(false);
    expect(isThemeableRoute("/super-admin")).toBe(false);
    expect(isThemeableRoute("/jobsomething")).toBe(false);
  });

  it("ignores a trailing slash, which Next can produce depending on config", () => {
    expect(isThemeableRoute("/jobs/")).toBe(true);
    expect(isThemeableRoute("/")).toBe(true);
  });

  it("lists exactly the five pages known to be tokenised today", () => {
    expect([...THEMEABLE_ROUTES].sort()).toEqual(
      ["/", "/dashboard", "/jobs", "/login", "/super-admin/requests"].sort(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/nav/themeableRoutes.test.ts`
Expected: FAIL, `Failed to resolve import "./themeableRoutes"`.

- [ ] **Step 3: Write the implementation**

Create `lib/nav/themeableRoutes.ts`:

```ts
/* THE ACTIVATION SWITCH.
   
   A route on this list follows the light/dark theme and shows the theme toggle.
   A route not on it is pinned dark by ThemeScope, because the ~14 legacy pages
   are styled with hardcoded inline colour literals that cannot respond to a
   theme class. Letting them follow the theme would put their dark-tuned text on
   a light background: /tracking would render white-on-white.

   TO ACTIVATE A LEGACY PAGE: convert its inline colour literals to tokens, give
   its root element `className="ds ... bg-canvas text-ink"` the way the five
   pages below do, then add its path here. That is the whole procedure.

   This is an allowlist, not a denylist, so a brand new page defaults to
   pinned-dark and legacy-safe rather than half-themed.

   When every route is listed, this file and app/components/ThemeScope.tsx can
   both be deleted in one commit. */
export const THEMEABLE_ROUTES: readonly string[] = [
  "/",                       // app/page.tsx:50          (pinned light, see spec)
  "/login",                  // app/login/page.tsx:62
  "/dashboard",              // app/dashboard/page.tsx:179
  "/jobs",                   // app/jobs/page.tsx:249
  "/super-admin/requests",   // app/super-admin/requests/page.tsx:79
];

export function isThemeableRoute(pathname: string): boolean {
  // Exact match, not prefix: "/super-admin/requests" is tokenised but its
  // siblings under /super-admin are not, so a prefix match would wrongly theme
  // the whole area.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return THEMEABLE_ROUTES.includes(normalized);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/nav/themeableRoutes.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/nav/themeableRoutes.ts lib/nav/themeableRoutes.test.ts
git commit -m "feat: add themeable-route allowlist, the legacy-page activation switch"
```

---

## Task 3: CSS token parser

The contrast test needs to read the real `app/tokens.css` rather than a copy of its values. This is that reader.

**Files:**
- Create: `lib/theme/parseTokens.ts`
- Test: `lib/theme/parseTokens.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/theme/parseTokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTokenBlocks } from "./parseTokens";

const SAMPLE = `
/* a comment mentioning --canvas: #BADBAD; which must be ignored */
:root {
  --canvas: #0F1626;
  --surface: #161F31;   --surface-2: #131B2B;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.45), 0 2px 8px -2px rgba(0,0,0,.55);
}
.light {
  --canvas: #F2F4F8;
  --surface: #FFFFFF;   --surface-2: #EDF0F5;
  --shadow-sm: 0 1px 2px rgba(11,18,32,.05);
}
:focus-visible { outline: 2px solid var(--focus); }
`;

describe("parseTokenBlocks", () => {
  it("extracts custom properties per selector", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":root"]["--canvas"]).toBe("#0F1626");
    expect(blocks[".light"]["--canvas"]).toBe("#F2F4F8");
  });

  it("handles several declarations on one line, which tokens.css uses throughout", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":root"]["--surface"]).toBe("#161F31");
    expect(blocks[":root"]["--surface-2"]).toBe("#131B2B");
  });

  it("keeps multi-part values such as shadows intact", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":root"]["--shadow-sm"]).toBe(
      "0 1px 2px rgba(0,0,0,.45), 0 2px 8px -2px rgba(0,0,0,.55)",
    );
  });

  it("ignores custom properties that appear inside comments", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":root"]["--canvas"]).not.toBe("#BADBAD");
  });

  it("ignores blocks that declare no custom properties", () => {
    const blocks = parseTokenBlocks(SAMPLE);
    expect(blocks[":focus-visible"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/theme/parseTokens.test.ts`
Expected: FAIL, `Failed to resolve import "./parseTokens"`.

- [ ] **Step 3: Write the implementation**

Create `lib/theme/parseTokens.ts`:

```ts
/* A deliberately small CSS reader used only by contrast.test.ts, so the
   contrast assertions run against the real app/tokens.css instead of a
   second copy of the hex values that could drift out of sync.

   Not a general CSS parser. It assumes tokens.css's actual shape: flat,
   non-nested selector blocks containing custom properties. */

export type TokenBlocks = Record<string, Record<string, string>>;

export function parseTokenBlocks(css: string): TokenBlocks {
  // Strip comments first: tokens.css discusses token names in prose, and those
  // mentions must not be read as declarations.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  const blocks: TokenBlocks = {};
  const blockPattern = /([^{}]+)\{([^{}]*)\}/g;

  let block: RegExpExecArray | null;
  while ((block = blockPattern.exec(withoutComments)) !== null) {
    const selector = block[1].trim();
    const body = block[2];
    const tokens: Record<string, string> = {};

    const declPattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let decl: RegExpExecArray | null;
    while ((decl = declPattern.exec(body)) !== null) {
      tokens[decl[1]] = decl[2].trim();
    }

    if (Object.keys(tokens).length > 0) blocks[selector] = tokens;
  }

  return blocks;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/theme/parseTokens.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/theme/parseTokens.ts lib/theme/parseTokens.test.ts
git commit -m "test: add a token-block parser so contrast checks read the real tokens.css"
```

---

## Task 4: WCAG contrast maths

**Files:**
- Create: `lib/theme/contrast.ts`
- Test: covered by Task 5's `contrast.test.ts`, plus the self-checks below

- [ ] **Step 1: Write the failing test**

Create `lib/theme/contrast.test.ts` with only the maths self-checks for now. Task 5 appends the real assertions to this same file.

```ts
import { describe, it, expect } from "vitest";
import { contrastRatio } from "./contrast";

describe("contrastRatio", () => {
  it("returns 21:1 for black on white, the WCAG maximum", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
  });

  it("returns 1:1 for a colour against itself", () => {
    expect(contrastRatio("#2953E3", "#2953E3")).toBeCloseTo(1, 5);
  });

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/theme/contrast.test.ts`
Expected: FAIL, `Failed to resolve import "./contrast"`.

- [ ] **Step 3: Write the implementation**

Create `lib/theme/contrast.ts`:

```ts
/* WCAG 2.1 relative luminance and contrast ratio.
   Formulae: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
             https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */

function expand(hex: string): string {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 3) return h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return h;
}

export function relativeLuminance(hex: string): number {
  const h = expand(hex);
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/theme/contrast.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/theme/contrast.ts lib/theme/contrast.test.ts
git commit -m "feat: add WCAG contrast-ratio maths"
```

---

## Task 5: The contrast test that drives the token rewrite

This test is written **before** `app/tokens.css` is rewritten, and it must fail. Task 6 rewrites the tokens to make it pass. Do not skip Step 2: seeing it fail is what proves the test is actually reading the file.

**Files:**
- Modify: `lib/theme/contrast.test.ts` (append to the file from Task 4)

- [ ] **Step 1: Write the failing test**

Append to `lib/theme/contrast.test.ts`, moving the three new `import` lines up to sit with the
existing imports at the top of the file (import declarations belong at the top of a module,
even though they are hoisted):

```ts
// --- add to the existing import block at the top of the file ---
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseTokenBlocks } from "./parseTokens";

// --- the rest appends below the existing contrastRatio describe block ---
const css = readFileSync(resolve(process.cwd(), "app/tokens.css"), "utf8");
const blocks = parseTokenBlocks(css);

/* Both themes must declare EVERY token. The previous .dark scaffold overrode
   only 27 of them and silently inherited light values for the rest, which is
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
] as const)("%s contrast: %s", (selector) => {
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
   moving the pair into `pairs` above is a welcome future change. */
const KNOWN_GAPS = [
  { selector: ".light", fg: "--ink-3",       bg: "--surface", floor: 4.15, note: "needs 4.5 as body text" },
  { selector: ".light", fg: "--ink-4",       bg: "--surface", floor: 2.63, note: "needs 4.5; unused by any component" },
  { selector: ".light", fg: "--line-strong", bg: "--surface", floor: 1.84, note: "needs 3 as a UI component boundary" },
  { selector: ":root",  fg: "--ink-4",       bg: "--surface", floor: 3.11, note: "needs 4.5; unused by any component" },
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/theme/contrast.test.ts`
Expected: FAIL. `app/tokens.css` currently has no `.light` block and no `--on-primary`, so the structure tests fail and the `.light` pairs report undefined tokens. This failure is the point of the task.

- [ ] **Step 3: No implementation in this task**

Task 6 rewrites `app/tokens.css` to make this pass. Leave the test failing and commit it as such, so the next task has a red test to drive it.

- [ ] **Step 4: Commit the failing test**

```bash
git add lib/theme/contrast.test.ts
git commit -m "test: assert contrast for every token pair in both themes (red)"
```

---

## Task 6: Rewrite the tokens, inverted

Makes Task 5's test go green.

**Files:**
- Modify: `app/tokens.css` (whole file)

- [ ] **Step 1: Replace the entire contents of `app/tokens.css`**

```css
/* TMS Wizzard design tokens, imported once from app/globals.css.

   ============================================================================
   READ THIS BEFORE EDITING: THE DEFAULT IS INVERTED ON PURPOSE.
   ============================================================================

   `:root` holds the DARK theme. `.light` is the OPT-OUT. This is the reverse of
   the usual convention, where `:root` is light and `.dark` is the opt-in.

   Why: this console is used in dim control rooms, so dark is the product
   default (see docs/superpowers/specs/2026-08-13-dark-default-theme-design.md).
   Putting dark in `:root` means server-rendered HTML, a failed theme script, a
   slow hydration and a JS-disabled browser ALL render dark. A flash of white
   becomes structurally impossible on the default path rather than merely
   unlikely. If light lived in `:root`, every load would paint light first.

   `.dark` duplicates `:root` exactly. That looks redundant and is not: it lets
   a SUBTREE pin itself dark against an ancestor `.light`. That is how the ~14
   legacy inline-styled pages stay dark while a user is in light mode. See
   app/components/ThemeScope.tsx and lib/nav/themeableRoutes.ts.

   DO NOT USE TAILWIND `dark:` VARIANTS. Under an inverted default they mean the
   opposite of what you would expect: `dark:bg-surface` applies when a `.dark`
   class is present, which here means "a legacy pinned subtree", not "the user
   is in dark mode" (they are, by default, with no class at all). There are no
   `dark:` variants in the codebase today. Theme differences belong in the token
   values below, where every consumer picks them up for free.

   BOTH BLOCKS MUST DECLARE EVERY TOKEN. The previous dark scaffold overrode
   only 27 of them and inherited light values for the rest, which is how the
   focus ring ended up at 2.85:1 on a dark surface, below the 3:1 minimum.
   lib/theme/contrast.test.ts asserts full parity and every contrast pair, and
   reads THIS FILE, so it fails the build if a value here regresses. */

:root {
  /* surfaces */
  --canvas: #0F1626;
  --surface: #161F31;
  --surface-2: #131B2B;
  --line: #26324A;
  --line-strong: #586B90;
  /* chrome — the sidebar surface */
  --chrome: #0C1220;
  --chrome-raised: #1A2438;
  --chrome-border: #26324A;
  --chrome-text: #9AA7BD;
  --chrome-text-strong: #E8EEF9;
  /* text — capped at a dimmed #D6DEEC rather than near-white. Pure white on a
     near-black surface causes halation (glyphs appear to bleed), which is worst
     in exactly the dim rooms this theme is for. */
  --ink: #D6DEEC;
  --ink-2: #9AA7BD;
  --ink-3: #7787A0;
  --ink-4: #5E6C85;
  /* brand */
  --primary: #7FA0F7;
  --primary-hover: #9AB4F9;
  --primary-active: #6489EF;
  --primary-tint: #1C2C55;
  --primary-tint-border: #4E6AB4;
  --primary-deep: #A9C0FB;
  /* Text/icon colour for a solid --primary fill. Exists because Button.tsx used
     to hardcode text-white, which measures 2.97:1 on the dark primary: an AA
     failure on the most-clicked control in the app. */
  --on-primary: #0F1626;
  /* accent */
  --accent: #EFB458;
  --accent-text: #EFB458;
  --accent-tint: #33280F;
  --accent-border: #A07E26;
  /* semantic status */
  --success: #6FD79B;        --success-strong: #6FD79B;
  --success-tint: #14301F;   --success-border: #357A4F;
  --warning: #EFB458;        --warning-strong: #EFB458;
  --warning-tint: #33280F;   --warning-border: #8A6C1F;
  --danger: #F08A8A;         --danger-hover: #F5A5A5;   --danger-strong: #F08A8A;
  --danger-tint: #3A1C1C;    --danger-border: #B04C4C;
  /* Text/icon colour for a solid --danger fill, same reason as --on-primary. */
  --on-danger: #2A0F0F;
  --focus: #7FA0F7;
  /* elevation — black-based, NOT navy. The light theme's rgba(11,18,32,...)
     shadows are invisible on a dark canvas. In dark, elevation reads from the
     border first and the shadow second. */
  --shadow-xs: 0 1px 2px rgba(0,0,0,.45);
  --shadow-sm: 0 1px 2px rgba(0,0,0,.45), 0 2px 8px -2px rgba(0,0,0,.55);
  --shadow-md: 0 4px 16px -4px rgba(0,0,0,.60), 0 2px 4px -2px rgba(0,0,0,.50);
  --shadow-lg: 0 16px 40px -8px rgba(0,0,0,.70);
}

/* Identical to :root. Lets a subtree pin itself dark against an ancestor
   .light — see the header comment. Keep these values in sync with :root;
   lib/theme/contrast.test.ts asserts they are equal. */
.dark {
  --canvas: #0F1626;
  --surface: #161F31;
  --surface-2: #131B2B;
  --line: #26324A;
  --line-strong: #586B90;
  --chrome: #0C1220;
  --chrome-raised: #1A2438;
  --chrome-border: #26324A;
  --chrome-text: #9AA7BD;
  --chrome-text-strong: #E8EEF9;
  --ink: #D6DEEC;
  --ink-2: #9AA7BD;
  --ink-3: #7787A0;
  --ink-4: #5E6C85;
  --primary: #7FA0F7;
  --primary-hover: #9AB4F9;
  --primary-active: #6489EF;
  --primary-tint: #1C2C55;
  --primary-tint-border: #4E6AB4;
  --primary-deep: #A9C0FB;
  --on-primary: #0F1626;
  --accent: #EFB458;
  --accent-text: #EFB458;
  --accent-tint: #33280F;
  --accent-border: #A07E26;
  --success: #6FD79B;        --success-strong: #6FD79B;
  --success-tint: #14301F;   --success-border: #357A4F;
  --warning: #EFB458;        --warning-strong: #EFB458;
  --warning-tint: #33280F;   --warning-border: #8A6C1F;
  --danger: #F08A8A;         --danger-hover: #F5A5A5;   --danger-strong: #F08A8A;
  --danger-tint: #3A1C1C;    --danger-border: #B04C4C;
  --on-danger: #2A0F0F;
  --focus: #7FA0F7;
  --shadow-xs: 0 1px 2px rgba(0,0,0,.45);
  --shadow-sm: 0 1px 2px rgba(0,0,0,.45), 0 2px 8px -2px rgba(0,0,0,.55);
  --shadow-md: 0 4px 16px -4px rgba(0,0,0,.60), 0 2px 4px -2px rgba(0,0,0,.50);
  --shadow-lg: 0 16px 40px -8px rgba(0,0,0,.70);
}

/* The light opt-out. Applied to <html> by the inline script in app/layout.tsx
   when localStorage["tms-theme"] === "light", and to the landing page's root
   element permanently (app/page.tsx), since the public marketing page stays
   light regardless of the console's setting.

   Values are the palette that shipped 2026-08-11, unchanged apart from the two
   new --on-* tokens. Three known contrast gaps here are pre-existing and are
   documented in lib/theme/contrast.test.ts rather than fixed. */
.light {
  --canvas: #F2F4F8;
  --surface: #FFFFFF;
  --surface-2: #EDF0F5;
  --line: #E4E7EE;
  --line-strong: #B9BFCC;
  --chrome: #0B1220;
  --chrome-raised: #1A2438;
  --chrome-border: #242F47;
  --chrome-text: #C9CFDD;
  --chrome-text-strong: #FFFFFF;
  --ink: #0B1220;
  --ink-2: #5B6474;
  --ink-3: #737D8F;
  --ink-4: #98A0B0;
  --primary: #2953E3;
  --primary-hover: #1E41BD;
  --primary-active: #1A3595;
  --primary-tint: #F0F4FE;
  --primary-tint-border: #C3D1F8;
  --primary-deep: #1E41BD;
  --on-primary: #FFFFFF;
  --accent: #D97706;
  --accent-text: #B45309;
  --accent-tint: #FFFBEB;
  --accent-border: #FDE68A;
  --success: #0F8547;        --success-strong: #0C6B3A;
  --success-tint: #DCF3E5;   --success-border: #B7E4C7;
  --warning: #B25E09;        --warning-strong: #8F4B06;
  --warning-tint: #FCEFDC;   --warning-border: #F5D9AE;
  --danger: #D23E3E;         --danger-hover: #AB2F2F;   --danger-strong: #AB2F2F;
  --danger-tint: #FBE5E5;    --danger-border: #F3C2C2;
  --on-danger: #FFFFFF;
  --focus: #2953E3;
  --shadow-xs: 0 1px 2px rgba(11,18,32,.05);
  --shadow-sm: 0 1px 2px rgba(11,18,32,.05), 0 2px 8px -2px rgba(11,18,32,.08);
  --shadow-md: 0 4px 16px -4px rgba(11,18,32,.12), 0 2px 4px -2px rgba(11,18,32,.06);
  --shadow-lg: 0 16px 40px -8px rgba(11,18,32,.22);
}

/* Deliberately GLOBAL, not scoped to .ds, so every focusable element on the
   legacy pages gets a visible ring too. Never remove an outline without a
   replacement. --focus is now themed in both blocks above, which fixes the
   2.85:1 ring the old dark scaffold left unthemed. */
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
```

- [ ] **Step 2: Run the contrast test to verify it now passes**

Run: `npx vitest run lib/theme/contrast.test.ts`
Expected: PASS. All structure tests, both themes' pair tables, and the four known-gap floors.

- [ ] **Step 3: Run the whole suite and the typechecker**

Run: `npm test && npm run typecheck`
Expected: all tests pass; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add app/tokens.css
git commit -m "feat: invert the theme default, dark in :root and light as the opt-out"
```

---

## Task 7: Expose the two new tokens to Tailwind

Without this, `text-on-primary` compiles to nothing and Task 8's button fix silently does nothing.

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Add the colour keys**

In `tailwind.config.ts`, inside `theme.extend.colors`, add these two entries immediately after the `primary` block's closing brace:

```ts
        "on-primary": "var(--on-primary)",
        "on-danger": "var(--on-danger)",
```

- [ ] **Step 2: Verify the classes compile**

Run: `npm run build`
Expected: build succeeds.

Then confirm the utility actually exists in the output rather than being silently dropped:

```bash
grep -rl "on-primary" .next/static/css/ | head -1
```

Expected: at least one CSS file listed. An empty result means the class was tree-shaken because nothing uses it yet, which is expected at this point; it will be re-checked at the end of Task 8.

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat: expose --on-primary and --on-danger as Tailwind colour keys"
```

---

## Task 8: Fix the solid-fill text colours

`text-white` on a themed fill is the 2.97:1 AA failure. Six call sites across two files.

**Files:**
- Modify: `components/Button.tsx:17,20`
- Modify: `app/components/AppShell.tsx:66,82,100`

- [ ] **Step 1: Fix `components/Button.tsx`**

Replace the `variants` object (lines 16-21) with:

```ts
const variants: Record<Variant, string> = {
  // text-on-primary / text-on-danger, not text-white: under the dark default
  // --primary is a light blue and white on it measures 2.97:1, an AA failure on
  // the most-clicked control in the app. The token is #FFFFFF in light and dark
  // ink in dark, so both themes are correct with no per-theme class.
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink hover:bg-surface-2",
  danger: "bg-danger text-on-danger hover:bg-danger-hover",
};
```

- [ ] **Step 2: Fix `app/components/AppShell.tsx`**

Line 66, the active nav item:

```tsx
                      ? "bg-primary text-on-primary"
```

Line 82, the user-initials avatar:

```tsx
          className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-primary text-xs font-semibold text-on-primary"
```

Line 100, the sign-out button's danger hover state:

```tsx
          className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-chrome-border bg-chrome-raised text-chrome-text shadow-xs transition-colors hover:border-danger hover:bg-danger hover:text-on-danger"
```

Leave line 91 (`hover:text-white` on the Super Admin link) alone: it sits on `--chrome`, which is dark in both themes, so white is correct there.

- [ ] **Step 3: Verify no themed fill still pairs with `text-white`**

```bash
grep -rn "text-white" app components --include=*.tsx
```

Expected: exactly one result, `app/components/AppShell.tsx:91`, the Super Admin link on dark chrome.

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add components/Button.tsx app/components/AppShell.tsx
git commit -m "fix: use on-primary/on-danger for solid fills, replacing a 2.97:1 text-white"
```

---

## Task 9: The blocking theme script

**Files:**
- Create: `lib/theme/themeScript.ts`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Write the script constant**

Create `lib/theme/themeScript.ts`:

```ts
import { STORAGE_KEY } from "./theme";

/* Runs synchronously as the first child of <body>, BEFORE any page content is
   parsed or painted, so a user who has chosen light never sees a dark frame
   first (and vice versa).

   It must stay synchronous and inline. Moving this into a React effect, a
   `<Script>` component with any strategy, or an external file puts it after
   first paint and the flash comes back.

   Only the light case does anything: dark is the value already in :root, so the
   default path needs no JavaScript at all.

   Wrapped in try/catch because localStorage throws in some privacy modes; on
   failure the page simply stays dark, which is the safe outcome here. */
export const THEME_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)})==="light"){document.documentElement.classList.add("light")}}catch(e){}})()`;
```

- [ ] **Step 2: Mount it in the layout**

In `app/layout.tsx`, add the import at the top with the others:

```tsx
import { THEME_SCRIPT } from "../lib/theme/themeScript";
```

Then make the script the first child of `<body>`, before `<TenantProvider>`:

```tsx
      <body
        style={{
          margin: 0,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: "#0F1626",
          color: "#0F1626",
        }}
      >
        {/* MUST stay the first child and MUST stay synchronous. See
            lib/theme/themeScript.ts for why. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <TenantProvider>
```

Note the `background` also changes here, from `#0f172a` to `#0F1626`. It stays a hardcoded literal rather than `var(--canvas)` deliberately: this paints behind the legacy pages, which must not follow the light toggle.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 4: Verify the script is in the served HTML**

Run: `npm run dev` in one shell, then:

```bash
curl -s http://localhost:3000/login | grep -c "tms-theme"
```

Expected: `1`. Stop the dev server afterwards.

- [ ] **Step 5: Commit**

```bash
git add lib/theme/themeScript.ts app/layout.tsx
git commit -m "feat: add the pre-paint theme script and retint the legacy body canvas"
```

---

## Task 10: Pin legacy routes dark

**Files:**
- Create: `app/components/ThemeScope.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Write the component**

Create `app/components/ThemeScope.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isThemeableRoute } from "../../lib/nav/themeableRoutes";

/* Pins every non-themeable route dark by putting `.dark` on the content
   wrapper, which re-declares the dark token values for that subtree and so
   overrides an ancestor `.light` on <html>.

   Needed because the ~14 legacy pages are styled with hardcoded inline colour
   literals. They cannot follow a theme, so if the tokens around them went light
   their dark-tuned content would break: /tracking puts white cards and white
   headings on the page background and would render white-on-white.

   Deleting this component is the final step of the design-system rollout, once
   every route is in THEMEABLE_ROUTES. */
export default function ThemeScope({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pinned = !isThemeableRoute(pathname);

  return (
    <div className={pinned ? "dark" : undefined} style={{ flex: 1, minWidth: 0 }}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Use it in the layout**

In `app/layout.tsx`, add the import:

```tsx
import ThemeScope from "./components/ThemeScope";
```

Replace the existing content wrapper:

```tsx
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <AppShell />
            <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
          </div>
```

with:

```tsx
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <AppShell />
            <ThemeScope>{children}</ThemeScope>
          </div>
```

`ThemeScope` carries the same `flex: 1; minWidth: 0` styles the plain div had, so the layout is unchanged.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add app/components/ThemeScope.tsx app/layout.tsx
git commit -m "feat: pin legacy routes dark so they never follow the light toggle"
```

---

## Task 11: The toggle

**Files:**
- Create: `app/components/ThemeToggle.tsx`
- Modify: `app/components/AppShell.tsx`

- [ ] **Step 1: Write the component**

Create `app/components/ThemeToggle.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { normalizeTheme, STORAGE_KEY, type Theme } from "../../lib/theme/theme";

/* Per-device, not per-user, and deliberately so: a control-room machine is
   shared across shifts, and the right theme is a property of the room's
   lighting rather than of whoever is signed in. It is also the only store
   readable before first paint (see lib/theme/themeScript.ts); a value in the
   Supabase profile would need a round trip and would flash on every load. */
export default function ThemeToggle() {
  // Always "dark" on the server and on first client render, matching what
  // :root produces, so hydration cannot mismatch. The effect then corrects the
  // icon for a user who has chosen light. Only the icon settles a frame late;
  // the THEME itself was already correct before paint, via the inline script.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    // Read the same store the inline script read, through the same normalizer,
    // so there is one canonical interpretation of what is in storage.
    try {
      setTheme(normalizeTheme(localStorage.getItem(STORAGE_KEY)));
    } catch {
      setTheme("dark");
    }
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("light", next === "light");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode can refuse writes. The theme still changes for this
      // session; it just will not be remembered. Not worth surfacing.
    }
    setTheme(next);
  }

  const goingTo = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${goingTo} theme`}
      title={`Switch to ${goingTo} theme`}
      className="flex h-8 w-8 flex-none items-center justify-center rounded-md border border-chrome-border bg-chrome-raised text-chrome-text shadow-xs transition-colors hover:border-line-strong hover:text-chrome-text-strong"
    >
      {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  );
}
```

- [ ] **Step 2: Mount it in `AppShell`, guarded by the allowlist**

In `app/components/AppShell.tsx`, add two imports:

```tsx
import ThemeToggle from "./ThemeToggle";
import { isThemeableRoute } from "../../lib/nav/themeableRoutes";
```

Then in the footer row (the `<div>` starting at line 79), add the toggle immediately before the sign-out `<button>`:

```tsx
        {/* Hidden on legacy routes. AppShell renders everywhere, so an
            unguarded toggle on /pod would turn the sidebar light while the
            pinned page body stayed dark: visibly broken, not just
            inconsistent. See lib/nav/themeableRoutes.ts. */}
        {isThemeableRoute(pathname) ? <ThemeToggle /> : null}
```

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 4: Verify by hand**

Run `npm run dev`, sign in, and check:

1. `/dashboard` shows the toggle. Clicking it switches the page to light and the icon to a moon.
2. Reload `/dashboard`. It stays light, with no dark flash first.
3. Navigate to `/pod`. The toggle is gone and the page is dark, with readable content.
4. Navigate back to `/dashboard`. It is light again.
5. Click the toggle back to dark before moving on.

- [ ] **Step 5: Commit**

```bash
git add app/components/ThemeToggle.tsx app/components/AppShell.tsx
git commit -m "feat: add the per-device theme toggle, shown only on themeable routes"
```

---

## Task 12: Pin the landing page light

**Files:**
- Modify: `app/page.tsx:50`

- [ ] **Step 1: Add the pin**

Change line 50 from:

```tsx
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
```

to:

```tsx
    /* `light` pins the public marketing page to the light palette regardless of
       the console's theme. It is a sales asset viewed by prospects on normal
       monitors in daylight, and its light design shipped in July. Because the
       light values are a class rather than a media query, this needs no
       JavaScript and no separate mechanism. /login is deliberately NOT pinned:
       it is the first console screen an operator sees in a dim room. */
    <div className="ds light min-h-screen bg-canvas font-sans text-ink">
```

- [ ] **Step 2: Verify by hand**

Run `npm run dev`, set the console to dark, then visit `/`.
Expected: the landing page renders light. Visit `/login`: it renders dark.

- [ ] **Step 3: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat: pin the public landing page to the light palette"
```

---

## Task 13: Retint the tenant gate

**Files:**
- Modify: `app/components/TenantGate.tsx:7-10`

- [ ] **Step 1: Retint the panel**

Replace the `panelStyle` constant with:

```tsx
/* Hardcoded rather than tokenised, deliberately. This panel renders on every
   route including the legacy ones, before tenant status resolves, so it must
   not follow the light toggle: a bright full-screen flash on every load is the
   exact thing the dark default exists to prevent. Values track :root's --canvas
   and --ink in app/tokens.css; update together. */
const panelStyle: React.CSSProperties = {
  minHeight: "100vh", display: "grid", placeItems: "center",
  background: "#0F1626", color: "#D6DEEC", padding: 30, textAlign: "center",
};
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add app/components/TenantGate.tsx
git commit -m "fix: retint the tenant gate panel onto the control-room palette"
```

---

## Task 14: Document the inverted default for contributors

The `tokens.css` header comment landed in Task 6. This task covers the README.

**Files:**
- Modify: `README.md:44-53`

- [ ] **Step 1: Replace the Design system section**

Replace lines 44 to 53 (from `## Design system` through the "planned direction" line) with:

```markdown
## Design system

The UI deliberately runs **two styling systems side by side**, and understanding the seam matters before editing any page.

- **Legacy pages (most of the app):** plain inline styles on a dark canvas with Inter. A recurring pattern is a full-bleed truck photograph background with a dark translucent overlay panel and white rounded cards. Tailwind Preflight is disabled globally so these pages are not disturbed.
- **Design-system ("ds") pages:** newer pages opt in by putting `className="ds font-sans bg-canvas text-ink"` on their root element. The `ds` class re-applies a scoped CSS reset (borders, box-sizing, control fonts) via `:where()` rules, and `font-sans` switches to IBM Plex. Semantic tokens (`bg-canvas`, `text-ink`, `border-line`, `bg-surface`, `text-primary`, tone classes) are defined in `app/tokens.css` and consumed by `app/globals.css`.
- **The failure modes are intentional and asymmetric:** omit `font-sans` and a ds page silently falls back to Inter; omit `ds` and borders vanish and layouts overflow (because Preflight is off). This is documented inline in `app/layout.tsx` and `app/globals.css`.
- **ds pages today:** the landing page, `/login`, `/dashboard`, `/jobs` and `/super-admin/requests`. Everything else is inline-styled.

### Theming: the default is inverted on purpose

The app is used in dim control rooms, so **dark is the default theme** and light is opt-in.

- `:root` in `app/tokens.css` holds the **dark** values. `.light` is the **opt-out**. This is the reverse of the usual convention, and it is deliberate: it means server-rendered HTML, a failed script, a slow hydration and a JS-disabled browser all render dark, so a flash of white is structurally impossible on the default path.
- `.dark` duplicates `:root` exactly. That is not redundant: it lets a subtree pin itself dark against an ancestor `.light`, which is how the legacy pages stay dark while a user is in light mode.
- **Do not use Tailwind `dark:` variants.** Under an inverted default they mean the opposite of what you would expect. Theme differences belong in the token values.
- The preference is stored per **device** in `localStorage["tms-theme"]`, not per user: a shared control-room machine should stay dark whoever signs in. A synchronous script at the top of `<body>` applies it before first paint.
- **Which pages follow the theme** is controlled by one allowlist, `lib/nav/themeableRoutes.ts`. It drives both the toggle's visibility and the legacy dark pin. To move a legacy page onto the theme: convert its inline colour literals to tokens, give it a `ds ... bg-canvas` root, then add its path to that list.
- Every token pair in both themes is contrast-checked by `lib/theme/contrast.test.ts`, which parses `app/tokens.css` itself and runs on every `npm test`. Four documented pre-existing gaps are listed there as floors that must not regress.

See `docs/superpowers/specs/2026-08-13-dark-default-theme-design.md` for the full rationale.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document the inverted theme default and the activation switch"
```

---

## Task 15: Full verification pass

No code changes. This is the gate before the branch is considered done.

- [ ] **Step 1: Automated checks**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean, all tests pass, build succeeds.

- [ ] **Step 2: Confirm the utilities actually compiled**

```bash
grep -rc "on-primary" .next/static/css/*.css | grep -v ":0"
```

Expected: at least one file with a non-zero count. An empty result means `text-on-primary` was tree-shaken and the buttons have no text colour at all, which is the silent failure mode this check exists to catch.

- [ ] **Step 3: No-JavaScript check**

Run `npm run dev`. In the browser devtools, disable JavaScript, then hard-reload `/login`.
Expected: renders dark. This is the core promise of the inverted default.

Re-enable JavaScript afterwards.

- [ ] **Step 4: Flash check**

With the console set to light, hard-reload `/dashboard` several times while watching closely.
Expected: no dark frame before the light paint.

Then set it to dark and hard-reload again.
Expected: no light frame at any point.

- [ ] **Step 5: Boundary checks**

1. Set light on `/dashboard`, then navigate to `/pod`. Expected: `/pod` is dark, readable, and shows no toggle.
2. From `/pod`, navigate back to `/dashboard`. Expected: light again.
3. With the console set to dark, visit `/`. Expected: the landing page is light.
4. Visit `/login`. Expected: dark.
5. Tab through `/jobs` and confirm the focus ring is clearly visible on every control. This is the token that was at 2.85:1 before.
6. On `/jobs`, confirm the primary buttons and the status badges are legible.
7. Re-check both Task 0 fixes in dark, since they were verified in light: the dashboard canvas still meets the sidebar, and the job-form fields still do not overlap with a long subcontractor name selected.

- [ ] **Step 6: Regression check on the untouched pages**

Visit `/tracking`, `/invoices`, `/customers` and `/stats`.
Expected: unchanged from before this branch, apart from the slightly different page background behind them and a now-visible focus ring.

- [ ] **Step 7: Security check**

Confirm the inline script reads and writes only `localStorage["tms-theme"]` and interpolates nothing from the page or the URL:

```bash
grep -n "THEME_SCRIPT" -A 5 lib/theme/themeScript.ts
```

Expected: the only dynamic part is `JSON.stringify(STORAGE_KEY)`, a compile-time constant. No user input reaches the script, so there is no injection surface.

Confirm no query, guard or schema changed on this branch:

```bash
git diff main --stat -- app lib components | grep -vE "tokens.css|themeScript|theme.ts|ThemeScope|ThemeToggle|themeableRoutes|contrast|parseTokens|Button.tsx|AppShell.tsx|TenantGate.tsx|layout.tsx|page.tsx"
```

Expected: no output.

- [ ] **Step 8: Final commit if anything was adjusted**

```bash
git status --short
```

If the verification pass required fixes, commit them. Otherwise the branch is ready for review.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| Dark default, no flash, works with no JavaScript | 6, 9, 15 |
| Light toggle, per-device in localStorage | 1, 11 |
| Palette B, all tokens in both themes | 6 |
| Every pair measured against AA | 4, 5, 6 |
| Known gaps documented, not silently absorbed | 5 |
| `--on-primary` / `--on-danger` fixing the 2.97:1 button | 6, 7, 8 |
| Focus ring themed, fixing 2.85:1 | 6, 15 |
| Badge tokens tuned (picked up automatically, no API change) | 6 |
| Black-based shadows | 6 |
| `.dark` pin for legacy routes | 6, 10 |
| Landing pinned light, `/login` dark | 12 |
| `TenantGate` retint | 13 |
| `THEMEABLE_ROUTES` activation switch | 2 |
| Toggle hidden on legacy routes | 11 |
| Contributor documentation in three places | 6 (tokens.css header, `dark:` prohibition), 14 (README) |
| No business logic, query, guard or RLS change | 15 |

**Not from the spec:** Task 0 fixes two layout bugs Ethan reported on 2026-08-13, after the
spec was approved. They predate this branch and came in with the 2026-08-11 rollout. They are
included here rather than split into their own plan because they are small, touch no file the
theme work depends on, and Task 15 cannot meaningfully verify colour on a broken layout. If
they turn out to be larger than they look, pull them into a separate branch rather than
letting them grow inside this one.
