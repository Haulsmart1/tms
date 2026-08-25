# Loading Skeletons (batch 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc "Loading..." strings on `/dashboard` and `/customers` with pixel-faithful skeletons, and stop `TenantGate` blanking the whole viewport on those two routes.

**Architecture:** A `Skeleton` primitive backed by a new `--skeleton` token renders inside the real components (a card takes a `loading` prop) so the skeleton cannot drift from what it mirrors. `TenantGate` and `shouldShowShell` consult a `SKELETON_READY_ROUTES` allowlist: a route on the list renders its own skeleton during tenant resolution instead of being blocked. The list starts empty and each route joins it in the same task that converts it, so the gate is never inverted on a page that cannot yet handle it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind (Preflight off, tokens as CSS variables), vitest (`lib/**` only), Playwright (`tests/`, separate npm project).

Spec: `docs/superpowers/specs/2026-08-24-loading-skeletons-design.md` (committed `a2d764f`).
Branch: `ethan/loading-skeletons`, already created.

---

## Status: COMPLETE, 2026-08-25

All ten tasks done on `ethan/loading-skeletons`, NOT yet pushed. `npm test` 341 passing with
nothing skipped, `npm run typecheck` clean, `npm run build` succeeds. `SKELETON_READY_ROUTES`
holds `/dashboard` and `/customers`, so `/pod` and `/tracking` are untouched and neither
Playwright layout spec can be affected.

Task 10 Step 5, the signed-in manual pass, was run by Ethan on 2026-08-25 and all six checks
passed: both pages cold-load with the shell immediate and no height shift on arrival, light
mode keeps the skeletons visible, reduced motion stops the pulse, `/jobs` still shows the old
full-screen panel, and signed-out still redirects to `/login` with no flash of the shell.

## Orientation for someone new to this codebase

Five things that are unusual here and will cost you time if you do not know them:

1. **The dark theme is the default.** `:root` in `app/tokens.css` holds the *dark* values; `.light` is the opt-out; `.dark` duplicates `:root` so a subtree can pin itself dark. **Never use Tailwind `dark:` variants**, they mean the opposite of what they look like. Put theme differences in token values.
2. **Tailwind Preflight is OFF** (`tailwind.config.ts:32`) so it cannot touch the legacy inline-styled pages. Design-system pages opt in with `className="ds font-sans bg-canvas text-ink"` on their root. Both pages in this plan are already design-system pages.
3. **vitest only runs `lib/**/*.test.ts`** (`vitest.config.ts`). Nothing under `app/` or `components/` is unit tested. That is why every piece of logic in this plan lives in `lib/`, and why components are verified by `npm run typecheck` plus a manual pass.
4. **`cn()` composes, it does not override.** Passing `className="h-4"` to a component whose base is `h-3` silently keeps `h-3`. See `lib/cn.ts`. This is why `Skeleton` takes width and height as inline styles, not classes.
5. **`tests/` is a separate npm project** with its own `package.json` and `node_modules`. It is not part of `npm test`.

**Line numbers in this plan refer to each file as it stands at the start of its task, before any edit in that task.** Several tasks add imports or remove a block early on, which shifts everything below. Always locate the edit by the quoted content, which is exact, and treat the line number as a hint about where to look. Task 9 in particular removes 59 lines in its first step.

Commands you will need:

```bash
npm test                              # vitest run, all lib/**/*.test.ts
npx vitest run lib/nav/skeletonReadyRoutes.test.ts   # one file
npm run typecheck                     # next typegen && tsc --noEmit
```

---

## File Structure

**Create:**

| File | Responsibility |
| --- | --- |
| `components/Skeleton.tsx` | The only skeleton primitive. Renders one `aria-hidden` pulsing bar. |
| `lib/loading/skeletonVisibility.ts` | Pure decision: should a region show its skeleton right now. |
| `lib/loading/skeletonVisibility.test.ts` | Tests for the above, including the token-refresh regression. |
| `lib/nav/skeletonReadyRoutes.ts` | The per-route allowlist and `isSkeletonReadyRoute`. |
| `lib/nav/skeletonReadyRoutes.test.ts` | Tests for the above. |
| `app/customers/types.ts` | The `Customer` row shape, shared by the page and the card. |
| `app/customers/CustomerCard.tsx` | One customer card, real or skeleton, in one layout definition. |

**Modify:**

| File | Change |
| --- | --- |
| `app/tokens.css` | `--skeleton` in all three blocks. |
| `tailwind.config.ts:63` | `skeleton: "var(--skeleton)"` in the `colors` map. |
| `lib/theme/contrast.test.ts` | Three new `PAIRS` entries at a 1.25:1 floor. |
| `components/DataTable.tsx:86` | Use the primitive instead of `animate-pulse bg-surface-2`. |
| `components/Stat.tsx:21` | `value` widens from `string` to `ReactNode`. |
| `lib/nav/shouldShowShell.ts` | Honour the allowlist when status is `loading`. |
| `lib/nav/shouldShowShell.test.ts` | Cases for the new combination. |
| `app/components/TenantGate.tsx` | Pass through instead of blocking on allowlisted routes. |
| `app/dashboard/page.tsx` | Skeletons, `aria-busy`, tenant-status guard. |
| `app/customers/page.tsx` | Extract the card, skeletons, `aria-busy`, tenant-status guard. |

---

### Task 0: Baseline

Establish that everything passes *before* you change anything. If a Playwright spec is already red, you need to know that now rather than blaming your own work in Task 10.

**Files:** none (read-only)

- [x] **Step 1: Confirm the branch**

```bash
git branch --show-current
```

Expected: `ethan/loading-skeletons`. If not, run `git checkout ethan/loading-skeletons`.

- [x] **Step 2: Run the unit tests**

```bash
npm test
```

Expected: PASS, all files green.

- [x] **Step 3: Run the typechecker**

```bash
npm run typecheck
```

Expected: no output, exit 0.

If it reports `Cannot find module 'pdf-lib'` or `Cannot find module 'stripe'`, `node_modules` is an incomplete install rather than the code being broken: both are declared in `package.json`. Run `npm install` and try again. This was the state on 2026-08-24 and `npm install` cleared all six errors without touching `package-lock.json`. **`npm run typecheck` must be green before Task 1 starts**, because every later task uses it as the gate that catches the `Stat.value` and `Info.value` widenings.

- [x] **Step 4: Confirm the Playwright specs cannot be affected**

The two specs in `tests/` are **not** `@playwright/test` suites, so `npx playwright test` correctly finds nothing. They are standalone node scripts (`import { chromium } from "playwright"`) that need a running dev server and a signed-in magic link. Per the header of `tests/pod-layout.spec.mjs`, the real invocation is:

