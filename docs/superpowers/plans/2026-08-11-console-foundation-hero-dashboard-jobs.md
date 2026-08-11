# Console Foundation + Hero Logo + Dashboard + Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the app's existing Tailwind design system to the finalized brand palette,
replace `AppHeader` with a Console-matching `AppShell`, give `/dashboard` a real tenant-scoped
data layer, and visually rebuild `/jobs` onto the new system — all with zero business-logic
change to Jobs, and zero logic change to the landing page beyond a logo swap.

**Architecture:** Token-only re-theme (no new styling system, no new dependency) using the
existing Tailwind pipeline. New shared primitives (`Logo`, `Stat`, `DataTable`, `Modal`) built
fresh — the "Redesign handoff" scaffolding referenced during brainstorming does not exist in
this repo, so nothing is being "restored," it's new code, built directly from the Console
mockup markup. `Jobs` keeps its exact current data flow (`loadData`/`saveJob`/`deleteJob`/
`savePod`, unchanged) and current card-per-job layout shape (not converted to a flat table —
see Task 21 for why), split into smaller files for maintainability, restyled in place.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind (existing v3-style
config, Preflight off, `.ds`-scoped reset), Supabase (`@supabase/ssr`), Zod, Vitest,
`lucide-react` (already a dependency).

**Spec:** `docs/superpowers/specs/2026-08-11-console-design-system-phase1-2-design.md`
(read the "Non-goals" and "Landing / Hero" sections before starting — several existing
behaviors and quirks are deliberately preserved, not fixed, by this plan).

---

## File Structure

New:
- `components/Logo.tsx` — the finalized mark, tile and glyph variants; used by `LandingNav` and `AppShell`.
- `lib/nav/navConfig.ts` — pure nav taxonomy data (no JSX), consumed by `AppShell`.
- `lib/nav/shouldShowShell.ts` + `lib/nav/shouldShowShell.test.ts` — the security guard as a pure, tested function.
- `app/components/AppShell.tsx` — replaces `AppHeader.tsx`.
- `components/Stat.tsx` — KPI tile, used by Dashboard.
- `components/DataTable.tsx` — generic table with loading/error/empty states, used by Dashboard (and future phases).
- `components/Modal.tsx` — generic dialog primitive, used by Jobs' delete confirmation.
- `lib/dashboard/aggregate.ts` + `lib/dashboard/aggregate.test.ts` — pure functions for the "needs attention" merge and the 7-day revenue bucket.
- `app/icon.svg` — favicon (none exists today).
- `app/jobs/StopCard.tsx` — extracted stop + inline POD sub-form (currently inline in `page.tsx`).
- `app/jobs/JobForm.tsx` — extracted create/edit form (currently inline in `page.tsx`).
- `app/jobs/DeleteJobDialog.tsx` — `Modal`-based confirm, replacing `window.confirm`.

Modified:
- `app/tokens.css`, `tailwind.config.ts` — re-keyed to Console's palette + radius scale.
- `app/layout.tsx` — Plex Mono weight 600 added; mounts `AppShell` instead of `AppHeader`.
- `app/components/TenantProvider.tsx` — exposes `userEmail` (AppShell needs to show who's signed in; `TenantProvider` already fetches the user, just doesn't expose the email today).
- `components/landing/LandingNav.tsx` — placeholder square replaced with `Logo`.
- `app/components/PodLink.tsx` — hardcoded hex colors (`#111827`, `#b91c1c`) replaced with tokens.
- `app/dashboard/page.tsx` — full rebuild: static server component → `"use client"` data-driven page.
- `app/jobs/page.tsx` — orchestrator, rewired to the three new sub-components, logic unchanged.

Deleted:
- `app/components/AppHeader.tsx` — superseded by `AppShell`.

**Not touched:** every other page (`pod`, `tracking`, `invoices`, `customers`,
`subcontractors`, `vehicles`, `drivers`, etc.) — still uses `AppShell` for its chrome once
Task 15 lands (that's app-wide), but its own page content stays exactly as it is today. Only
`/dashboard` and `/jobs` get their content rebuilt in this plan.

---

## Task 1: Feature branch

- [ ] **Step 1: Create and switch to the feature branch**

```bash
git checkout -b feat/console-design-foundation
```

- [ ] **Step 2: Confirm clean starting state**

```bash
git status
npm run typecheck
```
Expected: clean tree (only the branch changed), typecheck passes.

---

## Task 2: Foundation — re-key `app/tokens.css`

**Files:**
- Modify: `app/tokens.css`

- [ ] **Step 1: Replace the `:root` block with Console's palette**

Replace the entire `:root { ... }` block (lines 3-18) with:

```css
:root {
  /* surfaces */
  --canvas: #F2F4F8;         /* was #F4F6F8 */
  --surface: #FFFFFF;
  --surface-2: #EDF0F5;      /* was #F8FAFC */
  --line: #E4E7EE;           /* was #E2E8F0 */
  --line-strong: #B9BFCC;    /* was #CBD5E1 */
  /* chrome — new: the dark sidebar/topbar surface AppShell uses, AppHeader never had one */
  --chrome: #0B1220;
  --chrome-raised: #1A2438;
  --chrome-border: #242F47;
  --chrome-text: #C9CFDD;
  --chrome-text-strong: #FFFFFF;
  /* text */
  --ink: #0B1220;            /* was #0F172A */
  --ink-2: #5B6474;          /* was #475569 */
  --ink-3: #737D8F;          /* was #64748B */
  --ink-4: #98A0B0;          /* was #94A3B8 */
  /* brand */
  --primary: #2953E3;        /* was #2D54DE — the finalized logo blue */
  --primary-hover: #1E41BD;
  --primary-active: #1A3595;
  --primary-tint: #F0F4FE;
  --primary-tint-border: #C3D1F8;
  --primary-deep: #1E41BD;
  /* accent — unchanged, Console doesn't define one; kept for existing amber usage */
  --accent: #D97706;
  --accent-text: #B45309;
  --accent-tint: #FFFBEB;
  --accent-border: #FDE68A;
  /* semantic status */
  --success: #0F8547;        --success-strong: #0C6B3A;
  --success-tint: #DCF3E5;   --success-border: #B7E4C7;
  --warning: #B25E09;        --warning-strong: #8F4B06;
  --warning-tint: #FCEFDC;   --warning-border: #F5D9AE;
  --danger: #D23E3E;         --danger-hover: #AB2F2F;   --danger-strong: #AB2F2F;
  --danger-tint: #FBE5E5;    --danger-border: #F3C2C2;
  --focus: #2953E3;
  /* elevation — same shape, rgba base moved from #0F172A to #0B1220 */
  --shadow-xs: 0 1px 2px rgba(11,18,32,.05);
  --shadow-sm: 0 1px 2px rgba(11,18,32,.05), 0 2px 8px -2px rgba(11,18,32,.08);
  --shadow-md: 0 4px 16px -4px rgba(11,18,32,.12), 0 2px 4px -2px rgba(11,18,32,.06);
  --shadow-lg: 0 16px 40px -8px rgba(11,18,32,.22);
}
```

Note: `--success-border`/`--warning-border`/`--danger-border` are picked to sit between each
color's `-tint` and base step (Console's source only defines one light step per status color,
not the tint/border two-step pattern this app's `Badge`/`Field` components rely on) — these
are a reasonable visual judgment call, not a spec-mandated value. Flag for Ethan to eyeball
once built; adjusting them later is a one-line change.

- [ ] **Step 2: Leave the `.dark` scaffold and the global `:focus-visible` rule untouched**

No change needed — dark mode is out of scope for this build (per spec Non-goals), and the
`:focus-visible` rule at the bottom of the file already references `var(--focus)`, which just
picked up the new value automatically.

- [ ] **Step 3: Typecheck (sanity — CSS changes don't affect TS, but confirms nothing else broke)**

```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/tokens.css
git commit -m "style: re-theme tokens.css to the finalized logo palette"
```

---

## Task 3: Foundation — re-key `tailwind.config.ts`

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Add the `chrome` color group and adjust `borderRadius`**

In `theme.extend.colors`, add a `chrome` entry alongside the existing `canvas`/`surface`/etc.
keys (insert after the `line` entry, before `ink`):

```ts
        chrome: {
          DEFAULT: "var(--chrome)",
          raised: "var(--chrome-raised)",
          border: "var(--chrome-border)",
          text: "var(--chrome-text)",
          "text-strong": "var(--chrome-text-strong)",
        },
```

Change `theme.extend.borderRadius` from:
```ts
      borderRadius: { sm: "6px", DEFAULT: "8px", md: "8px", lg: "12px", xl: "16px" },
```
to Console's scale (controls=6, menus=10, cards/dialogs=14; `xl` left alone, nothing
currently depends on it changing):
```ts
      borderRadius: { sm: "6px", DEFAULT: "8px", md: "10px", lg: "14px", xl: "16px" },
```

- [ ] **Step 2: Typecheck + build**

```bash
npm run typecheck
npm run build
```
Expected: both PASS. The build is the real check here — it compiles Tailwind's output and
would fail loudly on a malformed config.

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "style: add chrome color tokens and Console's radius scale"
```

---

## Task 4: Foundation — Plex Mono weight 600

**Files:**
- Modify: `app/layout.tsx:35-41`

- [ ] **Step 1: Add weight 600 to the `plexMono` font call**

Change:
```ts
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
  preload: false,
});
```
to:
```ts
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
  preload: false,
});
```

- [ ] **Step 2: Build**

```bash
npm run build
```
Expected: PASS (this is a Google Font fetch at build time; confirms the weight is available).

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: load IBM Plex Mono 600 for Console's data typography"
```