```bash
LINK=$(node scripts/dev-login.mjs <email> /pod | grep -o 'http://[^ ]*')
POD_AUTH_URL="$LINK" node tests/pod-layout.spec.mjs
```

**Do not run that here.** It needs the dev server up and it authenticates against the LIVE Supabase. It belongs to the signed-in pass in Task 10 Step 5.

Instead, confirm by inspection that Task 7 cannot affect them. Read `tests/pod-layout.spec.mjs:105-120` and `tests/tracking-layout.spec.mjs:132-148`. Both carry an `assertOnRealPage` guard whose whole job is to abort when `TenantGate`'s panel rendered instead of the real page. Record both of these:

1. Neither `/pod` nor `/tracking` joins `SKELETON_READY_ROUTES` in this batch, so `TenantGate` still blocks both exactly as it does today. Task 7 is inert for them.
2. `tracking-layout.spec.mjs:145` aborts when `document.body.innerText` contains `"Loading jobs"`. That string is `/tracking`'s current loading state, and a skeleton will replace it when `/tracking` is converted in a later batch, at which point this guard needs a new signal. Note it. Do not change it now.

---

### Task 1: The `--skeleton` token

Test first: the contrast test reads `app/tokens.css` from disk, so asserting on a token that does not exist yet gives a genuine red.

**Files:**
- Modify: `lib/theme/contrast.test.ts:109-134`
- Modify: `app/tokens.css`
- Modify: `tailwind.config.ts:63-65`

- [x] **Step 1: Write the failing test**

In `lib/theme/contrast.test.ts`, add this constant immediately after `const AA_NON_TEXT = 3;` (line 95):

```ts
/* Skeleton placeholders are decorative: every one carries aria-hidden, so they
   are not "visual information required to identify a component" and WCAG
   1.4.11's 3:1 does not apply. They must still be perceptible against every
   surface they can sit on.

   DO NOT raise this to AA_NON_TEXT. A bar at 3:1 reads as real content rather
   than a placeholder, which is the exact confusion a skeleton exists to avoid.
   The shipped values measure 1.30 to 1.54 across both themes. */
const SKELETON_VISIBLE = 1.25;
```

Then add these three entries at the end of the `PAIRS` array, after the `focus on chrome` line (line 133):

```ts
  { label: "skeleton on surface",         fg: "--skeleton",          bg: "--surface",       min: SKELETON_VISIBLE },
  { label: "skeleton on surface-2",       fg: "--skeleton",          bg: "--surface-2",     min: SKELETON_VISIBLE },
  { label: "skeleton on canvas",          fg: "--skeleton",          bg: "--canvas",        min: SKELETON_VISIBLE },
```

- [x] **Step 2: Run the test to verify it fails**

```bash
npx vitest run lib/theme/contrast.test.ts
```

Expected: FAIL. Several failures, including `--skeleton missing from :root` and the structural test `declares the same token names in every block` if you only added it to one block later. Right now you should see the `missing from` assertions.

- [x] **Step 3: Add the token to all three blocks**

`lib/theme/contrast.test.ts:81-89` asserts every block declares identical token *names*, and that `.dark` is value-identical to `:root`. So this goes in all three, and `.dark` must match `:root` exactly.

In `app/tokens.css`, in the `:root` block, immediately after `--line-strong: #586B90;` (line 41):

```css
  /* Fill for loading skeletons. Deliberately NOT --surface-2: in the dark theme
     --surface-2 (#131B2B) is darker than the --surface (#161F31) card it sits
     on and measures 1.05:1, i.e. invisible. See lib/theme/contrast.test.ts. */
  --skeleton: #2B3852;
```

In the `.dark` block, after its `--line-strong: #586B90;` (line 116), add the same value with no comment:

```css
  --skeleton: #2B3852;
```

In the `.light` block, after its `--line-strong: #B9BFCC;` (line 182):

```css
  --skeleton: #CDD4E1;
```

- [x] **Step 4: Run the test to verify it passes**

```bash
npx vitest run lib/theme/contrast.test.ts
```

Expected: PASS. The three new pairs measure 1.40 / 1.47 / 1.54 in `:root` and 1.49 / 1.30 / 1.35 in `.light`, all above 1.25.

- [x] **Step 5: Expose it to Tailwind**

Without this, `bg-skeleton` compiles to nothing, silently. In `tailwind.config.ts`, in the `colors` map, immediately after the `line:` entry (line 66):

```ts
        skeleton: "var(--skeleton)",
```

- [x] **Step 6: Run the full suite and typecheck**

```bash
npm test && npm run typecheck
```

Expected: both pass.

- [x] **Step 7: Commit**

```bash
git add app/tokens.css tailwind.config.ts lib/theme/contrast.test.ts
git commit -m "feat: add --skeleton token with a measured visibility floor"
```

---

### Task 2: The `Skeleton` primitive

No unit test: vitest does not cover `components/`. Verified by typecheck here and by eye in Task 8.

**Files:**
- Create: `components/Skeleton.tsx`

- [x] **Step 1: Write the component**

```tsx
import { cn } from "../lib/cn";

type Props = {
  /** Any CSS width. Inline, not a class, because cn() composes rather than overrides. */
  w?: string;
  /** Any CSS height. Inline, for the same reason. */
  h?: string;
  rounded?: "sm" | "full";
  /* "inline" preserves the parent's line box, so a skeleton standing in for
     text does not collapse the line height and shift the layout underneath it.
     "block" is right for a bar that owns its own row, such as a table cell. */
  display?: "block" | "inline";
  className?: string;
};

/* Every skeleton is aria-hidden. The announcement for a loading region is one
   visually hidden role="status" line on the region itself, not one per bar:
   a screen reader reading out forty grey rectangles is worse than silence. */
export default function Skeleton({
  w = "100%",
  h = "0.75rem",
  rounded = "sm",
  display = "block",
  className,
}: Props) {
  return (
    <span
      aria-hidden
      style={{ width: w, height: h }}
      className={cn(
        // ds-pulse, not Tailwind's animate-pulse: it is the only one of the two
        // with a prefers-reduced-motion guard (app/globals.css:76-80). It is
        // scoped as `.ds .ds-pulse`, so this is inert on legacy pages by
        // construction rather than by discipline.
        "ds-pulse bg-skeleton",
        display === "inline" ? "inline-block align-middle" : "block",
        rounded === "full" ? "rounded-full" : "rounded",
        className,
      )}
    />
  );
}
```

- [x] **Step 2: Verify it compiles**

```bash
npm run typecheck
```

Expected: no output, exit 0.

- [x] **Step 3: Commit**

```bash
git add components/Skeleton.tsx
git commit -m "feat: add Skeleton primitive"
```

---

### Task 3: Repair the existing DataTable skeleton

The app's one current skeleton is invisible in dark (1.05:1) and animates infinitely for users who set `prefers-reduced-motion`. Fixing it here means `/dashboard` inherits a correct table skeleton in Task 8 for free.

**Files:**
- Modify: `components/DataTable.tsx:1-2, 86`

- [x] **Step 1: Add the import**

At the top of `components/DataTable.tsx`, after the `cn` import on line 2:

```tsx
import Skeleton from "./Skeleton";
```

- [x] **Step 2: Replace the bar**

Replace line 86 exactly:

```tsx
                      <span className="block h-3 w-3/4 animate-pulse rounded bg-surface-2" />
```

with:

```tsx
                      <Skeleton w="75%" h="0.75rem" />
```

- [x] **Step 3: Verify**

```bash
npm test && npm run typecheck
```

Expected: both pass. No test asserts on this markup, so this is a compile check.

- [x] **Step 4: Commit**

```bash
git add components/DataTable.tsx
git commit -m "fix: make DataTable skeleton visible and respect reduced motion"
```

---

### Task 4: `shouldShowSkeleton`

This is the token-refresh guard. `TenantProvider.resolve()` resets status to `loading` on every `SIGNED_IN` / `SIGNED_OUT` / `USER_UPDATED` event (`app/components/TenantProvider.tsx:38, 66-70`). Today the gate hides that. Once the gate passes through, a routine token refresh would replace a populated page with a skeleton unless this function says no.

**Files:**
- Create: `lib/loading/skeletonVisibility.ts`
- Create: `lib/loading/skeletonVisibility.test.ts`

- [x] **Step 1: Write the failing test**

Create `lib/loading/skeletonVisibility.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldShowSkeleton } from "./skeletonVisibility";

describe("shouldShowSkeleton", () => {
  it("shows while tenant context is still resolving on a first load", () => {
    expect(shouldShowSkeleton({ tenantStatus: "loading", fetching: false, hasData: false })).toBe(true);
  });

  it("shows while the page's own query is in flight", () => {
    expect(shouldShowSkeleton({ tenantStatus: "ready", fetching: true, hasData: false })).toBe(true);
  });

  it("hides once the data is on screen", () => {
    expect(shouldShowSkeleton({ tenantStatus: "ready", fetching: false, hasData: true })).toBe(false);
  });

  /* THE REGRESSION THIS FUNCTION EXISTS FOR. TenantProvider.resolve() resets
     status to "loading" on every auth event, including a routine token
     refresh. Without the hasData short circuit, a populated page would flash
     back to a skeleton for no reason the user can perceive. */
  it("does not flash a skeleton over content already on screen when tenant status re-enters loading", () => {
    expect(shouldShowSkeleton({ tenantStatus: "loading", fetching: false, hasData: true })).toBe(false);
  });

  it("does not flash over existing content while a background refetch runs", () => {
    expect(shouldShowSkeleton({ tenantStatus: "ready", fetching: true, hasData: true })).toBe(false);
  });

  it("hides when the tenant could not be resolved, since the gate handles that case", () => {
    expect(shouldShowSkeleton({ tenantStatus: "signed-out", fetching: false, hasData: true })).toBe(false);
  });

  it("shows for an unresolved tenant with nothing to display yet", () => {
    expect(shouldShowSkeleton({ tenantStatus: "no-tenant", fetching: false, hasData: false })).toBe(true);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

```bash
npx vitest run lib/loading/skeletonVisibility.test.ts
```

Expected: FAIL, "Failed to resolve import ./skeletonVisibility".

- [x] **Step 3: Write the implementation**

Create `lib/loading/skeletonVisibility.ts`:

```ts
import type { TenantStatus } from "../tenant/context";

type Args = {
  /** From useTenant().status. */
  tenantStatus: TenantStatus;
  /** The page's own in-flight query. */
  fetching: boolean;
  /** Whether this region has already rendered real content at least once. */
  hasData: boolean;
};

/* The single rule for whether a loading region shows its skeleton.
   Extracted here rather than inlined per page for one reason: vitest covers
   lib/ only, and the hasData short circuit below is a real regression guard
   that needs a test. See skeletonVisibility.test.ts. */
export function shouldShowSkeleton({ tenantStatus, fetching, hasData }: Args): boolean {
  // Never flash a skeleton over content that is already on screen.
  if (hasData) return false;
  return tenantStatus !== "ready" || fetching;
}
```

- [x] **Step 4: Run it to verify it passes**

```bash
npx vitest run lib/loading/skeletonVisibility.test.ts
```

Expected: PASS, 7 tests.

- [x] **Step 5: Commit**

```bash
git add lib/loading/skeletonVisibility.ts lib/loading/skeletonVisibility.test.ts
git commit -m "feat: add shouldShowSkeleton with token-refresh guard"
```

---

### Task 5: The `SKELETON_READY_ROUTES` allowlist

**The list starts empty on purpose.** A route added here before its page handles `status === "loading"` would render its false empty state (and query with an unresolved tenant) instead of being safely blocked. Each route joins the list in the same task that converts its page: `/dashboard` in Task 8, `/customers` in Task 9.

**Files:**
- Create: `lib/nav/skeletonReadyRoutes.ts`
- Create: `lib/nav/skeletonReadyRoutes.test.ts`

- [x] **Step 1: Write the failing test**

Create `lib/nav/skeletonReadyRoutes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isSkeletonReadyRoute, SKELETON_READY_ROUTES } from "./skeletonReadyRoutes";