---

## Task 5: `Logo` component

**Files:**
- Create: `components/Logo.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { CSSProperties } from "react";

/* The finalized "Dispatch Arrow" mark from the Logo Concepts design project.
   Colors are fixed regardless of theme (blue tile + white glyph, or the naked
   glyph on its own) — this is deliberate per the logo project's own rationale,
   not a token oversight. */

type Props = {
  /** "tile": blue rounded-rect with a white glyph (nav/header use).
      "glyph": the mark alone, no container (inline in headings, empty states). */
  variant?: "tile" | "glyph";
  /** Only used by variant="glyph" — which color the naked glyph renders in. */
  theme?: "blue" | "white";
  size?: number;
  className?: string;
};

export default function Logo({ variant = "tile", theme = "blue", size = 32, className }: Props) {
  const style: CSSProperties = { flexShrink: 0 };

  if (variant === "tile") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        style={style}
        className={className}
        role="img"
        aria-label="TMS Wizzard"
      >
        <rect width="48" height="48" rx="13" fill="#2953E3" />
        <circle cx="13" cy="35" r="5" fill="#FFFFFF" />
        <path
          d="M13 35 C 13 21.5, 21 13.5, 31 13.5"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <polygon points="29,6.5 41,13.5 29,20.5" fill="#FFFFFF" />
      </svg>
    );
  }

  const glyphColor = theme === "white" ? "#FFFFFF" : "#2953E3";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      style={style}
      className={className}
      role="img"
      aria-label="TMS Wizzard"
    >
      <circle cx="13" cy="35" r="5" fill={glyphColor} />
      <path
        d="M13 35 C 13 21.5, 21 13.5, 31 13.5"
        fill="none"
        stroke={glyphColor}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <polygon points="29,6.5 41,13.5 29,20.5" fill={glyphColor} />
    </svg>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/Logo.tsx
git commit -m "feat: add the finalized Logo component (tile + glyph variants)"
```

---

## Task 6: Wire `Logo` into `LandingNav`

**Files:**
- Modify: `components/landing/LandingNav.tsx:1-24`

- [ ] **Step 1: Replace the placeholder square**

Add the import:
```tsx
import Logo from "../Logo";
```

Change:
```tsx
        <div className="flex items-center gap-2">
          <span className="h-5 w-5 rounded-md bg-primary" aria-hidden />
          <span className="text-base font-semibold text-ink">TMS Wizzard</span>
        </div>
```
to:
```tsx
        <div className="flex items-center gap-2">
          <Logo variant="tile" size={24} />
          <span className="text-base font-semibold text-ink">TMS Wizzard</span>
        </div>
```

- [ ] **Step 2: Manual check**

```bash
npm run dev
```
Open `http://localhost:3000` — confirm the real mark renders in the nav instead of a plain
blue square, at both desktop and mobile widths.

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add components/landing/LandingNav.tsx
git commit -m "feat: replace landing nav's placeholder logo with the real mark"
```

---

## Task 7: Favicon

**Files:**
- Create: `app/icon.svg`

- [ ] **Step 1: Add the file (Next's file-convention favicon — no code wiring needed)**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#2953E3"/><circle cx="13" cy="35" r="5" fill="#FFFFFF"/><path d="M13 35 C 13 21.5, 21 13.5, 31 13.5" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/><polygon points="29,6.5 41,13.5 29,20.5" fill="#FFFFFF"/></svg>
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
npm run dev
```
Open `http://localhost:3000` and check the browser tab icon.

- [ ] **Step 3: Commit**

```bash
git add app/icon.svg
git commit -m "feat: add favicon (none existed before)"
```

---

## Task 8: `TenantProvider` — expose `userEmail`

**Files:**
- Modify: `app/components/TenantProvider.tsx`

`AppShell` (Task 14) needs to show who's signed in. `TenantProvider` already calls
`supabase.auth.getUser()` in `resolve()` — it just discards the email today. Expose it rather
than have `AppShell` independently re-fetch the same data.

- [ ] **Step 1: Add `userEmail` to state and the context value**

Add a new piece of state near the existing `userId` state (`TenantProvider.tsx:32`):
```ts
  const [userEmail, setUserEmail] = useState<string | null>(null);
```

In `resolve()` (`TenantProvider.tsx:35-58`), where it currently does:
```ts
    if (!user) {
      setUserId(null);
      setData({ ...LOADING, status: "signed-out" });
      setActiveTenantIdState(null);
      return;
    }
    setUserId(user.id);
```
change to:
```ts
    if (!user) {
      setUserId(null);
      setUserEmail(null);
      setData({ ...LOADING, status: "signed-out" });
      setActiveTenantIdState(null);
      return;
    }
    setUserId(user.id);
    setUserEmail(user.email ?? null);
```

Add `userEmail` to the `TenantContextValue` type (`TenantProvider.tsx:13-21`):
```ts
type TenantContextValue = {
  status: TenantStatus;
  role: TenantRole;
  userEmail: string | null;
  tenants: TenantOption[];
  activeTenantId: string | null;
  setActiveTenantId: (id: string | null) => void;
  writeTenantId: string | null;
  filterByTenant: <Q>(query: Q) => Q;
};
```

And to the `value` object built in the component body (`TenantProvider.tsx:80-88`):
```ts
  const value: TenantContextValue = {
    status: data.status,
    role: data.role,
    userEmail,
    tenants: data.tenants,
    activeTenantId,
    setActiveTenantId,
    writeTenantId,
    filterByTenant: (query) => applyTenantFilter(query, activeTenantId),
  };
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: PASS. (No existing consumer destructures `userEmail`, so nothing else needs updating
— adding an optional-in-practice field to a context value is additive.)

- [ ] **Step 3: Commit**

```bash
git add app/components/TenantProvider.tsx
git commit -m "feat: expose signed-in user's email from TenantProvider"
```

---

## Task 9: `lib/nav/navConfig.ts`

**Files:**
- Create: `lib/nav/navConfig.ts`

Pure data, no JSX — Console's own nav taxonomy (confirmed against its `NAV` array), which
already maps onto every real route in this app.

- [ ] **Step 1: Write the file**

```ts
// Console's nav taxonomy. Icon names are lucide-react export names (PascalCase),
// kept as strings here so this file stays pure data — AppShell maps them to
// actual icon components, so this config has zero React/JSX dependency.
export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: string;
};

export type NavGroup = {
  label: string | null;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ id: "dashboard", label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" }],
  },
  {
    label: "Operations",
    items: [
      { id: "jobs", label: "Jobs", href: "/jobs", icon: "ClipboardList" },
      { id: "pod", label: "Proof of delivery", href: "/pod", icon: "CircleCheck" },
      { id: "tracking", label: "Tracking", href: "/tracking", icon: "MapPin" },
      { id: "invoices", label: "Invoices", href: "/invoices", icon: "Receipt" },
      { id: "customers", label: "Customers", href: "/customers", icon: "Building2" },
      { id: "subcontractors", label: "Subcontractors", href: "/subcontractors", icon: "Users" },
    ],
  },
  {
    label: "Fleet",
    items: [
      { id: "vehicles", label: "Vehicles", href: "/vehicles", icon: "Truck" },
      { id: "drivers", label: "Drivers", href: "/drivers", icon: "User" },
      { id: "assets", label: "Assets", href: "/assets", icon: "Boxes" },
      { id: "maintenance", label: "Maintenance", href: "/maintenance", icon: "TriangleAlert" },
    ],
  },
  {
    label: "Compliance",
    items: [
      { id: "tachograph", label: "Tachograph", href: "/tachograph", icon: "Gauge" },
      { id: "telematics", label: "Telematics", href: "/telematics", icon: "Navigation" },
    ],
  },
  {
    label: "Insights",
    items: [{ id: "stats", label: "Stats", href: "/stats", icon: "ArrowUpRight" }],
  },
  {
    label: "Admin",
    items: [{ id: "settings", label: "Settings", href: "/settings", icon: "Settings" }],
  },
];
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add lib/nav/navConfig.ts
git commit -m "feat: add the Console nav taxonomy as pure config"
```

---

## Task 10: `lib/nav/shouldShowShell.ts` — the security guard, as tested pure logic

**Files:**
- Create: `lib/nav/shouldShowShell.ts`
- Create: `lib/nav/shouldShowShell.test.ts`

This is the highest-stakes file in the whole plan. **Correction, added after implementation
(caught by adversarial code review, then independently verified against `git show 91fa6b0`):
everywhere below that calls this "the fix for a nav-leak" is wrong.** 91fa6b0's own commit
message: "Signed-out visitors were never affected (the header hides when signed out), so this
is cosmetic, not an auth bypass." The real historical bug was an already-signed-in user seeing
a stray Dashboard link on `/login` — not an unauthenticated visitor seeing the internal nav.
That framing originated with me (Claude) during brainstorming and was never correct; it
propagated through this plan, the spec, and session memory before an adversarial review caught
it during Task 10. The guard itself is still worth building exactly as designed below — it's a
genuine fail-closed improvement over `AppHeader` regardless of the corrected history — so the
task steps are unchanged, only the surrounding narrative was wrong. Extracting it as a pure
function (rather than inline JSX conditionals in the component) means it can be tested
directly, without a component-testing library this repo doesn't have.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { shouldShowShell } from "./shouldShowShell";

describe("shouldShowShell", () => {
  it("hides on the public landing page regardless of status", () => {
    expect(shouldShowShell("/", "ready")).toBe(false);
    expect(shouldShowShell("/", "signed-out")).toBe(false);
  });

  it("hides on /login regardless of status — this is the exact case 91fa6b0 fixed", () => {
    expect(shouldShowShell("/login", "ready")).toBe(false);
    expect(shouldShowShell("/login", "signed-out")).toBe(false);
  });

  it("hides on every /super-admin/* route regardless of status", () => {
    expect(shouldShowShell("/super-admin", "ready")).toBe(false);
    expect(shouldShowShell("/super-admin/billing", "ready")).toBe(false);
  });

  it("hides on an app route when status is not ready — the fail-closed backstop", () => {
    expect(shouldShowShell("/jobs", "loading")).toBe(false);
    expect(shouldShowShell("/jobs", "signed-out")).toBe(false);
    expect(shouldShowShell("/jobs", "no-tenant")).toBe(false);
  });

  it("shows on an app route when signed in with a resolved tenant", () => {
    expect(shouldShowShell("/jobs", "ready")).toBe(true);
    expect(shouldShowShell("/dashboard", "ready")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run lib/nav/shouldShowShell.test.ts
```
Expected: FAIL — `shouldShowShell` is not defined / module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { TenantStatus } from "../tenant/context";