describe("isSkeletonReadyRoute", () => {
  it("returns false for an unlisted route, so a new page is gate-blocked by default rather than showing a false empty state", () => {
    expect(isSkeletonReadyRoute("/jobs")).toBe(false);
    expect(isSkeletonReadyRoute("/some-page-added-next-year")).toBe(false);
  });

  it("returns false for the legacy pages, which cannot render a ds skeleton at all", () => {
    expect(isSkeletonReadyRoute("/driver/dashboard")).toBe(false);
    expect(isSkeletonReadyRoute("/super-admin/companies")).toBe(false);
  });

  it("matches exactly and does not treat a sibling or a prefix as ready", () => {
    expect(isSkeletonReadyRoute("/customersomething")).toBe(false);
    expect(isSkeletonReadyRoute("/settings")).toBe(false);
  });

  it("lists exactly the routes converted so far, and nothing aspirational", () => {
    expect([...SKELETON_READY_ROUTES].sort()).toEqual([]);
  });
});
```

- [x] **Step 2: Run it to verify it fails**

```bash
npx vitest run lib/nav/skeletonReadyRoutes.test.ts
```

Expected: FAIL, "Failed to resolve import ./skeletonReadyRoutes".

- [x] **Step 3: Write the implementation**

Create `lib/nav/skeletonReadyRoutes.ts`:

```ts
/* THE SECOND ACTIVATION SWITCH, sibling to themeableRoutes.ts.

   A route on this list has been converted to draw its own loading skeleton, so
   TenantGate passes through instead of blocking, and AppShell renders during
   tenant resolution instead of hiding. The user lands on a recognisable page
   from the first frame rather than a bare dark panel with "Loading..." on it.

   A route NOT on this list keeps the old behaviour exactly: TenantGate blocks,
   the sidebar stays hidden. That is the safe default, and it is why this is an
   allowlist rather than a denylist.

   TO ADD A ROUTE, in this order and not before:
   1. Its loader early-returns unless useTenant().status === "ready", with
      status in the effect's dependency array.
   2. Every region that reads data renders a skeleton via shouldShowSkeleton
      (lib/loading/skeletonVisibility.ts), including regions that currently
      render an empty state. A page listed here without step 2 will show its
      "nothing found" copy as a statement of fact while the query is in flight.
   3. Then add the path below.

   Adding a path before steps 1 and 2 is the one way to make this change worse
   than what it replaced. See the spec for the four pages that already do this.

   When every route is listed, this file, its test, and TenantGate's loading
   panel can all be deleted in one commit. */
export const SKELETON_READY_ROUTES: readonly string[] = [
  // Populated per page. /dashboard and /customers land in this batch.
];

export function isSkeletonReadyRoute(pathname: string): boolean {
  // Exact match, not prefix, and trailing-slash tolerant. Same normalisation as
  // isThemeableRoute in ./themeableRoutes.ts; keep the two in step.
  const normalized =
    pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return SKELETON_READY_ROUTES.includes(normalized);
}
```

- [x] **Step 4: Run it to verify it passes**

```bash
npx vitest run lib/nav/skeletonReadyRoutes.test.ts
```

Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add lib/nav/skeletonReadyRoutes.ts lib/nav/skeletonReadyRoutes.test.ts
git commit -m "feat: add SKELETON_READY_ROUTES allowlist, initially empty"
```

---

### Task 6: `shouldShowShell` honours the allowlist

**Files:**
- Modify: `lib/nav/shouldShowShell.test.ts`
- Modify: `lib/nav/shouldShowShell.ts`

- [x] **Step 1: Write the failing tests**

The existing test at `lib/nav/shouldShowShell.test.ts:21-25` asserts `shouldShowShell("/jobs", "loading") === false`. `/jobs` is not on the allowlist and never will be in this batch, so that test stays true and must not be edited.

Add these two cases inside the existing `describe("shouldShowShell", ...)` block, after the "shows on an app route when signed in" test (line 30):

```ts
  /* The gate inversion. A converted route renders its own skeleton during
     tenant resolution, so the sidebar must render alongside it rather than
     popping in afterwards. Uses a literal path rather than importing
     SKELETON_READY_ROUTES so the test still means something when the list is
     emptied out at the end of the migration. */
  it("shows on a skeleton-ready route while tenant context is still loading", () => {
    expect(shouldShowShell("/dashboard", "loading")).toBe(true);
  });

  it("still hides on a skeleton-ready route when signed out or without a tenant, since only the loading case is relaxed", () => {
    expect(shouldShowShell("/dashboard", "signed-out")).toBe(false);
    expect(shouldShowShell("/dashboard", "no-tenant")).toBe(false);
  });
```

- [x] **Step 2: Run to verify they fail**

```bash
npx vitest run lib/nav/shouldShowShell.test.ts
```

Expected: FAIL on "shows on a skeleton-ready route while tenant context is still loading", `expected false to be true`. The signed-out case already passes; that is fine, it is there to pin the behaviour against regression.

- [x] **Step 3: Write the implementation**

Replace the whole body of `lib/nav/shouldShowShell.ts` with:

```ts
import type { TenantStatus } from "../tenant/context";
import { isSkeletonReadyRoute } from "./skeletonReadyRoutes";

// Two independent checks, both required. The pathname exemption alone was
// the gap commit 91fa6b0 closed: /login was missing from it, so an
// ALREADY-SIGNED-IN user saw a stray Dashboard link on the sign-in page
// (cosmetic, not an auth bypass — signed-out visitors were already blocked
// by the status check below). The status check is the fail-closed backstop
// regardless: it is an allowlist of the good (status, route) combinations,
// not a denylist of bad ones, so any future status value not yet accounted
// for defaults to hidden too.
export function shouldShowShell(pathname: string, status: TenantStatus): boolean {
  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) {
    return false;
  }
  if (status === "ready") return true;
  // A skeleton-ready route draws its own loading state, so the shell renders
  // beside it rather than after it. Only "loading" is relaxed: "signed-out"
  // and "no-tenant" still hide the shell on every route, converted or not.
  return status === "loading" && isSkeletonReadyRoute(pathname);
}
```

- [x] **Step 4: Run again, and expect it to still fail for the right reason**

```bash
npx vitest run lib/nav/shouldShowShell.test.ts
```

Expected: FAIL still, on the new "shows on a skeleton-ready route" case, and this is correct rather than a mistake. The implementation is right; `/dashboard` is simply not on the allowlist yet, because a route joins the list only in the task that converts its page (Task 8). Confirm the failure message is `expected false to be true` and not a type or import error.

To keep the suite green between here and Task 8, temporarily mark that one test `it.skip` with this comment above it:

```ts
  // UNSKIP IN TASK 8, when /dashboard joins SKELETON_READY_ROUTES.
```

- [x] **Step 5: Confirm the rest is green**

```bash
npm test && npm run typecheck
```

Expected: pass, with one skipped test.

- [x] **Step 6: Commit**

```bash
git add lib/nav/shouldShowShell.ts lib/nav/shouldShowShell.test.ts
git commit -m "feat: show the app shell during tenant load on skeleton-ready routes"
```

---

### Task 7: `TenantGate` passes through on allowlisted routes

The `signed-out` and `no-tenant` branches are deliberately untouched. Only the `loading` branch changes, and only for allowlisted routes.

**Files:**
- Modify: `app/components/TenantGate.tsx`

- [x] **Step 1: Rewrite the component**

Replace the whole of `app/components/TenantGate.tsx` with:

```tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTenant } from "./TenantProvider";
import { isSkeletonReadyRoute } from "../../lib/nav/skeletonReadyRoutes";

/* Hardcoded rather than tokenised, deliberately. This panel renders on every
   route including the legacy ones, before tenant status resolves, so it must
   not follow the light toggle: a bright full-screen flash on every load is the
   exact thing the dark default exists to prevent. Values track :root's --canvas
   and --ink in app/tokens.css; update them together. */
const panelStyle: React.CSSProperties = {
  minHeight: "100vh", display: "grid", placeItems: "center",
  background: "#0F1626", color: "#D6DEEC", padding: 30, textAlign: "center",
};

export default function TenantGate({ children }: { children: ReactNode }) {
  const { status } = useTenant();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "signed-out") router.replace("/login");
  }, [status, router]);

  if (status === "loading") {
    /* A converted route draws its own skeleton, so blocking it here would
       replace a recognisable page with a bare panel for the two serial
       Supabase round trips TenantProvider.resolve() makes. Everything else
       still blocks, which is the safe default.

       The page behind this is responsible for not querying until status is
       "ready". See the checklist in lib/nav/skeletonReadyRoutes.ts. */
    if (isSkeletonReadyRoute(pathname)) return <>{children}</>;
    return <div style={panelStyle}>Loading...</div>;
  }
  /* Unchanged below, on every route. Only the loading case above is relaxed:
     an unauthenticated or tenant-less visitor is still blocked outright. */
  if (status === "signed-out") {
    return <div style={panelStyle}>Redirecting to sign in...</div>;
  }
  if (status === "no-tenant") {
    return (
      <div style={panelStyle}>
        <div>
          <h1>Account not linked to a company</h1>
          <p style={{ opacity: 0.8 }}>Ask an administrator to assign your profile to a tenant.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
```

- [x] **Step 2: Verify**

```bash
npm test && npm run typecheck
```

Expected: both pass. Behaviour is unchanged on every route so far, because the allowlist is still empty.

- [x] **Step 3: Commit**

```bash
git add app/components/TenantGate.tsx
git commit -m "feat: let TenantGate pass through on skeleton-ready routes"
```

---

### Task 8: Convert `/dashboard`

Four regions need work. The `DataTable` needs none: it already passes `state="loading"` and inherited the repaired skeleton in Task 3.

**Files:**
- Modify: `components/Stat.tsx:1, 19-25`
- Modify: `app/dashboard/page.tsx`
- Modify: `lib/nav/skeletonReadyRoutes.ts`
- Modify: `lib/nav/shouldShowShell.test.ts` (unskip)

- [x] **Step 1: Widen `Stat.value`**

`string` is assignable to `ReactNode`, so this is a safe widening, but it touches every `Stat` call site in the app. `npm run typecheck` in step 8 is the check.

In `components/Stat.tsx`, change line 1 from:

```tsx
import { cn } from "../lib/cn";
```

to:

```tsx
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
```

and change the `value` line in `type Props` (line 21) from:

```tsx
  value: string;
```

to:

```tsx
  // ReactNode, not string, so a loading tile can pass a <Skeleton /> and keep
  // this component the single definition of a stat tile's layout.
  value: ReactNode;
```

- [x] **Step 2: Add the imports to the dashboard**

In `app/dashboard/page.tsx`, after the `isAwaitingPod` import (line 11):

```tsx
import Skeleton from "../../components/Skeleton";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
```

- [x] **Step 3: Guard the loader and derive the flag**

Replace the effect's opening lines. Change lines 48-52 from:

```tsx
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
```

to:

```tsx
  useEffect(() => {
    /* This guard fixes an existing bug rather than preventing a new one.
       TenantGate is an element inside this component's own JSX, not a wrapper
       around it, so it only ever gated the rendered DOM: DashboardPage mounts
       and this effect fires while status is still "loading", and has always
       done so. Every query below therefore ran with activeTenantId === null on
       each cold load. RLS is the isolation boundary (see CLAUDE.md), so that
       was a wasted round trip returning nothing, not a leak, which is why it
       went unnoticed.

       Returning BEFORE setState("loading") also stops a token refresh flashing
       a skeleton over a populated page: resolve() re-enters "loading" on every
       auth event, and this effect must not reset the page for that. */
    if (tenant.status !== "ready") return;

    let cancelled = false;

    async function load() {
      setState("loading");
```

and change the dependency array on line 176 from:

```tsx
  }, [tenant.activeTenantId]);
```

to:

```tsx
  }, [tenant.activeTenantId, tenant.status]);
```

Then add this immediately after the `maxRevenue` line (line 191):

```tsx
  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: state === "loading",
    hasData: state === "ready",
  });
```

- [x] **Step 4: Skeletonise the stat tiles**

Replace the whole stat grid (lines 210-231) with:

```tsx
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5" aria-busy={showSkeleton}>
            {/* One announcement for the whole page, not one per skeleton bar.
                Replaces the announcement the old "Loading..." text gave free. */}
            {showSkeleton ? <span className="sr-only" role="status">Loading dashboard</span> : null}
            <Stat
              label="Jobs today"
              value={showSkeleton ? <Skeleton display="inline-block" w="2.5ch" h="1.25rem" /> : String(kpis.jobsToday)}
            />
            <Stat
              label="Unassigned"
              value={showSkeleton ? <Skeleton display="inline-block" w="2.5ch" h="1.25rem" /> : String(kpis.unassigned)}
              sub={kpis.unassigned > 0 ? "needs a vehicle/driver" : undefined}
              subTone="warning"
            />
            <Stat
              label="On the road"
              value={showSkeleton ? <Skeleton display="inline-block" w="2.5ch" h="1.25rem" /> : String(kpis.onTheRoad)}
              sub="rostered today"
            />
            <Stat
              label="PODs awaiting"
              value={showSkeleton ? <Skeleton display="inline-block" w="2.5ch" h="1.25rem" /> : String(kpis.podsAwaiting)}
              sub={kpis.podsAwaiting > 0 ? "open delivery stops" : undefined}
              subTone="warning"
            />
            <Stat
              label="Overdue invoices"
              value={showSkeleton ? <Skeleton display="inline-block" w="6ch" h="1.25rem" /> : money(kpis.overdueInvoicesTotal)}
              sub={kpis.overdueInvoicesTotal > 0 ? "past due" : undefined}
              subTone="danger"
            />
          </div>
```

`display="inline-block"` matters here: the value sits in a `text-2xl` span whose line box is 36px. A block child would collapse that line box and shrink every tile.

- [x] **Step 5: Feed the table its loading state**

The `DataTable` currently derives `state` from the page's own `state` only, so during tenant resolution it would show "No jobs scheduled today". Replace line 245:

```tsx
                state={state === "loading" ? "loading" : state === "error" ? "error" : todayJobs.length ? "ready" : "empty"}
```

with:

```tsx
                state={showSkeleton ? "loading" : state === "error" ? "error" : todayJobs.length ? "ready" : "empty"}
```

- [x] **Step 6: Skeletonise "Needs attention"**

This panel currently renders "Nothing needs attention right now." while the query is in flight, which is a false statement rather than a missing skeleton. Replace lines 251-267 with:

```tsx
              <div className="rounded-lg border border-line bg-surface p-4 shadow-sm" aria-busy={showSkeleton}>
                <h2 className="mb-2 text-sm font-semibold text-ink">Needs attention</h2>
                {showSkeleton ? (
                  <ul className="flex flex-col gap-2">
                    {[0, 1, 2].map((i) => (
                      <li key={`attention-skeleton-${i}`} className="px-2 py-1.5 -mx-2">
                        <Skeleton w="70%" h="0.875rem" className="mb-1.5" />
                        <Skeleton w="45%" h="0.75rem" />
                      </li>
                    ))}
                  </ul>
                ) : attention.length === 0 ? (
                  <p className="text-sm text-ink-3">Nothing needs attention right now.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {attention.slice(0, 5).map((item) => (
                      <li key={item.id}>
                        <Link href={item.href} className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-surface-2">
                          <span className="block text-sm font-medium text-ink">{item.title}</span>
                          <span className="block text-xs text-ink-3">{item.meta}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
```

- [x] **Step 7: Skeletonise the revenue chart**

This is the one genuinely zero-shift region in the plan: the bar count is known ahead of time, because it is always seven days. Replace lines 273-282 with:

```tsx
                <div className="flex h-16 items-end gap-1.5" aria-busy={showSkeleton}>
                  {showSkeleton
                    ? [0, 1, 2, 3, 4, 5, 6].map((i) => (
                        // Fixed heights, not random: a skeleton that reshuffles
                        // on every render reads as data arriving when it is not.
                        <div key={`revenue-skeleton-${i}`} className="flex-1">
                          <Skeleton w="100%" h={`${[40, 65, 30, 80, 55, 70, 45][i]}%`} />
                        </div>
                      ))
                    : revenue.map((d) => (
                        <div key={d.date} className="flex-1" title={`${d.label}: ${money(d.total)}`}>
                          <div
                            className="w-full rounded-t bg-primary"
                            style={{ height: `${Math.max(4, (d.total / maxRevenue) * 100)}%` }}
                          />
                        </div>
                      ))}
                </div>
```

- [x] **Step 8: Verify before wiring the route in**

```bash
npm run typecheck
```

Expected: no output. If a `Stat` call site elsewhere in the app now fails, that is the widening from Step 1 doing its job; the fix is always to leave that call site alone, because `string` remains valid.

- [x] **Step 9: Add the route to the allowlist**

In `lib/nav/skeletonReadyRoutes.ts`, replace the placeholder comment inside the array with:

```ts
  "/dashboard",               // app/dashboard/page.tsx
```

- [x] **Step 10: Update the two allowlist tests**

In `lib/nav/skeletonReadyRoutes.test.ts`, change the last test's expectation from `toEqual([])` to:

```ts
    expect([...SKELETON_READY_ROUTES].sort()).toEqual(["/dashboard"].sort());
```

and add a positive case as the first test in the describe block:

```ts
  it("returns true for a converted route", () => {
    expect(isSkeletonReadyRoute("/dashboard")).toBe(true);
  });

  it("ignores a trailing slash, which Next can produce depending on config", () => {
    expect(isSkeletonReadyRoute("/dashboard/")).toBe(true);
  });
```

In `lib/nav/shouldShowShell.test.ts`, remove the `.skip` and the `// UNSKIP IN TASK 8` comment you added in Task 6 Step 4.

- [x] **Step 11: Run everything**

```bash
npm test && npm run typecheck
```

Expected: all pass, nothing skipped.

- [x] **Step 12: Commit**

```bash
git add components/Stat.tsx app/dashboard/page.tsx lib/nav/skeletonReadyRoutes.ts lib/nav/skeletonReadyRoutes.test.ts lib/nav/shouldShowShell.test.ts
git commit -m "feat: skeletonise /dashboard and enable shell-first boot on it"
```

---

### Task 9: Convert `/customers`

This is the archetype the later batches copy, so the extraction matters more than the skeleton. The card becomes one component that renders either state, so the two can never drift.

Note `/customers` fetches through `/api/customers` with an `x-tenant-id` header (`app/customers/page.tsx:207-208`), not `filterByTenant`, and its effect has a 250ms search debounce (`:249-255`).

**Line numbers below are for the original file.** Step 1 deletes 59 lines near the top, so from Step 2 onward every later reference sits roughly 59 lines earlier than stated. Locate each edit by its quoted content.

**Files:**
- Create: `app/customers/types.ts`
- Create: `app/customers/CustomerCard.tsx`
- Modify: `app/customers/page.tsx`
- Modify: `lib/nav/skeletonReadyRoutes.ts`, `lib/nav/skeletonReadyRoutes.test.ts`

- [x] **Step 1: Extract the row type**

Delete lines 11-69 of `app/customers/page.tsx` (the block from `type Customer = {` through its closing `};`, ending with the `notes: string | null;` field). Create `app/customers/types.ts` with exactly this content:

```ts
/* The customer row as /api/customers returns it. Lives here rather than in
   page.tsx so CustomerCard can import it without importing a route module. */
export type Customer = {
  id: string;
  name: string;
  legal_name: string | null;
  trading_name: string | null;
  account_code: string | null;
  company_number: string | null;
  vat_number: string | null;
  eori_number: string | null;
  website: string | null;
  industry_type: string | null;
  active: boolean;
  contact_name: string | null;
  job_title: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  accounts_email: string | null;
  operations_email: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  county_region: string | null;
  postcode: string | null;
  country_code: string | null;
  payment_terms_days: number | null;
  credit_limit: number | null;
  credit_status: string | null;
  currency_code: string | null;
  requires_po: boolean;
  default_po_reference: string | null;
  fuel_surcharge_percent: number | null;
  vat_rate: number | null;
  default_collection_instructions: string | null;
  default_delivery_instructions: string | null;
  default_vehicle_type: string | null;
  tail_lift_required: boolean;
  adr_required: boolean;
  temperature_control_required: boolean;
  timed_delivery_required: boolean;
  pod_required: boolean;
  invoice_pod_attachment_required: boolean;
  pallet_exchange_required: boolean;
  weekend_delivery_allowed: boolean;
  booking_reference_required: boolean;
  default_depot: string | null;
  default_contact_method: string | null;
  account_manager: string | null;
  service_level: string | null;
  customer_status: string | null;
  credit_hold: boolean;
  out_of_hours_contact: string | null;
  external_customer_id: string | null;
  accounting_customer_id: string | null;
  crm_customer_id: string | null;
  api_enabled: boolean;
  webhook_url: string | null;
  notes: string | null;
};
```

Verify against the original before deleting: the type must be identical, since `CustomerForm` and the `/api/customers` handler both depend on these exact field names.