// Two independent checks, both required — this is the fix for 91fa6b0 ("Hide the
// app header on the login page"). Before that commit, only a pathname check
// existed and /login wasn't in it, so a signed-out visitor on /login saw the
// full internal nav. The status check is the fail-closed backstop: using
// `status !== "ready"` (rather than enumerating "loading"/"signed-out") means
// any future status value defaults to hidden too, not just the two known today.
export function shouldShowShell(pathname: string, status: TenantStatus): boolean {
  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) {
    return false;
  }
  return status === "ready";
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run lib/nav/shouldShowShell.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/nav/shouldShowShell.ts lib/nav/shouldShowShell.test.ts
git commit -m "feat: extract the AppShell visibility guard as tested pure logic"
```

---

## Task 11: `Stat` component

**Files:**
- Create: `components/Stat.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

type Tone = "positive" | "warning" | "danger" | "neutral";

const dotTone: Record<Tone, string> = {
  positive: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-ink-3",
};

const subTextTone: Record<Tone, string> = {
  positive: "text-success-strong",
  warning: "text-warning-strong",
  danger: "text-danger-strong",
  neutral: "text-ink-3",
};

type Props = {
  label: string;
  value: string;
  sub?: string;
  subTone?: Tone;
  onClick?: () => void;
};

export default function Stat({ label, value, sub, subTone = "neutral", onClick }: Props) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col items-start gap-1 rounded-lg border border-line bg-surface p-4 text-left",
        onClick && "cursor-pointer hover:border-primary-tint-border hover:shadow-sm",
      )}
    >
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <span className="font-mono text-2xl font-semibold tabular-nums text-ink">{value}</span>
      {sub ? (
        <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", subTextTone[subTone])}>
          <span aria-hidden className={cn("h-1.5 w-1.5 flex-shrink-0 rounded-full", dotTone[subTone])} />
          {sub}
        </span>
      ) : null}
    </Tag>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add components/Stat.tsx
git commit -m "feat: add Stat KPI-tile component"
```

---

## Task 12: `DataTable` component

**Files:**
- Create: `components/DataTable.tsx`

Generic table with the four-state pattern from Console's job board (loaded / loading skeleton
/ error with retry / empty with an action). Column rendering is a render-prop, so callers
control cell content without `DataTable` knowing about any specific data shape.

- [ ] **Step 1: Write the component**

```tsx
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type Column<T> = {
  header: string;
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
  className?: string;
};