Then add this import to `app/customers/page.tsx`, after the `MessageBanner` import (line 9):

```tsx
import type { Customer } from "./types";
```

- [x] **Step 2: Verify the move compiled**

```bash
npm run typecheck
```

Expected: no output. If it complains that `Customer` is unused or missing, you either left the original type in place or missed a field.

- [x] **Step 3: Create the card**

Create `app/customers/CustomerCard.tsx`. `Info` moves here from `page.tsx:1081-1094` with its `value` widened to `ReactNode`, since it is only used by this card.

```tsx
import type { ReactNode } from "react";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import type { Customer } from "./types";

type Props = {
  customer: Customer;
  loading?: boolean;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
};

/* ONE layout definition for both states. The alternative, a separate
   CustomersSkeleton mirroring these class names, drifts the first time anyone
   edits the real card, and no test in this repo would catch it.

   Only data-bearing leaves become skeletons. Labels, structure and the two
   buttons render for real: they carry no data, so a grey rectangle would be
   less faithful than the thing itself. */
export default function CustomerCard({ customer, loading = false, onEdit, onDelete }: Props) {
  return (
    <article className="rounded-lg border border-line bg-surface-2 p-3" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-md font-semibold text-ink">
            {loading ? <Skeleton display="inline-block" w="9ch" h="1rem" /> : customer.name}
          </h3>
          <span className="font-mono text-xs text-ink-3">
            {loading
              ? <Skeleton display="inline-block" w="6ch" h="0.75rem" />
              : customer.account_code || "No account code"}
          </span>
        </div>

        {loading ? (
          <Skeleton w="4.5rem" h="1.375rem" pill />
        ) : customer.credit_hold ? (
          <Badge tone="danger">Credit Hold</Badge>
        ) : customer.active ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="neutral">Inactive</Badge>
        )}
      </div>

      <div className="my-2 grid grid-cols-2 gap-2">
        <Info label="Contact" loading={loading} value={customer.contact_name || customer.email} />
        <Info label="Phone" loading={loading} value={customer.phone} />
        <Info
          label="Location"
          loading={loading}
          value={[customer.city, customer.postcode].filter(Boolean).join(", ") || null}
        />
        <Info label="Terms" loading={loading} value={`${customer.payment_terms_days ?? 30} days`} />
        <Info
          label="Credit Limit"
          loading={loading}
          value={
            customer.credit_limit === null
              ? "—"
              : `£${Number(customer.credit_limit).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`
          }
        />
        <Info label="Service" loading={loading} value={customer.service_level || "Standard"} />
      </div>

      {/* Two placeholder pills is a guess: the real row holds nought to five
          badges and the count is unknowable before the data lands. This row
          will shift. Recorded in the spec rather than papered over. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {loading ? (
          <>
            <Skeleton w="3.5rem" h="1.375rem" pill />
            <Skeleton w="4.5rem" h="1.375rem" pill />
          </>
        ) : (
          <>
            {customer.adr_required ? <Badge tone="neutral">ADR</Badge> : null}
            {customer.tail_lift_required ? <Badge tone="neutral">Tail Lift</Badge> : null}
            {customer.timed_delivery_required ? <Badge tone="neutral">Timed</Badge> : null}
            {customer.pod_required ? <Badge tone="neutral">POD</Badge> : null}
            {customer.api_enabled ? <Badge tone="info">API</Badge> : null}
          </>
        )}
      </div>

      {/* Real buttons, disabled. Fixed size, no data, so this is both more
          faithful than a grey rectangle and more honest about being inert. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" type="button" disabled={loading} onClick={() => onEdit(customer)}>
          Edit
        </Button>
        <Button variant="danger" size="sm" type="button" disabled={loading} onClick={() => onDelete(customer)}>
          Delete
        </Button>
      </div>
    </article>
  );
}

function Info({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="text-sm">
      <span className="text-kicker uppercase text-ink-2">{label}</span>{" "}
      <strong className="block text-ink">
        {/* display="inline-block" is load-bearing, not cosmetic. This <strong> is
            block-level at text-sm, so its line box is 18px with text in it. A
            block skeleton would make it 14px instead, shrinking every Info cell
            by 4px: three rows of them, so the card jumps 12px shorter while
            loading and back again on arrival. inline-block keeps the 18px strut
            and the cell holds its height. */}
        {loading ? <Skeleton display="inline-block" w="80%" h="0.875rem" /> : value || "—"}
      </strong>
    </div>
  );
}
```

- [x] **Step 4: Confirm `Button` accepts `disabled`**

```bash
grep -n "disabled" components/Button.tsx
```

Expected: a `disabled` prop or a spread of button attributes. If `Button` does not accept it, add `disabled?: boolean` to its props and pass it to the underlying `<button>`, then re-run `npm run typecheck`.

- [x] **Step 5: Wire the page up**

In `app/customers/page.tsx`:

Add after the `import type { Customer } from "./types";` line:

```tsx
import CustomerCard from "./CustomerCard";
import { shouldShowSkeleton } from "../../lib/loading/skeletonVisibility";
```

Add a "have we ever loaded" flag next to the other state, after line 197 (`const [loading, setLoading] = useState(true);`):

```tsx
  // Distinct from `loading`: this stays true across refetches, so a token
  // refresh cannot flash a skeleton over the cards already on screen.
  const [hasLoaded, setHasLoaded] = useState(false);
```

Set it in `loadCustomers`'s `finally` block. Change lines 244-246 from:

```tsx
    } finally {
      setLoading(false);
    }
```

to:

```tsx
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
```

Guard the effect. Replace lines 249-255:

```tsx
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCustomers();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [loadCustomers]);
```

with:

```tsx
  useEffect(() => {
    /* This page mounts during tenant resolution now that TenantGate passes
       through, and the x-tenant-id header would otherwise go out empty.
       Returning before the timer is also what stops a token refresh, which
       re-enters status "loading", from restarting the fetch. */
    if (tenant.status !== "ready") return;

    const timer = window.setTimeout(() => {
      void loadCustomers();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [loadCustomers, tenant.status]);
```

Derive the flag. Add immediately after the `useEffect` above:

```tsx
  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: hasLoaded,
  });
```

- [x] **Step 6: Replace the grid**

Replace lines 854-959 (the `{loading ? ... : customers.length === 0 ? ... : (grid)}` block, from `{loading ? (` through the closing `)}` before `</section>`) with:

```tsx
            {showSkeleton ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy>
                <span className="sr-only" role="status">Loading customers</span>
                {/* Six is a guess. However many customers arrive, this grid
                    resizes: pixel-faithful fixes each card's shape, not the
                    count. Recorded in the spec. */}
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <CustomerCard
                    key={`customer-skeleton-${i}`}
                    loading
                    customer={PLACEHOLDER_CUSTOMER}
                    onEdit={() => {}}
                    onDelete={() => {}}
                  />
                ))}
              </div>
            ) : customers.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-3">No customers found.</p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {customers.map((customer) => (
                  <CustomerCard
                    key={customer.id}
                    customer={customer}
                    onEdit={startEdit}
                    onDelete={(c) => void deleteCustomer(c)}
                  />
                ))}
              </div>
            )}
```

- [x] **Step 7: Add the placeholder row**

`CustomerCard` requires a `Customer` even when loading, because it is one component rendering two states. Add this above the page component, next to `EMPTY_FORM`:

```tsx
/* Never rendered: every field CustomerCard reads is behind `loading`. It exists
   so the card can keep one required `customer` prop rather than an optional one
   that every real call site would then have to null-check. */
const PLACEHOLDER_CUSTOMER = { id: "skeleton" } as Customer;
```

- [x] **Step 8: Delete the old `Info`**

Remove the now-unused `function Info(...)` from `app/customers/page.tsx:1081-1094`. It lives in `CustomerCard.tsx` now.

- [x] **Step 9: Verify**

```bash
npm run typecheck
```

Expected: no output. A "declared but never read" error on `Badge` or `Button` in `page.tsx` means those imports are now unused there; check whether the page still uses them elsewhere before deleting.

- [x] **Step 10: Add the route to the allowlist**

In `lib/nav/skeletonReadyRoutes.ts`, after the `/dashboard` line:

```ts
  "/customers",               // app/customers/page.tsx
```

In `lib/nav/skeletonReadyRoutes.test.ts`, update the exhaustive list:

```ts
    expect([...SKELETON_READY_ROUTES].sort()).toEqual(["/dashboard", "/customers"].sort());
```

- [x] **Step 11: Run everything**

```bash
npm test && npm run typecheck
```

Expected: all pass.

- [x] **Step 12: Commit**

```bash
git add app/customers/ lib/nav/skeletonReadyRoutes.ts lib/nav/skeletonReadyRoutes.test.ts
git commit -m "feat: skeletonise /customers via an extracted CustomerCard"
```

---

### Task 10: Verification

**Files:** none

- [x] **Step 1: Full unit suite**

```bash
npm test
```

Expected: PASS, including `lib/theme/contrast.test.ts` (which reads `app/tokens.css` from disk and will catch a token typo) and nothing skipped.

- [x] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no output, exit 0.

- [x] **Step 3: Production build**

The one check that catches a Tailwind class that compiles to nothing.

```bash
npm run build
```

Expected: build succeeds.

- [x] **Step 4: Re-confirm the Playwright specs are untouched**

These are standalone node scripts needing a dev server and a live magic link, not an automated gate. See Task 0 Step 4. The check here is the same inspection: confirm `SKELETON_READY_ROUTES` still contains only `/dashboard` and `/customers`, and therefore that `TenantGate` behaves identically on `/pod` and `/tracking`.

```bash
grep -A4 "SKELETON_READY_ROUTES: readonly" lib/nav/skeletonReadyRoutes.ts
```

Expected: exactly the two converted routes and nothing else. If `/pod` or `/tracking` appears there, someone exceeded this batch's scope and both specs need re-running by hand before merging.

- [x] **Step 5: Signed-in manual pass**

Automated tests cannot see any of this. Sign in (`scripts/dev-login.mjs`; note `.env.local` points at the LIVE Supabase, so do not write data) and check:

1. **`/dashboard` cold load.** Sidebar renders immediately, not after a blank panel. Stat tiles show skeleton bars, not `—`. The tiles do not change height when numbers arrive. "Needs attention" shows three skeleton rows, never "Nothing needs attention right now." The revenue chart shows seven bars that do not reflow.
2. **`/customers` cold load.** Six skeleton cards, correct grid, each the shape of a real card. Edit and Delete render disabled, then enable.
3. **Light mode.** Toggle it on both pages. Skeletons must stay visible against the white cards.
4. **Reduced motion.** Turn on the OS setting and reload. The pulse must stop. This is the check that would have caught the old `animate-pulse`.
5. **An unconverted route, e.g. `/jobs`.** Must still show the old full-screen "Loading..." panel. If it does not, the allowlist is wrong.
6. **Signed out.** Visit `/dashboard` in a private window. It must still redirect to `/login` and must not flash the populated shell.

- [x] **Step 6: Commit any fixes, then report**

Report to the user: the Task 0 versus Step 4 Playwright comparison, and the result of each of the six manual checks. Do not claim the work is complete until Step 5 has actually been run.

---

## Deviations from the spec

One, worth flagging at review:

**`Skeleton` gained a `display` prop** (`"block" | "inline-block"`, default `"block"`), which the spec's sketch did not have. A `block` skeleton inside an inline text container sets that box's height outright, which shrinks every `Stat` tile and every `Info` cell the moment it loads: the opposite of the zero-shift goal. `display="inline-block"` emits `inline-block align-middle`, so the parent's line-height strut still governs and nothing moves. The rule to apply when adding call sites in later batches: **an inline-block skeleton preserves the line box only while its `h` is smaller than the surrounding line-height.** Give it a taller `h` and the line box legitimately grows to fit it.

**`Skeleton` uses `pill?: boolean` rather than the spec's `rounded`.** A two-value enum was proposed as `"sm" | "full"`, but `"sm"` emitted the class `rounded`, which is 8px in this repo's overridden `borderRadius` scale (`tailwind.config.ts:97`), while `rounded-sm` is 6px. The value name said one thing and the output was another. `pill` is unambiguous: set it where a skeleton stands in for a `Badge`, omit it everywhere else. Behaviour is identical to the original proposal.

Both names were corrected after Task 2's code review, while the component had zero call sites.

## What this plan deliberately does not do

Recorded so none of it gets refiled as a review finding:

- **The `TenantContextValue` discriminated union.** The real compile-time guard against querying before tenant resolution. Deferred because every page destructures `filterByTenant` unconditionally, making it a roughly 15-page compile break. See the spec.
- **The other 14 design-system pages**, the 7 legacy pages, and route-level `loading.tsx` for the async server components.
- **The three other false-data pages** (`/jobs`, `/settings/invoices`, `/pod`). `/dashboard`'s is fixed only because it is being converted anyway.
- **`tracking-layout.spec.mjs:145`'s `"Loading jobs"` guard.** That spec aborts when it sees `/tracking`'s current loading text, which is exactly right today and becomes wrong the moment `/tracking` gets a skeleton. Whoever converts `/tracking` in a later batch must give that guard a new signal. Out of scope here because `/tracking` is not on the allowlist in this batch.