export type DataTableState = "loading" | "error" | "empty" | "ready";

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  state: DataTableState;
  onRowClick?: (row: T) => void;
  skeletonRows?: number;
  errorMessage?: string;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
};

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  state,
  onRowClick,
  skeletonRows = 5,
  errorMessage = "Couldn't load this data.",
  onRetry,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
}: Props<T>) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            {columns.map((col) => (
              <th
                key={col.header}
                className={cn(
                  "px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-3",
                  col.align === "right" ? "text-right" : "text-left",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state === "loading"
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-b border-line last:border-0">
                  {columns.map((col) => (
                    <td key={col.header} className="px-4 py-3">
                      <span className="block h-3 w-3/4 animate-pulse rounded bg-surface-2" />
                    </td>
                  ))}
                </tr>
              ))
            : null}

          {state === "ready"
            ? rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-line last:border-0",
                    onRowClick && "cursor-pointer hover:bg-surface-2",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.header}
                      className={cn(
                        "px-4 py-3 align-middle",
                        col.align === "right" ? "text-right" : "text-left",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            : null}
        </tbody>
      </table>

      {state === "error" ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-ink">{errorMessage}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex h-9 items-center rounded-md border border-line-strong px-3 text-sm font-semibold text-ink hover:bg-surface-2"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {state === "empty" ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p className="text-sm font-semibold text-ink">{emptyTitle}</p>
          {emptyDescription ? <p className="max-w-sm text-sm text-ink-2">{emptyDescription}</p> : null}
          {emptyAction ? <div className="mt-2">{emptyAction}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add components/DataTable.tsx
git commit -m "feat: add generic DataTable with loading/error/empty states"
```

---

## Task 13: `Modal` component

**Files:**
- Create: `components/Modal.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
};

export default function Modal({ open, onClose, title, children, footer }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/55" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-lg bg-surface p-6 shadow-lg outline-none"
      >
        <h2 id="modal-title" className="text-lg font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-3 text-sm text-ink-2">{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
```

Note: `bg-ink/55` (an opacity modifier on a token color) is flagged in this codebase's own
Tailwind config comments as compiling to **nothing** — token colors are plain `var()` strings,
so Tailwind can't synthesize alpha from them (`tailwind.config.ts:10-12`). Use a literal
instead:

```tsx
        <div className="absolute inset-0 bg-[rgba(11,18,32,0.55)]" onClick={onClose} aria-hidden />
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add components/Modal.tsx
git commit -m "feat: add generic Modal dialog primitive"
```

---

## Task 14: `AppShell` — replaces `AppHeader`

**Correction (caught by code review during Task 15, fixed retroactively here): the `<aside>`
below is written with `sticky top-0` added to its className.** The original version of this
task (and the code actually built first) omitted `sticky`, which is a real layout bug: the
aside has an explicit `height: 100vh` (via `h-screen`), so flexbox's `align-items: stretch`
never touches it, and with no sticky/fixed positioning it scrolls out of the viewport on any
page taller than one screen — which is most of this app's real interior pages (jobs, dashboard,
invoices). `sticky top-0` pins it to the viewport top as the page scrolls, matching the
pattern Console's own mockup uses on its sidebar. Fixed in the actual implementation as part
of Task 15's review cycle; this plan text is corrected to match.

**Files:**
- Create: `app/components/AppShell.tsx`

Console's header also includes a search input and a notifications bell — both omitted here
deliberately: neither has a backend today, and shipping a search box that doesn't search or a
bell with no notifications is a half-finished feature, not a visual match. Add them when
there's something real behind them.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, ClipboardList, CircleCheck, MapPin, Receipt, Building2, Users,
  Truck, User, Boxes, TriangleAlert, Gauge, Navigation, ArrowUpRight, Settings, LogOut,
  type LucideIcon,
} from "lucide-react";
import { useTenant } from "./TenantProvider";
import TenantSelector from "./TenantSelector";
import Logo from "../../components/Logo";
import { NAV_GROUPS } from "../../lib/nav/navConfig";
import { shouldShowShell } from "../../lib/nav/shouldShowShell";
import { createClient } from "../../lib/supabase/browser";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, ClipboardList, CircleCheck, MapPin, Receipt, Building2, Users,
  Truck, User, Boxes, TriangleAlert, Gauge, Navigation, ArrowUpRight, Settings,
};

export default function AppShell() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, role, userEmail } = useTenant();

  if (!shouldShowShell(pathname, status)) return null;

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const initials = (userEmail ?? "?").slice(0, 2).toUpperCase();

  return (
    <aside className="sticky top-0 flex h-screen w-[220px] flex-none flex-col bg-chrome">
      <div className="flex flex-none items-center gap-2 border-b border-chrome-border px-4 py-4">
        <Logo variant="tile" size={28} />
        <span className="text-sm font-semibold text-chrome-text-strong">TMS Wizzard</span>
      </div>

      <nav aria-label="Primary" className="flex flex-1 flex-col gap-1 overflow-y-auto p-2.5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label ?? "root"}>
            {group.label ? (
              <div className="px-2.5 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                {group.label}
              </div>
            ) : null}
            {group.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = pathname === item.href;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-semibold no-underline " +
                    (active
                      ? "bg-primary text-white"
                      : "text-chrome-text hover:bg-chrome-raised hover:text-chrome-text-strong")
                  }
                >
                  <Icon size={16} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex flex-none items-center gap-2.5 border-t border-chrome-border p-3.5">
        <span
          aria-hidden
          className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-primary text-xs font-semibold text-white"
        >
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-chrome-text-strong">
            {userEmail ?? "Signed in"}
          </span>
          {role === "super_admin" ? (
            <Link href="/super-admin" className="block truncate text-xs font-medium text-primary-tint-border no-underline hover:text-white">
              Super Admin
            </Link>
          ) : null}
        </span>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-chrome-text hover:bg-chrome-raised hover:text-chrome-text-strong"
        >
          <LogOut size={15} aria-hidden />
        </button>
      </div>
      <div className="border-t border-chrome-border p-2">
        <TenantSelector />
      </div>
    </aside>
  );
}
```

Note: this replaces `AppHeader`'s top-bar layout with a sidebar (Console's actual shape).
Because `AppShell` is now a flex sibling of page content rather than a stacked top bar,
`app/layout.tsx`'s body needs a `display: flex` wrapper — see Task 15, Step 1.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/components/AppShell.tsx
git commit -m "feat: add AppShell (Console-matching sidebar, replaces AppHeader)"
```

---

## Task 15: Wire `AppShell` into the root layout, delete `AppHeader`

**Files:**
- Modify: `app/layout.tsx`
- Delete: `app/components/AppHeader.tsx`

- [ ] **Step 1: Swap the import and mount, add the flex wrapper**

In `app/layout.tsx`, change:
```tsx
import AppHeader from "./components/AppHeader";
```
to:
```tsx
import AppShell from "./components/AppShell";
```

Change the `<body>` block from:
```tsx
      <body
        style={{
          margin: 0,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: "#0f172a",
          color: "#0f172a",
        }}
      >
        <TenantProvider>
          <AppHeader />
          {children}
        </TenantProvider>
      </body>
```
to:
```tsx
      <body
        style={{
          margin: 0,
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: "#0f172a",
          color: "#0f172a",
        }}
      >
        <TenantProvider>
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <AppShell />
            <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
          </div>
        </TenantProvider>
      </body>
```

This wrapper is intentionally plain inline style, not Tailwind classes: it wraps every page
in the app including the ~13 still-legacy-styled ones, which don't carry the `ds` class, so
Tailwind utilities on this element would silently do nothing on those pages (Preflight is
off). Inline style is the one thing guaranteed to work everywhere. When `AppShell` renders
`null` (public/exempt routes, per `shouldShowShell`), the flex wrapper still exists but costs
nothing — a single empty flex item.

- [ ] **Step 2: Delete `AppHeader.tsx`**

```bash
git rm app/components/AppHeader.tsx
```

- [ ] **Step 3: Typecheck + build**

```bash
npm run typecheck
npm run build
```
Expected: both PASS. If the build fails on a lingering `AppHeader` import anywhere, grep for
it: `grep -rn "AppHeader" app/ components/` should return nothing after this task.

- [ ] **Step 4: Manual check — this is the security-critical one**

```bash
npm run dev
```
- Visit `/` and `/login` signed out: no sidebar.
- Visit `/jobs` (or any app route) signed out: redirected to `/login` by `TenantGate` (unchanged), and no sidebar flashes first.
- Sign in, visit `/jobs`: sidebar renders, correct nav groups, sign-out button present and working.
- Visit `/super-admin` (as a super_admin test account): no sidebar (super-admin keeps its own separate layout/header, untouched by this plan).

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: mount AppShell in root layout, remove AppHeader"
```

---

## Task 16: `lib/dashboard/aggregate.ts` — pure logic for the dashboard

**Files:**
- Create: `lib/dashboard/aggregate.ts`
- Create: `lib/dashboard/aggregate.test.ts`

Two pure functions, both taking "now"/"today" as a parameter rather than computing it
internally — keeps them deterministic and testable without mocking the clock.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { buildNeedsAttention, buildRevenueLast7Days } from "./aggregate";

describe("buildNeedsAttention", () => {
  const now = new Date("2026-08-11T12:00:00Z");

  it("merges overdue PODs and overdue invoices, oldest first", () => {
    const items = buildNeedsAttention(
      [{ stopId: "s1", jobRef: "TMS-1", plannedAt: "2026-08-09T08:00:00Z" }],
      [{ id: "i1", invoiceNumber: "INV-1", dueDate: "2026-08-10", total: 100 }],
      now,
    );
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("pod-s1"); // planned 2 days ago, oldest
    expect(items[1].id).toBe("invoice-i1");
  });

  it("returns an empty list when nothing is overdue", () => {
    expect(buildNeedsAttention([], [], now)).toEqual([]);
  });
});

describe("buildRevenueLast7Days", () => {
  const today = new Date("2026-08-11T00:00:00Z");

  it("returns exactly 7 days, oldest first, summing same-day invoices", () => {
    const days = buildRevenueLast7Days(
      [
        { issueDate: "2026-08-11", total: 100 },
        { issueDate: "2026-08-11", total: 50 },
        { issueDate: "2026-08-05", total: 10 },
      ],
      today,
    );
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe("2026-08-11");
    expect(days[6].total).toBe(150);
    expect(days[0].date).toBe("2026-08-05");
    expect(days[0].total).toBe(10);
  });

  it("zeroes days with no paid invoices", () => {
    const days = buildRevenueLast7Days([], today);
    expect(days.every((d) => d.total === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run lib/dashboard/aggregate.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
export type AttentionItem = {
  id: string;
  title: string;
  meta: string;
  ageHours: number;
  href: string;
};

export function buildNeedsAttention(
  overduePods: { stopId: string; jobRef: string; plannedAt: string }[],
  overdueInvoices: { id: string; invoiceNumber: string; dueDate: string; total: number }[],
  now: Date,
): AttentionItem[] {
  const podItems: AttentionItem[] = overduePods.map((p) => ({
    id: `pod-${p.stopId}`,
    title: `${p.jobRef} — POD awaiting`,
    meta: `since ${new Date(p.plannedAt).toLocaleDateString("en-GB")}`,
    ageHours: (now.getTime() - new Date(p.plannedAt).getTime()) / 36e5,
    href: "/pod",
  }));
  const invoiceItems: AttentionItem[] = overdueInvoices.map((i) => ({
    id: `invoice-${i.id}`,
    title: `${i.invoiceNumber} — overdue`,
    meta: `£${i.total.toFixed(2)} · due ${new Date(i.dueDate).toLocaleDateString("en-GB")}`,
    ageHours: (now.getTime() - new Date(i.dueDate).getTime()) / 36e5,
    href: "/invoices",
  }));
  return [...podItems, ...invoiceItems].sort((a, b) => b.ageHours - a.ageHours);
}

export type RevenueDay = { date: string; label: string; total: number };

export function buildRevenueLast7Days(
  paidInvoices: { issueDate: string; total: number }[],
  today: Date,
): RevenueDay[] {
  const days: RevenueDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const total = paidInvoices
      .filter((inv) => inv.issueDate === key)
      .reduce((sum, inv) => sum + inv.total, 0);
    days.push({ date: key, label: d.toLocaleDateString("en-GB", { weekday: "short" }), total });
  }
  return days;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run lib/dashboard/aggregate.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/aggregate.ts lib/dashboard/aggregate.test.ts
git commit -m "feat: add pure dashboard aggregation logic (needs-attention, revenue)"
```

---

## Task 17: `/dashboard` — data layer + Console UI

**Correction history on the invoices column name (read this one carefully, it went back and
forth):** the original code used `total`, grounded in `schema_dump.json`. During review, that
was changed to `total_amount` on the theory that `schema_dump.json` was stale and
`app/invoices/page.tsx`/`app/stats/page.tsx` (which reference `total_amount`) were the more
trustworthy live evidence. **That "fix" was wrong.** Caught by actually signing into a live
dev server and hitting the real database: Postgres returned
`"column invoices.total_amount does not exist"`. Verified directly with the service-role key
(bypasses RLS, so not a permissions artifact): `select total` succeeds, `select total_amount`
fails with code `42703`. **The real column is `total`** — `schema_dump.json` was right.
`app/invoices/page.tsx` and `app/stats/page.tsx` referencing `total_amount` means those two
pre-existing pages (untouched by this plan) have the same bug and are currently broken in the
live app — a separate, pre-existing issue, not introduced by this session and not fixed here,
flagged separately for Ethan. The code below uses `total`, the correct name. Because
Supabase's browser client here isn't typed against a generated schema, this class of error is
invisible to `tsc`/`next build` and only surfaces at runtime — which is exactly why the
review-time "fix" wasn't caught until a real sign-in happened. **Lesson: cross-referencing
sibling app files is not a substitute for querying the actual database** — two files agreeing
with each other doesn't make them right if they share the same mistake. **Also corrected in
the same pass:** the "PODs awaiting" KPI was undercounting, because a `planned_at`-not-null
filter needed only for `buildNeedsAttention`'s age computation was applied upstream of the
KPI count too, silently dropping any overdue stop on a job with no `scheduled_date`. That part
of the original correction was right and is reflected in the code below.

**Files:**
- Modify: `app/dashboard/page.tsx` (full rewrite: static server component → `"use client"`)

Reminder of the one approved product-behavior stand-in from the spec: **"On the road"** reads
`vehicle_id IS NOT NULL` on today's planned jobs, not live position — comment it as such so a
future TomTom-tracking pass can find it.

- [ ] **Step 1: Write the full page**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/browser";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import Stat from "../../components/Stat";
import DataTable, { type Column } from "../../components/DataTable";
import { buildNeedsAttention, buildRevenueLast7Days, type AttentionItem, type RevenueDay } from "../../lib/dashboard/aggregate";

type Kpis = {
  jobsToday: number;
  unassigned: number;
  onTheRoad: number;
  podsAwaiting: number;
  overdueInvoicesTotal: number;
};

type TodayJobRow = {
  id: string;
  reference: string;
  customerName: string;
  status: string;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export default function DashboardPage() {
  const supabase = createClient();
  const tenant = useTenant();

  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [kpis, setKpis] = useState<Kpis>({
    jobsToday: 0, unassigned: 0, onTheRoad: 0, podsAwaiting: 0, overdueInvoicesTotal: 0,
  });
  const [todayJobs, setTodayJobs] = useState<TodayJobRow[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [revenue, setRevenue] = useState<RevenueDay[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      const today = todayIso();

      const jobsTodayQuery = tenant.filterByTenant(
        supabase.from("jobs").select("id, reference, status, vehicle_id, driver_id, customer_id, customers(name)"),
      ).eq("scheduled_date", today);

      const { data: jobsTodayData, error: jobsTodayError } = await jobsTodayQuery;

      // Filtered client-side rather than via a PostgREST embedded-relation filter
      // (`.eq("jobs.status", ...)`) — matches this codebase's existing convention
      // (see app/invoices/page.tsx's "ready to invoice" computation) of doing this
      // kind of cross-table filter after fetch, rather than relying on the less
      // common embedded-filter query syntax.
      const { data: overduePodStopsRaw, error: podError } = await tenant
        .filterByTenant(
          supabase
            .from("job_stops")
            .select("id, planned_at, jobs ( reference, status )")
            .eq("type", "delivery")
            .neq("pod_status", "delivered"),
        );
      const overduePodStops = (overduePodStopsRaw ?? []).filter(
        (r: any) => r.jobs?.status === "planned",
      );

      const { data: overdueInvoices, error: invoiceError } = await tenant
        .filterByTenant(supabase.from("invoices").select("id, invoice_number, due_date, total, status"))
        .neq("status", "paid")
        .lt("due_date", today);

      const sevenDaysAgo = (() => {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        return d.toISOString().slice(0, 10);
      })();
      const { data: paidInvoices, error: revenueError } = await tenant
        .filterByTenant(supabase.from("invoices").select("issue_date, total, status"))
        .eq("status", "paid")
        .gte("issue_date", sevenDaysAgo);

      if (cancelled) return;

      if (jobsTodayError || podError || invoiceError || revenueError) {
        setState("error");
        return;
      }

      const jobsToday = jobsTodayData ?? [];
      const unassigned = jobsToday.filter(
        (j) => j.status === "planned" && (!j.vehicle_id || !j.driver_id),
      ).length;
      // Stand-in until TomTom tracking lands (see docs/superpowers/specs/
      // 2026-08-11-console-design-system-phase1-2-design.md): "rostered today",
      // not live vehicle position.
      const onTheRoad = jobsToday.filter((j) => j.status === "planned" && j.vehicle_id).length;

      // Two different concerns: the KPI counts every overdue delivery stop regardless of
      // whether planned_at is set, but buildNeedsAttention computes an age from planned_at
      // and would produce an Invalid Date/NaN on a null one — so the attention-list feed
      // gets a separate, filtered list rather than gating the count on the same condition.
      const overduePodsForAttention = overduePodStops
        .filter((r: any) => r.planned_at)
        .map((r: any) => ({ stopId: r.id, jobRef: r.jobs?.reference ?? "?", plannedAt: r.planned_at as string }));

      const invoiceRows = overdueInvoices ?? [];
      const overdueInvoicesTotal = invoiceRows.reduce((sum, inv) => sum + Number(inv.total), 0);

      setKpis({
        jobsToday: jobsToday.length,
        unassigned,
        onTheRoad,
        podsAwaiting: overduePodStops.length,
        overdueInvoicesTotal,
      });

      setTodayJobs(
        jobsToday.slice(0, 8).map((j) => ({
          id: j.id,
          reference: j.reference,
          customerName: (j.customers as unknown as { name: string } | null)?.name ?? "—",
          status: j.status,
        })),
      );

      setAttention(
        buildNeedsAttention(
          overduePodsForAttention,
          invoiceRows.map((i) => ({
            id: i.id, invoiceNumber: i.invoice_number, dueDate: i.due_date, total: Number(i.total),
          })),
          new Date(),
        ),
      );

      setRevenue(
        buildRevenueLast7Days(
          (paidInvoices ?? []).map((i) => ({ issueDate: i.issue_date, total: Number(i.total) })),
          new Date(),
        ),
      );

      setState("ready");
    }

    load();
    return () => { cancelled = true; };
  }, [tenant.activeTenantId]);

  const jobColumns: Column<TodayJobRow>[] = [
    { header: "Reference", cell: (r) => <span className="font-mono text-sm font-medium text-ink">{r.reference}</span> },
    { header: "Customer", cell: (r) => r.customerName },
    {
      header: "Status",
      cell: (r) => (
        <span className="inline-flex items-center rounded-full bg-primary-tint px-2.5 py-0.5 text-xs font-semibold text-primary-deep">
          {r.status}
        </span>
      ),
    },
  ];

  const maxRevenue = Math.max(1, ...revenue.map((d) => d.total));

  return (
    <TenantGate>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>

        {state === "error" ? (
          <div className="mt-6 rounded-lg border border-danger-border bg-danger-tint p-4 text-sm text-danger-strong">
            Couldn't load the dashboard. Refresh to try again.
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Jobs today" value={state === "loading" ? "—" : String(kpis.jobsToday)} />
          <Stat
            label="Unassigned"
            value={state === "loading" ? "—" : String(kpis.unassigned)}
            sub={kpis.unassigned > 0 ? "needs a vehicle/driver" : undefined}
            subTone="warning"
          />
          <Stat label="On the road" value={state === "loading" ? "—" : String(kpis.onTheRoad)} sub="rostered today" />
          <Stat
            label="PODs awaiting"
            value={state === "loading" ? "—" : String(kpis.podsAwaiting)}
            sub={kpis.podsAwaiting > 0 ? "open delivery stops" : undefined}
            subTone="warning"
          />
          <Stat
            label="Overdue invoices"
            value={state === "loading" ? "—" : money(kpis.overdueInvoicesTotal)}
            sub={kpis.overdueInvoicesTotal > 0 ? "past due" : undefined}
            subTone="danger"
          />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Today's jobs</h2>
              <Link href="/jobs" className="text-sm font-semibold text-primary hover:underline">
                View all
              </Link>
            </div>
            <DataTable
              columns={jobColumns}
              rows={todayJobs}
              rowKey={(r) => r.id}
              state={state === "loading" ? "loading" : state === "error" ? "error" : todayJobs.length ? "ready" : "empty"}
              emptyTitle="No jobs scheduled today"
            />
          </section>

          <section className="flex flex-col gap-4">
            <div className="rounded-lg border border-line bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">Needs attention</h2>
              {attention.length === 0 ? (
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

            <div className="rounded-lg border border-line bg-surface p-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
                Revenue · last 7 days
              </h2>
              <div className="flex h-16 items-end gap-1.5">
                {revenue.map((d) => (
                  <div key={d.date} className="flex-1" title={`${d.label}: ${money(d.total)}`}>
                    <div
                      className="w-full rounded-t bg-primary"
                      style={{ height: `${Math.max(4, (d.total / maxRevenue) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </TenantGate>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Fix any Supabase embedded-select typing issues the same way the rest of the codebase does
(explicit `as unknown as ...` casts, matching the pattern already used elsewhere for embedded
relations — see `jobsTodayData`'s `customers` field above for the pattern to copy for any
other embed the compiler complains about).

- [ ] **Step 3: Manual check**

```bash
npm run dev
```
Sign in, visit `/dashboard`: KPI tiles show real numbers (not the old static 14-card grid),
today's jobs table populates, needs-attention list populates if there are overdue PODs/
invoices in the test data, revenue bars render (likely all zero/flat on fresh test data,
which is correct).

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: rebuild /dashboard with a real tenant-scoped data layer"
```

---

## Task 18: `app/jobs/StopCard.tsx` — extract the nested stop + POD sub-form

**Files:**
- Create: `app/jobs/StopCard.tsx`
- Modify: `app/components/PodLink.tsx` (token colors, small step inside this task)

- [ ] **Step 1: Restyle `PodLink`'s hardcoded colors**

`PodLink.tsx` uses raw hex (`#111827`, `#b91c1c`) instead of tokens — fix while it's being
touched by this rebuild.

**Correction (caught by code review, then applied during implementation): use `var(--primary)`
and `var(--danger-strong)`, not literal hex.** The original version of this step (below,
superseded) used literal hex values reasoned as "matching PodLink's existing self-contained
inline-style architecture" — but that reasoning was wrong: a hardcoded hex is a snapshot of a
token's *current* value, not a reference to it, so it silently goes stale the moment the token
changes (e.g. a future dark-mode pass). `:root` tokens in this app are deliberately global
(not scoped to `.ds`), so nothing prevents `PodLink`'s existing `CSSProperties` objects from
referencing `var(--primary)` directly — no need to restructure it into Tailwind classNames,
just swap the literal hex for the variable reference. Also use `--danger-strong`, not
`--danger`, for the error text — matching this codebase's established convention for
standalone error copy (`Field.tsx`, `Stat.tsx` both use the `-strong` variant). Change:
```tsx
const linkButtonStyle: CSSProperties = {
  color: "#111827", fontWeight: 600, cursor: "pointer",
  textDecoration: "underline", background: "none", border: "none", padding: 0,
};

const externalStyle: CSSProperties = { color: "#111827", fontWeight: 600 };
```
to:
```tsx
const linkButtonStyle: CSSProperties = {
  color: "var(--primary)", fontWeight: 600, cursor: "pointer",
  textDecoration: "underline", background: "none", border: "none", padding: 0,
};

const externalStyle: CSSProperties = { color: "var(--primary)", fontWeight: 600 };
```
And the failure message color:
```tsx
        <span style={{ color: "#b91c1c", marginLeft: 8 }}>Could not open the file.</span>
```
to:
```tsx
        <span style={{ color: "var(--danger-strong)", marginLeft: 8 }}>Could not open the file.</span>
```

- [ ] **Step 2: Write `StopCard`**

Preserves the exact fields and exact `savePod` call shape from the current
`app/jobs/page.tsx:885-969` — only the JSX/classes change.

Note: no `ReactNode` import needed (an earlier draft had one; it was unused and removed) and
`Stop`/`PodFormState` are exported — Task 21's orchestrator will want the same shapes without
hand-duplicating them.

```tsx
import Field from "../../components/Field";
import Button from "../../components/Button";
import PodLink from "../components/PodLink";

export type Stop = {
  id: string;
  stop_order: number;
  type: "collection" | "delivery";
  address_line: string;
  city: string | null;
  postcode: string | null;
  status: string | null;
  pod_status: string | null;
  recipient_name: string | null;
  delivered_at: string | null;
  pod_notes: string | null;
  pod_photo_url: string | null;
};

export type PodFormState = { recipient_name: string; pod_notes: string; pod_photo_url: string };

type Props = {
  stop: Stop;
  podForm: PodFormState | undefined;
  onPodFieldChange: (stopId: string, field: keyof PodFormState, value: string) => void;
  onMarkDelivered: (stopId: string) => void;
};

export default function StopCard({ stop, podForm, onPodFieldChange, onMarkDelivered }: Props) {
  const form: PodFormState = podForm ?? { recipient_name: "", pod_notes: "", pod_photo_url: "" };

  return (
    <div className="rounded-md border border-line bg-surface-2 p-3.5">
      <div className="text-sm">
        <span className="font-semibold text-ink">
          {stop.stop_order}. {stop.type}
        </span>{" "}
        <span className="text-ink-2">
          {stop.address_line}
          {stop.city ? `, ${stop.city}` : ""}
          {stop.postcode ? `, ${stop.postcode}` : ""}
        </span>
      </div>

      <div className="mt-1.5 text-xs text-ink-3">
        Stop status: {stop.status || "-"} · POD: {stop.pod_status || "pending"}
      </div>

      {stop.delivered_at ? (
        <div className="mt-1.5 text-xs text-ink-3">
          Delivered at: {new Date(stop.delivered_at).toLocaleString("en-GB")}
        </div>
      ) : null}

      {stop.recipient_name ? (
        <div className="mt-1.5 text-sm text-ink">Recipient: {stop.recipient_name}</div>
      ) : null}

      {stop.pod_notes ? <div className="mt-1.5 text-sm text-ink">Notes: {stop.pod_notes}</div> : null}

      {stop.pod_photo_url ? (
        <div className="mt-1.5">
          <PodLink value={stop.pod_photo_url} label="View POD" />
        </div>
      ) : null}

      {stop.type === "delivery" && stop.pod_status !== "delivered" ? (
        <div className="mt-3 grid max-w-md gap-3">
          <Field
            id={`recipient-${stop.id}`}
            label="Recipient name"
            value={form.recipient_name}
            onChange={(e) => onPodFieldChange(stop.id, "recipient_name", e.target.value)}
          />
          <Field
            id={`photo-${stop.id}`}
            label="POD photo URL"
            value={form.pod_photo_url}
            onChange={(e) => onPodFieldChange(stop.id, "pod_photo_url", e.target.value)}
          />
          <Field
            id={`notes-${stop.id}`}
            label="POD notes"
            value={form.pod_notes}
            onChange={(e) => onPodFieldChange(stop.id, "pod_notes", e.target.value)}
          />
          <div>
            <Button type="button" onClick={() => onMarkDelivered(stop.id)}>
              Mark Delivered
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npm run typecheck
git add app/jobs/StopCard.tsx app/components/PodLink.tsx
git commit -m "refactor: extract StopCard from jobs page, restyle onto tokens"
```

---

## Task 19: `app/jobs/JobForm.tsx` — extract the create/edit form

**Files:**
- Create: `app/jobs/JobForm.tsx`

Preserves the exact field set, exact dynamic add/remove-stop behavior, and exact submit
handler signature from `app/jobs/page.tsx:560-774` — only the JSX/classes change. The parent
(`page.tsx`, Task 21) still owns all the state and validation; this component is presentation
only, taking the current form state and callbacks as props.

- [ ] **Step 1: Write the component**

```tsx
import Field from "../../components/Field";
import Button from "../../components/Button";

type Stop = { type: "collection" | "delivery"; address_line: string; city: string; postcode: string };

type FormState = {
  reference: string;
  scheduled_date: string;
  customer_id: string;
  vehicle_id: string;
  driver_id: string;
  customer_price: string;
  subcontractor_id: string;
  subcontractor_cost: string;
  stops: Stop[];
};

type Option = { id: string; label: string };

type Props = {
  form: FormState;
  editingJobId: string | null;
  loading: boolean;
  customers: Option[];
  vehicles: Option[];
  drivers: Option[];
  subcontractors: Option[];
  onFieldChange: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  onStopChange: (index: number, field: keyof Stop, value: string) => void;
  onAddStop: (type: Stop["type"]) => void;
  onRemoveStop: (index: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancelEdit: () => void;
};

function StopRow({
  stop, index, onChange, onRemove,
}: { stop: Stop; index: number; onChange: (field: keyof Stop, value: string) => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        id={`stop-${stop.type}-${index}-address`}
        label="Address"
        value={stop.address_line}
        onChange={(e) => onChange("address_line", e.target.value)}
        wrapperClassName="min-w-[220px] flex-1"
      />
      <Field
        id={`stop-${stop.type}-${index}-city`}
        label="City"
        value={stop.city}
        onChange={(e) => onChange("city", e.target.value)}
        wrapperClassName="w-40"
      />
      <Field
        id={`stop-${stop.type}-${index}-postcode`}
        label="Postcode"
        value={stop.postcode}
        onChange={(e) => onChange("postcode", e.target.value)}
        wrapperClassName="w-32"
      />
      <Button type="button" variant="secondary" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

export default function JobForm({
  form, editingJobId, loading, customers, vehicles, drivers, subcontractors,
  onFieldChange, onStopChange, onAddStop, onRemoveStop, onSubmit, onCancelEdit,
}: Props) {
  return (
    <form onSubmit={onSubmit} className="grid gap-5 rounded-lg border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold text-ink">{editingJobId ? "Edit Job" : "Create Job"}</h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field id="job-reference" label="Reference" value={form.reference} onChange={(e) => onFieldChange("reference", e.target.value)} />
        <Field id="job-date" label="Scheduled date" type="date" value={form.scheduled_date} onChange={(e) => onFieldChange("scheduled_date", e.target.value)} />
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-2">Customer</span>
          <select
            className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.customer_id}
            onChange={(e) => onFieldChange("customer_id", e.target.value)}
          >
            <option value="">Select customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-2">Vehicle</span>
          <select
            className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.vehicle_id}
            onChange={(e) => onFieldChange("vehicle_id", e.target.value)}
          >
            <option value="">Select vehicle</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-2">Driver</span>
          <select
            className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.driver_id}
            onChange={(e) => onFieldChange("driver_id", e.target.value)}
          >
            <option value="">Select driver</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <Field id="job-price" label="Customer price" type="number" step="0.01" value={form.customer_price} onChange={(e) => onFieldChange("customer_price", e.target.value)} />
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-2">Subcontractor</span>
          <select
            className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.subcontractor_id}
            onChange={(e) => onFieldChange("subcontractor_id", e.target.value)}
          >
            <option value="">Select subcontractor</option>
            {subcontractors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <Field id="job-subcost" label="Subcontractor cost" type="number" step="0.01" value={form.subcontractor_cost} onChange={(e) => onFieldChange("subcontractor_cost", e.target.value)} />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Collection stops</h3>
        <div className="grid gap-2">
          {form.stops.map((stop, index) =>
            stop.type === "collection" ? (
              <StopRow key={`collection-${index}`} stop={stop} index={index} onChange={(f, v) => onStopChange(index, f, v)} onRemove={() => onRemoveStop(index)} />
            ) : null,
          )}
        </div>
        <Button type="button" variant="ghost" className="mt-2" onClick={() => onAddStop("collection")}>
          + Add collection stop
        </Button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Delivery stops</h3>
        <div className="grid gap-2">
          {form.stops.map((stop, index) =>
            stop.type === "delivery" ? (
              <StopRow key={`delivery-${index}`} stop={stop} index={index} onChange={(f, v) => onStopChange(index, f, v)} onRemove={() => onRemoveStop(index)} />
            ) : null,
          )}
        </div>
        <Button type="button" variant="ghost" className="mt-2" onClick={() => onAddStop("delivery")}>
          + Add delivery stop
        </Button>
      </div>

      <div className="flex gap-3">
        <Button type="submit" loading={loading}>
          {editingJobId ? "Update job" : "Add job"}
        </Button>
        {editingJobId ? (
          <Button type="button" variant="secondary" onClick={onCancelEdit}>
            Cancel edit
          </Button>
        ) : null}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add app/jobs/JobForm.tsx
git commit -m "refactor: extract JobForm from jobs page, restyle onto tokens"
```

---

## Task 20: `app/jobs/DeleteJobDialog.tsx` — `Modal`-based confirm

**Files:**
- Create: `app/jobs/DeleteJobDialog.tsx`

Replaces `window.confirm("Delete this job and all linked stops?")` with a styled confirm —
same yes/no gate, same copy, just not a native browser dialog. No behavior change: the parent
still only calls the delete handler when the user explicitly confirms.

- [ ] **Step 1: Write the component**

```tsx
import Modal from "../../components/Modal";
import Button from "../../components/Button";

type Props = {
  open: boolean;
  jobReference: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function DeleteJobDialog({ open, jobReference, onCancel, onConfirm }: Props) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={`Delete ${jobReference}?`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </>
      }
    >
      This deletes the job and all of its linked stops. This can't be undone.
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npm run typecheck
git add app/jobs/DeleteJobDialog.tsx
git commit -m "feat: replace jobs' window.confirm with a styled DeleteJobDialog"
```

---

## Task 21: `app/jobs/page.tsx` — rewire the orchestrator

**Files:**
- Modify: `app/jobs/page.tsx` (full rewrite)

**Why this stays a card-per-job layout, not `DataTable`:** Console's job board is a flat
table with a click-through detail drawer, but the real app has no per-job detail route or
drawer concept — every field (customer, vehicle, driver, margin, all stops with their POD
sub-forms) is already always visible on the card. Switching to a flat table would mean either
hiding the stops behind a click (a real behavior change, not just a restyle) or cramming a
nested stop list into a table cell. Keeping the card shape, restyled, is the honest "same
behavior, new look" choice; `DataTable` gets its first real use in this plan on `/dashboard`
and remains available for the Phase 2 pages, which genuinely are flat lists.

Also **not** ported from the Console prototype into this real page: an assign dialog, a job
detail drawer, tabs, search, and date filtering. None of these exist in the current app (no
separate "assign" step — vehicle/driver are just form fields; no per-job detail view; no
filtering at all) — adding them would be new functionality, not a restyle, and the spec's
Non-goals rule that out for this pass.

- [ ] **Step 1: Write the full page**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";
import { JobPageValidation, CollectionStopValidation, DeliveryStopValidation } from "../../lib/supabase/validation/job";
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
import JobForm from "./JobForm";
import StopCard from "./StopCard";
import DeleteJobDialog from "./DeleteJobDialog";
import Button from "../../components/Button";

const emptyStop = (type: "collection" | "delivery") => ({ type, address_line: "", city: "", postcode: "" });

function formatMoney(value: any) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value));
}

export default function JobsPage() {
  const supabase = createClient();
  const tenant = useTenant();

  const [jobs, setJobs] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [subcontractors, setSubcontractors] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [podForms, setPodForms] = useState<Record<string, any>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; reference: string } | null>(null);

  const [form, setForm] = useState({
    reference: "", scheduled_date: "", customer_id: "", vehicle_id: "", driver_id: "",
    customer_price: "", subcontractor_id: "", subcontractor_cost: "",
    stops: [emptyStop("collection"), emptyStop("delivery")],
  });

  // loadData / saveJob / deleteJob / savePod below are byte-identical in logic to the
  // pre-rebuild app/jobs/page.tsx — only extracted from the same file, not rewritten.
  // See docs/superpowers/plans/2026-08-11-console-foundation-hero-dashboard-jobs.md
  // Task 21 for the "why nothing here changed" note.

  async function loadData() {
    setMessage("");
    const jobsQuery = supabase.from("jobs").select(`
        id, reference, status, scheduled_date, customer_id, vehicle_id, driver_id,
        customer_price, subcontractor_id, subcontractor_cost,
        customers ( name ), vehicles ( registration ), drivers ( name ),
        subcontractors ( name, vehicle_reg, driver_name ),
        job_stops ( id, stop_order, type, address_line, city, postcode, status, pod_status, recipient_name, delivered_at, pod_notes, pod_photo_url )
      `);

    const { data: jobsData, error: jobsError } = await tenant.filterByTenant(jobsQuery).order("created_at", { ascending: false });
    const { data: vehicleData, error: vehicleError } = await tenant.filterByTenant(supabase.from("vehicles").select("id, registration")).eq("active", true).order("registration", { ascending: true });
    const { data: driverData, error: driverError } = await tenant.filterByTenant(supabase.from("drivers").select("id, name")).eq("active", true).order("name", { ascending: true });
    const { data: customerData, error: customerError } = await tenant.filterByTenant(supabase.from("customers").select("id, name")).eq("active", true).order("name", { ascending: true });
    const { data: subcontractorData, error: subcontractorError } = await tenant.filterByTenant(supabase.from("subcontractors").select("id, name, vehicle_reg, driver_name")).eq("active", true).order("name", { ascending: true });

    if (jobsError) { setMessage(`Jobs load error: ${jobsError.message}`); return; }
    if (vehicleError) { setMessage(`Vehicles load error: ${vehicleError.message}`); return; }
    if (driverError) { setMessage(`Drivers load error: ${driverError.message}`); return; }
    if (customerError) { setMessage(`Customers load error: ${customerError.message}`); return; }
    if (subcontractorError) { setMessage(`Subcontractors load error: ${subcontractorError.message}`); return; }

    const normalizedJobs = (jobsData || []).map((job: any) => ({
      ...job,
      job_stops: [...(job.job_stops || [])].sort((a, b) => a.stop_order - b.stop_order),
    }));

    setJobs(normalizedJobs);
    setVehicles(vehicleData || []);
    setDrivers(driverData || []);
    setCustomers(customerData || []);
    setSubcontractors(subcontractorData || []);
  }

  useEffect(() => { loadData(); }, [tenant.activeTenantId]);

  function resetForm() {
    setEditingJobId(null);
    setForm({
      reference: "", scheduled_date: "", customer_id: "", vehicle_id: "", driver_id: "",
      customer_price: "", subcontractor_id: "", subcontractor_cost: "",
      stops: [emptyStop("collection"), emptyStop("delivery")],
    });
  }

  function addStop(type: "collection" | "delivery") {
    setForm((current) => ({ ...current, stops: [...current.stops, emptyStop(type)] }));
  }
  function updateStop(index: number, field: string, value: string) {
    setForm((current) => ({
      ...current,
      stops: current.stops.map((stop, i) => (i === index ? { ...stop, [field]: value } : stop)),
    }));
  }
  function removeStop(index: number) {
    setForm((current) => {
      const nextStops = current.stops.filter((_, i) => i !== index);
      return { ...current, stops: nextStops.length > 0 ? nextStops : [emptyStop("collection"), emptyStop("delivery")] };
    });
  }

  function startEdit(job: any) {
    setEditingJobId(job.id);
    setForm({
      reference: job.reference || "",
      scheduled_date: job.scheduled_date || "",
      customer_id: job.customer_id || "",
      vehicle_id: job.vehicle_id || "",
      driver_id: job.driver_id || "",
      customer_price: job.customer_price == null ? "" : String(job.customer_price),
      subcontractor_id: job.subcontractor_id || "",
      subcontractor_cost: job.subcontractor_cost == null ? "" : String(job.subcontractor_cost),
      stops: job.job_stops?.length
        ? job.job_stops.map((s: any) => ({ type: s.type, address_line: s.address_line || "", city: s.city || "", postcode: s.postcode || "" }))
        : [emptyStop("collection"), emptyStop("delivery")],
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updatePodForm(stopId: string, field: string, value: string) {
    setPodForms((current) => ({
      ...current,
      [stopId]: {
        recipient_name: current[stopId]?.recipient_name || "",
        pod_notes: current[stopId]?.pod_notes || "",
        pod_photo_url: current[stopId]?.pod_photo_url || "",
        [field]: value,
      },
    }));
  }

  async function saveJob(event: React.FormEvent) {
    event.preventDefault();
    if (!tenant.writeTenantId) { setMessage("Pick a specific tenant to create records."); return; }

    setLoading(true);
    setMessage("");

    const validation = JobPageValidation.safeParse(form);
    if (!validation.success) {
      setLoading(false);
      setMessage(validation.error.issues[0]?.message || "Please fill in all required fields.");
      return;
    }
    const reference = validation.data.reference;

    const validStops = form.stops
      .map((stop) => ({ ...stop, address_line: stop.address_line.trim(), city: stop.city.trim(), postcode: stop.postcode.trim() }))
      .filter((stop) => stop.address_line);

    if (validStops.length === 0) { setLoading(false); setMessage("Add at least one stop."); return; }

    for (const stop of validStops) {
      const stopSchema = stop.type === "collection" ? CollectionStopValidation : DeliveryStopValidation;
      const stopValidation = stopSchema.safeParse(stop);
      if (!stopValidation.success) {
        setLoading(false);
        setMessage(stopValidation.error.issues[0]?.message || "Stop details are invalid.");
        return;
      }
    }

    const customerPrice = form.customer_price === "" ? null : Number(form.customer_price);
    const subcontractorCost = form.subcontractor_cost === "" ? null : Number(form.subcontractor_cost);

    const payload = {
      reference, scheduled_date: form.scheduled_date || null, customer_id: form.customer_id || null,
      vehicle_id: form.vehicle_id || null, driver_id: form.driver_id || null,
      customer_price: customerPrice, subcontractor_id: form.subcontractor_id || null, subcontractor_cost: subcontractorCost,
    };

    let jobId = editingJobId;

    if (editingJobId) {
      const { error: updateError } = await supabase.from("jobs").update(payload).eq("id", editingJobId);
      if (updateError) { setLoading(false); setMessage(`Update job error: ${updateError.message}`); return; }

      const { error: deleteStopsError } = await supabase.from("job_stops").delete().eq("job_id", editingJobId);
      if (deleteStopsError) { setLoading(false); setMessage(`Delete old stops error: ${deleteStopsError.message}`); return; }
    } else {
      const { data: insertedJob, error: jobError } = await supabase
        .from("jobs")
        .insert([{ ...payload, tenant_id: tenant.writeTenantId, status: "planned" }])
        .select("id")
        .single();
      if (jobError) { setLoading(false); setMessage(`Create job error: ${jobError.message}`); return; }
      jobId = insertedJob.id;
    }

    const stopsToInsert = validStops.map((stop, index) => ({
      tenant_id: tenant.writeTenantId, job_id: jobId, stop_order: index + 1, type: stop.type,
      address_line: stop.address_line, city: stop.city || null, postcode: stop.postcode || null,
      planned_at: form.scheduled_date ? `${form.scheduled_date}T08:00:00` : null,
      status: "planned", pod_status: "pending",
    }));

    const { error: stopsError } = await supabase.from("job_stops").insert(stopsToInsert);
    setLoading(false);
    if (stopsError) { setMessage(`Stops error: ${stopsError.message}`); return; }

    setMessage(editingJobId ? "Job updated." : "Job created.");
    resetForm();
    await loadData();
  }

  async function performDelete(jobId: string) {
    const { error } = await supabase.from("jobs").delete().eq("id", jobId);
    if (error) { setMessage(`Delete job error: ${error.message}`); return; }
    if (editingJobId === jobId) resetForm();
    setMessage("Job deleted.");
    await loadData();
  }

  function requestDelete(job: any) {
    if (job.status !== "planned") { setMessage("Only planned jobs can be deleted right now."); return; }
    setDeleteTarget({ id: job.id, reference: job.reference });
  }

  async function savePod(jobId: string, stopId: string) {
    const podForm = podForms[stopId] || { recipient_name: "", pod_notes: "", pod_photo_url: "" };
    const updatePayload: Record<string, any> = {
      recipient_name: podForm.recipient_name.trim() || null,
      pod_notes: podForm.pod_notes.trim() || null,
      delivered_at: new Date().toISOString(),
      pod_status: "delivered",
      status: "completed",
    };
    if (podForm.pod_photo_url.trim()) updatePayload.pod_photo_url = podForm.pod_photo_url.trim();

    const { error: stopError } = await supabase.from("job_stops").update(updatePayload).eq("id", stopId);
    if (stopError) { setMessage(`POD save error: ${stopError.message}`); return; }

    const { data: deliveryStops, error: deliveryStopsError } = await supabase
      .from("job_stops").select("id, pod_status, type").eq("job_id", jobId).eq("type", "delivery");
    if (deliveryStopsError) { setMessage(`Delivery stop check error: ${deliveryStopsError.message}`); await loadData(); return; }

    const allDelivered = (deliveryStops || []).length > 0 && deliveryStops.every((s: any) => s.pod_status === "delivered");
    if (allDelivered) {
      const { error: jobUpdateError } = await supabase.from("jobs").update({ status: "completed" }).eq("id", jobId);
      if (jobUpdateError) { setMessage(`Job completion error: ${jobUpdateError.message}`); await loadData(); return; }
    }

    setMessage("POD saved.");
    await loadData();
  }

  return (
    <TenantGate>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className="text-2xl font-semibold text-ink">Jobs</h1>
        <p className="mt-1 text-sm text-ink-2">
          Create jobs, edit jobs, delete planned jobs, and complete POD from one screen.
        </p>

        <div className="mt-6">
          <JobForm
            form={form}
            editingJobId={editingJobId}
            loading={loading}
            customers={customers.map((c) => ({ id: c.id, label: c.name }))}
            vehicles={vehicles.map((v) => ({ id: v.id, label: v.registration }))}
            drivers={drivers.map((d) => ({ id: d.id, label: d.name }))}
            subcontractors={subcontractors.map((s) => ({
              id: s.id, label: `${s.name} - ${s.vehicle_reg || "No reg"} - ${s.driver_name || "No driver"}`,
            }))}
            onFieldChange={(field, value) => setForm((f) => ({ ...f, [field]: value }))}
            onStopChange={updateStop}
            onAddStop={addStop}
            onRemoveStop={removeStop}
            onSubmit={saveJob}
            onCancelEdit={resetForm}
          />
        </div>

        {message ? (
          <div className="mt-5 rounded-lg border border-line bg-surface p-3.5 text-sm text-ink">{message}</div>
        ) : null}

        <div className="mt-6 grid gap-4">
          {jobs.map((job) => {
            const margin =
              job.customer_price != null && job.subcontractor_cost != null
                ? Number(job.customer_price) - Number(job.subcontractor_cost)
                : null;

            return (
              <div key={job.id} className="rounded-lg border border-line bg-surface p-5">
                <div className="mb-3.5 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-mono text-lg font-semibold text-ink">{job.reference}</h2>
                    <div className="text-sm text-ink-2">
                      Date: {job.scheduled_date || "-"} · Status: {job.status}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => startEdit(job)}>Edit</Button>
                    <Button type="button" variant="danger" onClick={() => requestDelete(job)}>Delete</Button>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Customer</div>
                    <div className="text-sm text-ink">{job.customers?.name || "-"}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Vehicle</div>
                    <div className="font-mono text-sm text-ink">{job.vehicles?.registration || "-"}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Driver</div>
                    <div className="text-sm text-ink">{job.drivers?.name || "-"}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Sell</div>
                    <div className="font-mono text-sm text-ink">{formatMoney(job.customer_price)}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Subcontractor</div>
                    <div className="text-sm text-ink">{job.subcontractors?.name || "-"}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Buy</div>
                    <div className="font-mono text-sm text-ink">{formatMoney(job.subcontractor_cost)}</div>
                  </div>
                  <div className="rounded-md bg-surface-2 p-3">
                    <div className="text-xs font-semibold text-ink-3">Margin</div>
                    <div className="font-mono text-sm text-ink">{formatMoney(margin)}</div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink">Stops / POD</h3>
                  {job.job_stops?.length ? (
                    <div className="grid gap-2.5">
                      {job.job_stops.map((stop: any) => (
                        <StopCard
                          key={stop.id}
                          stop={stop}
                          podForm={podForms[stop.id]}
                          onPodFieldChange={updatePodForm}
                          onMarkDelivered={(stopId) => savePod(job.id, stopId)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-ink-3">No stops yet.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <DeleteJobDialog
        open={!!deleteTarget}
        jobReference={deleteTarget?.reference ?? ""}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) performDelete(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </TenantGate>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 3: Manual verification against the exact pre-rebuild behavior**

```bash
npm run dev
```
Sign in, visit `/jobs`, and confirm every one of these still works exactly as before:
- Create a job with 1 collection + 1 delivery stop — appears in the list.
- Add a second delivery stop before submitting — both save.
- Edit a job, change its reference, save — updates in place, stops survive (re-created, not
  literally the same rows — matches existing destructive-replace behavior, unchanged).
- Try to delete a `"completed"` job — blocked with the "Only planned jobs..." message, no
  dialog opens.
- Delete a `"planned"` job — the new dialog opens, Cancel closes it with no deletion, Delete
  removes it.
- Fill a delivery stop's POD fields and "Mark Delivered" — stop shows delivered, and once
  *every* delivery stop on that job is delivered, the job's status flips to `"completed"`
  (this is the cascade rule — confirm it still fires).
- Validation: try submitting with no customer selected — same Zod error message surfaces.

- [ ] **Step 4: Run existing tests (confirms nothing elsewhere broke)**

```bash
npm test
```
Expected: all existing suites still PASS (this task didn't touch `lib/tenant`, `lib/pod`, or
`lib/validation`, but a full run is the real confirmation).

- [ ] **Step 5: Commit**

```bash
git add app/jobs/page.tsx
git commit -m "refactor: rewire jobs page onto JobForm/StopCard/DeleteJobDialog, same logic"
```

---

## Task 22: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build + typecheck + test**

```bash
npm run typecheck
npm run build
npm test
```
Expected: all clean.

- [ ] **Step 2: Grep for leftover references to deleted/renamed things**

```bash
grep -rn "AppHeader" app/ components/ lib/
```
Expected: no matches.

- [ ] **Step 3: Security check — re-run the `shouldShowShell` matrix manually in the browser**

Beyond the unit test (Task 10) and the Task 15 manual check, do one more explicit pass since
this is the file that regressed once already:
- Signed out, visit `/`, `/login`, every app route (e.g. `/jobs`, `/dashboard`) directly by
  URL — no sidebar ever appears, app routes redirect to `/login`.
- Mid-session (signed in), open a second tab to `/login` — no sidebar there either (path
  exemption holds even when status is "ready").
- Sign out from the sidebar button — sidebar disappears immediately, redirected to `/login`.

- [ ] **Step 4: Visual pass at desktop and mobile widths**

```bash
npm run dev
```
Check `/`, `/login`, `/dashboard`, `/jobs` at ~375px and ~1440px widths. The sidebar has no
responsive/collapse behavior built in this plan (out of scope — note it as a follow-up, not
a silent gap) — confirm it doesn't break mobile layout catastrophically even without one;
if it does, that's a real finding to raise before calling this done, not something to fix
silently mid-verification.

- [ ] **Step 5: Push the branch (do not merge — that's Ethan's call)**

```bash
git push -u origin feat/console-design-foundation
```
