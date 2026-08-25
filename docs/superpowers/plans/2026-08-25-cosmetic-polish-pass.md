# Cosmetic Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix low-contrast tabs/buttons, replace remaining emoji with real icons, and fix the native calendar-picker icon and dropdown arrows, per `docs/superpowers/specs/2026-08-25-cosmetic-polish-pass-design.md`.

**Architecture:** Add one new CSS token (`--surface-hover`) for interactive hover fills, keep `--surface-2` untouched (it's load-bearing for text elsewhere and can't be brightened without breaking an existing AA contrast test — see Task 1). Redesign the shared `Tabs` component. Swap the four hand-rolled Invoices buttons onto the shared `Button` component. Add two small global CSS rules (`color-scheme`, a universal `<select>` arrow) that fix the calendar icon and every dropdown in the app without touching individual pages. Replace emoji with `lucide-react` icons file-by-file, following the chip-for-cards / plain-for-inline rule from the spec.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS (Preflight disabled, `.ds` scoped reset), `lucide-react`, Vitest.

---

## Before you start

This plan assumes you're working in the worktree at `.worktrees/cosmetic-polish-pass` (branch `ethan/cosmetic-polish-pass`), already set up with `npm install` run and a clean `npm test` baseline (384 passing). If you're not in that worktree, `cd` into it before starting Task 1.

Read `app/tokens.css` in full before Task 1 — it has extensive header comments explaining the dark-default architecture and the exact reasoning this plan depends on (why `:root` and `.dark` must stay identical, why `--surface-2` can't just be brightened).

---

### Task 1: Add the `--surface-hover` token

**Why a new token instead of fixing `--surface-2`:** `--surface-2` (`#131B2B`) is used both as a hover fill (needs to be clearly *lighter* than `--canvas`/`--surface` to be visible) and as a background that hosts `--ink` text elsewhere in the app, which `lib/theme/contrast.test.ts` asserts stays ≥4.5:1. Those two jobs conflict: brightening `--surface-2` enough to clear 3:1 against `--canvas`/`--surface` (the WCAG non-text minimum for a UI-component boundary) drops `ink`-on-`surface-2` below 4.5:1. This is the same conflict the codebase already solved once for the loading-skeleton fill by adding a dedicated `--skeleton` token instead of reusing `--surface-2` (see the comment at `app/tokens.css:42-44`). This task follows the same pattern.

The dark value `#4E6AB4` and light value `#7B8CAB` below were verified against the project's own contrast formula (`lib/theme/contrast.ts`) to clear 3:1 against both `--canvas` and `--surface` in their respective themes:
- Dark: `#4E6AB4` vs `--canvas` (`#0F1626`) = 3.48:1, vs `--surface` (`#161F31`) = 3.17:1.
- Light: `#7B8CAB` vs `--canvas` (`#F2F4F8`) = 3.09:1, vs `--surface` (`#FFFFFF`) = 3.40:1.

**Files:**
- Modify: `app/tokens.css`
- Modify: `tailwind.config.ts`
- Modify: `lib/theme/contrast.test.ts`
- Test: `lib/theme/contrast.test.ts` (existing file, adding cases to it)

- [x] **Step 1: Write the failing contrast assertions**

Open `lib/theme/contrast.test.ts` and add two entries to the `PAIRS` array (around line 119), directly after the existing `"skeleton on canvas"` entry:

```ts
  { label: "skeleton on canvas",          fg: "--skeleton",          bg: "--canvas",        min: SKELETON_VISIBLE },
  { label: "surface-hover on canvas (hover fill must be visible)", fg: "--surface-hover", bg: "--canvas",  min: AA_NON_TEXT },
  { label: "surface-hover on surface (hover fill must be visible)", fg: "--surface-hover", bg: "--surface", min: AA_NON_TEXT },
];
```

(Only add the two new lines — the existing `"skeleton on canvas"` line and the closing `];` already exist; this shows them for placement context.)

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/theme/contrast.test.ts`
Expected: FAIL — `--surface-hover missing from :root` (and `.light`), because the token doesn't exist in `app/tokens.css` yet.

- [x] **Step 3: Add the token to all three blocks in `app/tokens.css`**

In `:root` (around line 39, directly after `--surface-2: #131B2B;`):

```css
  --surface-2: #131B2B;
  /* Hover fill for interactive elements (tabs, secondary/ghost buttons, table
     rows). Deliberately NOT --surface-2: that token also hosts --ink text
     elsewhere and brightening it to clear 3:1 against --canvas/--surface (the
     WCAG non-text minimum for a UI-component boundary) drops ink-on-surface-2
     below the 4.5:1 text minimum lib/theme/contrast.test.ts asserts. Same
     reasoning as --skeleton above, for the same underlying conflict. */
  --surface-hover: #4E6AB4;
```

In `.dark` (around line 118, directly after `--surface-2: #131B2B;` — must stay byte-for-byte identical to `:root`'s value per the file's parity requirement):

```css
  --surface-2: #131B2B;
  --surface-hover: #4E6AB4;
```

In `.light` (around line 185, directly after `--surface-2: #EDF0F5;`):

```css
  --surface-2: #EDF0F5;
  --surface-hover: #7B8CAB;
```

- [x] **Step 4: Run the test to verify the new assertions pass**

Run: `npx vitest run lib/theme/contrast.test.ts`
Expected: PASS, including the two new `surface-hover` cases in both the `:root` and `.light` describe blocks, and the "declares the same token names in every block" structural test.

- [x] **Step 5: Add the Tailwind utility**

In `tailwind.config.ts`, find the `surface` entry inside `extend.colors` (around line 65):

```ts
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)" },
```

Replace with:

```ts
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)", hover: "var(--surface-hover)" },
```

This makes `bg-surface-hover` / `hover:bg-surface-hover` / `focus-visible:bg-surface-hover` available as Tailwind utilities.

- [x] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS, 384+ tests (386 after Step 1's two additions), 0 failures.

- [x] **Step 7: Commit**

```bash
git add app/tokens.css tailwind.config.ts lib/theme/contrast.test.ts
git commit -m "feat: add --surface-hover token for visible interactive hover fills"
```

---

### Task 2: Redesign the Tabs component

**Files:**
- Modify: `components/Tabs.tsx`

- [ ] **Step 1: Replace the tab styling**

Read the current file first — it's short (43 lines). Replace the `className` block inside the `.map()` (currently lines 27-32):

Old:
```tsx
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors",
              active
                ? "border-primary-tint-border bg-primary-tint text-primary-deep"
                : "border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink-2",
            )}
```

New:
```tsx
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border-b-2 px-3 py-1.5 text-sm font-semibold transition-colors",
              active
                ? "border-b-primary-tint-border bg-primary-tint text-primary-deep"
                : "border-b-transparent bg-surface-2 text-ink-2 hover:bg-surface-hover hover:text-ink",
            )}
```

This gives every tab a visible fill at all times (`bg-surface-2` inactive — here it's fine as a static fill, not a hover-visibility fill, so the earlier contrast conflict doesn't apply), a brighter `text-ink-2` inactive label (up from `text-ink-3`, since the label now needs to read clearly against a real background rather than transparent canvas), a visible `hover:bg-surface-hover` using the new token from Task 1, and keeps the active tab's existing `bg-primary-tint` fill plus adds a bottom-border underline in the primary accent color layered on top (the fill+underline hybrid from the design spec).

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, sign in (see `lib/dev-login` / the local sign-in helper if you don't have a session), navigate to `/invoices`.
Expected: All ten tabs ("Ready to Invoice", "Invoices", "Credit Notes", ...) are visible as filled chips even when inactive; the active tab additionally has a blue underline; hovering an inactive tab visibly lightens it.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, no regressions (Tabs has no dedicated unit test today — this is a visual-only component).

- [ ] **Step 4: Commit**

```bash
git add components/Tabs.tsx
git commit -m "fix: give Tabs a visible fill so inactive tabs don't blend into the page"
```

---

### Task 3: Rename remaining `hover:bg-surface-2` usages to the new token

**Context:** Task 1 added `--surface-hover` specifically so every *interactive hover fill* in the app becomes visible, not just the tabs. `--surface-2` itself is untouched and still correct for its other job (a static, non-hover background). This task finds every place `surface-2` was being used as a hover fill (the exact substring `hover:bg-surface-2` or `focus-visible:bg-surface-2`) and repoints it. `bg-surface-2` used as a *static* background (not preceded by `hover:`/`focus-visible:`) is a different, correct usage and must NOT be touched.

**Files:**
- Modify: `components/Button.tsx:22-23`
- Modify: `components/DataTable.tsx:113,153`
- Modify: `app/dashboard/page.tsx:300`
- Modify: `app/tracking/TrackingRail.tsx:45`
- Modify: `app/tracking/TrackingHeader.tsx:110,121`
- Modify: `app/pod/page.tsx:1704`
- Modify: `app/tracking/page.tsx:374`

- [ ] **Step 1: `components/Button.tsx`**

Old (lines 21-24):
```tsx
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-ink hover:bg-surface-2",
  danger: "bg-danger text-on-danger hover:bg-danger-hover",
```

New:
```tsx
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-hover",
  ghost: "bg-transparent text-ink hover:bg-surface-hover",
  danger: "bg-danger text-on-danger hover:bg-danger-hover",
```

This is the shared `Button` component used app-wide — this single change fixes every `variant="secondary"` and `variant="ghost"` button's hover state everywhere it's used, including the four Invoices buttons that will be migrated onto it in Task 4.

- [ ] **Step 2: `components/DataTable.tsx`**

Old (line 113):
```tsx
                      onRowClick && "cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2",
```

New:
```tsx
                      onRowClick && "cursor-pointer hover:bg-surface-hover focus-visible:bg-surface-hover",
```

Old (line 153):
```tsx
              className="mt-2 inline-flex h-9 items-center rounded-md border border-line-strong px-3 text-sm font-semibold text-ink hover:bg-surface-2"
```

New:
```tsx
              className="mt-2 inline-flex h-9 items-center rounded-md border border-line-strong px-3 text-sm font-semibold text-ink hover:bg-surface-hover"
```

- [ ] **Step 3: `app/dashboard/page.tsx`**

Old (line 300):
```tsx
                        <Link href={item.href} className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-surface-2">
```

New:
```tsx
                        <Link href={item.href} className="block rounded-md px-2 py-1.5 -mx-2 hover:bg-surface-hover">
```

- [ ] **Step 4: `app/tracking/TrackingRail.tsx`**

Old (line 45):
```tsx
                      : "bg-transparent hover:bg-surface-2"
```

New:
```tsx
                      : "bg-transparent hover:bg-surface-hover"
```

- [ ] **Step 5: `app/tracking/TrackingHeader.tsx`**

Old (line 110):
```tsx
            className="rounded-sm border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:border-line-strong hover:bg-surface-2"
```

New:
```tsx
            className="rounded-sm border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:border-line-strong hover:bg-surface-hover"
```

Old (line 121):
```tsx
          className="rounded-sm px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink"
```

New:
```tsx
          className="rounded-sm px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-hover hover:text-ink"
```

- [ ] **Step 6: `app/pod/page.tsx`**

Old (line 1704):
```tsx
            "hover:bg-surface-2",
```

New:
```tsx
            "hover:bg-surface-hover",
```

- [ ] **Step 7: `app/tracking/page.tsx`**

Old (line 374):
```tsx
                className="mt-3 rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-line-strong hover:bg-surface-2"
```

New:
```tsx
                className="mt-3 rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-line-strong hover:bg-surface-hover"
```

- [ ] **Step 8: Verify no `hover:bg-surface-2` remains**

Run: `grep -rn "hover:bg-surface-2\|focus-visible:bg-surface-2" app components`
Expected: no output (empty).

- [ ] **Step 9: Run the full test suite**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 10: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors (these are all string-literal class changes, no type surface changed).

- [ ] **Step 11: Commit**

```bash
git add components/Button.tsx components/DataTable.tsx app/dashboard/page.tsx app/tracking/TrackingRail.tsx app/tracking/TrackingHeader.tsx app/pod/page.tsx app/tracking/page.tsx
git commit -m "fix: repoint interactive hover fills from the invisible surface-2 to surface-hover"
```

---

### Task 4: Fix the four hand-rolled Invoices buttons

**Context:** These four buttons currently use `hover:bg-canvas`, which matches their `<article>`/page background exactly, making them disappear on hover. Rather than patch the one-off classes, swap them onto the shared `Button` component (already imported in this file, and already fixed by Task 3).

**Files:**
- Modify: `app/invoices/page.tsx:2440-2447` (Cancel Edit)
- Modify: `app/invoices/page.tsx:3032-3045` (Edit)
- Modify: `app/invoices/page.tsx:3047-3066` (Approve & Apply)
- Modify: `app/invoices/page.tsx:3068-3082` (Cancel Credit)

- [ ] **Step 1: Cancel Edit**

Old (lines 2440-2447):
```tsx
                        <button
                          type="button"
                          disabled={working}
                          onClick={resetCreditEditor}
                          className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
                        >
                          Cancel Edit
                        </button>
```

New:
```tsx
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={working}
                          onClick={resetCreditEditor}
                        >
                          Cancel Edit
                        </Button>
```

- [ ] **Step 2: Edit**

Old (lines 3032-3045):
```tsx
                                      <button
                                        type="button"
                                        disabled={
                                          working
                                        }
                                        onClick={() =>
                                          void editCreditNote(
                                            note
                                          )
                                        }
                                        className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
                                      >
                                        Edit
                                      </button>
```

New:
```tsx
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={working}
                                        onClick={() => void editCreditNote(note)}
                                      >
                                        Edit
                                      </Button>
```

- [ ] **Step 3: Approve & Apply**

Old (lines 3047-3066):
```tsx
                                      <button
                                        type="button"
                                        disabled={
                                          working ||
                                          (
                                            note.credit_note_lines ??
                                            []
                                          ).length ===
                                            0
                                        }
                                        onClick={() =>
                                          void creditNoteAction(
                                            note,
                                            "approve"
                                          )
                                        }
                                        className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
                                      >
                                        Approve & Apply
                                      </button>
```

New:
```tsx
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={
                                          working ||
                                          (note.credit_note_lines ?? []).length === 0
                                        }
                                        onClick={() => void creditNoteAction(note, "approve")}
                                      >
                                        Approve & Apply
                                      </Button>
```

- [ ] **Step 4: Cancel Credit**

Old (lines 3068-3082):
```tsx
                                      <button
                                        type="button"
                                        disabled={
                                          working
                                        }
                                        onClick={() =>
                                          void creditNoteAction(
                                            note,
                                            "cancel"
                                          )
                                        }
                                        className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas"
                                      >
                                        Cancel Credit
                                      </button>
```

New:
```tsx
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        disabled={working}
                                        onClick={() => void creditNoteAction(note, "cancel")}
                                      >
                                        Cancel Credit
                                      </Button>
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. `Button`'s `Props` type extends `ButtonHTMLAttributes<HTMLButtonElement>`, so `onClick`/`disabled` are accepted as before; `type="button"` no longer needs to be set explicitly since `Button` already defaults to `type="button"` (see `components/Button.tsx:59`).

- [ ] **Step 6: Manually verify in the browser**

Run: `npm run dev`, sign in, go to `/invoices` → Credit Notes tab.
Expected: "Cancel Edit" (when editing an existing credit note), "Edit", "Approve & Apply" and "Cancel Credit" all render with a visible border/background and stay visible on hover (lighten, don't vanish).

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add app/invoices/page.tsx
git commit -m "fix: replace hand-rolled Invoices buttons with the shared Button component

The old hover:bg-canvas class matched the surrounding article's background
exactly, making Cancel Edit, Edit, Approve & Apply and Cancel Credit
disappear on hover."
```

---

### Task 5: Fix the calendar-picker icon and native form-control chrome

**Context:** No page declares `color-scheme`, so Chrome/Edge render native form chrome (the date-input calendar glyph, checkboxes, scrollbars) using their light-mode default regardless of the app's dark theme — a solid near-black calendar icon on a dark `--surface` field. `color-scheme` is inherited, so one declaration per theme block fixes every `<input type="date">` in the app (~30 of them) without touching any of them individually.

**Files:**
- Modify: `app/tokens.css`

- [ ] **Step 1: Add `color-scheme` to `:root`**

In `app/tokens.css`, inside the `:root` block, directly after the opening `:root {` line (line 35):

```css
:root {
  color-scheme: dark;
  /* surfaces */
  --canvas: #0F1626;
```

- [ ] **Step 2: Add `color-scheme` to `.dark`**

Inside the `.dark` block, directly after its opening `.dark {` line:

```css
.dark {
  color-scheme: dark;
  --canvas: #0F1626;
```

- [ ] **Step 3: Add `color-scheme` to `.light`**

Inside the `.light` block, directly after its opening `.light {` line:

```css
.light {
  color-scheme: light;
  --canvas: #F2F4F8;
```

- [ ] **Step 4: Run the contrast test's structural check**

Run: `npx vitest run lib/theme/contrast.test.ts -t "declares the same token names"`
Expected: PASS. `color-scheme` is a plain CSS property, not a custom property (`--*`), so `parseTokenBlocks` (which only collects `--*` declarations) ignores it and the token-name-parity check is unaffected.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, sign in, open any page with a date field (e.g. `/jobs` → New Job, or `/drivers`).
Expected: the calendar-picker icon inside the date input is now light/white-ish and clearly visible against the dark field, instead of jet-black. Toggle to light mode (the theme toggle in the sidebar) and confirm the icon switches to the dark variant and stays legible on the white field.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add app/tokens.css
git commit -m "fix: declare color-scheme so native date-picker icons follow the app theme"
```

---

### Task 6: Fix dropdown/select arrows app-wide

**Context:** No `<select>` in the app sets `appearance: none`, so every dropdown (the shared `components/Select.tsx` and ~17 hand-rolled `<select>` elements across other pages) renders the raw OS-native arrow, which looks inconsistent and, combined with the missing `color-scheme` from Task 5, can render mismatched against the app's dark controls. Rather than edit ~18 files individually, this task adds one global CSS rule that gives every `<select>` in the app the same custom chevron, replacing the native one.

`!important` is used deliberately on three properties. Call sites set their own padding via Tailwind utility classes (e.g. `px-3`) directly in the `class` attribute; a bare `select { }` type-selector rule normally loses to those on specificity, which would leave no reserved space for the icon and cause exactly the overlapping/"hanging" look this task fixes. `!important` here is narrowly scoped to layout properties of a single native form control, not application logic.

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add the global select-arrow rule**

Add this at the end of `app/globals.css` (after the existing `@layer components { ... }` block, so it is NOT nested inside any `@layer` — see the "Why this isn't in a layer" note below):

```css

/* Every <select> in the app relies on the raw OS-native dropdown arrow —
   inconsistent across browsers, and (combined with no color-scheme
   declaration, see app/tokens.css) can render visibly mismatched against the
   app's dark controls. This one rule gives every select in the app — the
   shared components/Select.tsx AND every hand-rolled <select> on legacy
   pages — the same owned chevron, without editing each call site.

   Deliberately NOT inside a @layer: Tailwind's own utilities (@tailwind
   utilities;) compile into @layer utilities, and call sites set their own
   px-3-style padding as a class on the <select> itself. An unlayered rule
   already outranks any layered rule regardless of specificity per the CSS
   Cascade Layers spec, but the properties below also carry !important to
   guarantee the reserved icon space survives even if a future refactor moves
   this rule inside a layer by accident. */
select:not([multiple]) {
  appearance: none !important;
  -webkit-appearance: none !important;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%237787A0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
  background-repeat: no-repeat !important;
  background-position: right 10px center !important;
  background-size: 16px !important;
  padding-right: 34px !important;
}

.light select:not([multiple]) {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23737D8F' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;
}
```

The SVG is Lucide's `chevron-down` glyph inlined as a data URI (no network request, no new dependency). The stroke colors are `--ink-3`'s dark (`#7787A0`) and light (`#737D8F`) values — `var()` can't be used inside a `background-image` data URI, so these are the two theme values written out directly, one per selector, matching how `--chrome-link` is handled the same way in `app/tokens.css`.

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, sign in, open a page with a `<select>` in both themes:
- A shared-component one: `/settings/licences` (uses `components/Select.tsx`).
- A hand-rolled one: `/invoices` → Credit Notes → the "Original Invoice" select, or `/jobs` → New Job → "Job type".

Expected: every dropdown shows a clean, centered chevron instead of the native arrow, in both dark and light mode, with no visible overlap between the arrow and the selected option's text.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, 0 failures (this is a CSS-only change with no test surface).

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "fix: replace native select arrows with a single owned chevron app-wide"
```

---

### Task 7: Settings page — emoji to icons

**Files:**
- Modify: `app/settings/page.tsx`

- [ ] **Step 1: Replace the emoji strings with icon components**

Read the full current file first (73 lines). Replace it entirely with:

```tsx
import { Building2, Users, Lock, FileText, Banknote, type LucideIcon } from "lucide-react";

export default function SettingsPage() {
    const cards: Array<{ title: string; description: string; href: string; icon: LucideIcon }> = [
        {
            title: "Company Profile",
            description:
                "Edit company details, VAT, EORI, operator licence, US EIN, USDOT, MC and regional settings",
            href: "/settings/company",
            icon: Building2,
        },
        {
            title: "Users",
            description: "Add users and manage account access",
            href: "/settings/users",
            icon: Users,
        },
        {
            title: "Page Permissions",
            description: "Control which pages each user can access",
            href: "/settings/permissions",
            icon: Lock,
        },
        {
            title: "Vehicle Licences",
            description: "Add or remove licences and manage £10 monthly billing",
            href: "/settings/licences",
            icon: FileText,
        },
        {
            title: "Documents & Branding",
            description:
                "Manage logos, document branding, footers and quotation defaults",
            href: "/settings/documents",
            icon: FileText,
        },
        {
            title: "Invoices",
            description: "View billing and invoice settings",
            href: "/settings/invoices",
            icon: Banknote,
        },
    ];

    return (
        <div className="ds min-h-screen bg-canvas font-sans text-ink">
            <main className="mx-auto max-w-[1480px] px-6 py-8">

                <header className="mb-4">
                    <div className="text-kicker uppercase text-ink-3">Admin</div>

                    <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Settings</h1>

                    <p className="m-0 text-sm text-ink-3">
                        Manage company details, users, permissions, vehicle licences and billing settings.
                    </p>
                </header>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {cards.map((card) => {
                        const Icon = card.icon;
                        return (
                            <a
                                key={card.href}
                                href={card.href}
                                className="block rounded-lg border border-line bg-surface p-4 shadow-sm hover:border-primary-tint-border hover:shadow-md"
                            >
                                <div
                                    aria-hidden
                                    className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-primary-tint text-primary-deep"
                                >
                                    <Icon size={18} />
                                </div>
                                <h2 className="mb-1 mt-0 text-md font-semibold text-ink">{card.title}</h2>
                                <p className="m-0 text-sm text-ink-3">{card.description}</p>
                            </a>
                        );
                    })}
                </div>

            </main>
        </div>
    );
}
```

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, sign in, go to `/settings`.
Expected: each card shows a small blue-tinted icon square instead of an emoji.

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx
git commit -m "fix: replace Settings page emoji with lucide icons"
```

---

### Task 8: Stats page — emoji to icons

**Files:**
- Modify: `app/stats/page.tsx`

- [ ] **Step 1: Add the icon imports**

At the top of `app/stats/page.tsx`, after the existing imports (after line 10, `import MessageBanner from "../../components/MessageBanner";`):

```tsx
import {
  Package, CircleCheck, Calendar, Banknote, Receipt, TrendingUp, Truck, MapPin,
  Camera, Timer, Clock, Send, TriangleAlert, CircleDollarSign, Sparkles, Siren,
  Radio, Briefcase, Wrench, UserCheck, FileText, type LucideIcon,
} from "lucide-react";
```

- [ ] **Step 2: Update `StatCard` to take an icon component instead of a string**

Old (lines 264-294):
```tsx
function StatCard({
  icon,
  value,
  title,
  caption,
}: {
  icon: string;
  value: string | number;
  title: string;
  caption: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div aria-hidden="true" className="text-2xl">
        {icon}
      </div>

      <h2 className="m-0 font-mono text-2xl font-semibold tabular-nums slashed-zero text-ink">
        {value}
      </h2>

      <p className="m-0 text-sm font-semibold text-ink">
        {title}
      </p>

      <p className="m-0 text-xs text-ink-3">
        {caption}
      </p>
    </div>
  );
}
```

New:
```tsx
function StatCard({
  icon: Icon,
  value,
  title,
  caption,
}: {
  icon: LucideIcon;
  value: string | number;
  title: string;
  caption: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div
        aria-hidden="true"
        className="mb-1 flex h-8 w-8 items-center justify-center rounded-md bg-primary-tint text-primary-deep"
      >
        <Icon size={16} />
      </div>

      <h2 className="m-0 font-mono text-2xl font-semibold tabular-nums slashed-zero text-ink">
        {value}
      </h2>

      <p className="m-0 text-sm font-semibold text-ink">
        {title}
      </p>

      <p className="m-0 text-xs text-ink-3">
        {caption}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Replace every `icon="<emoji>"` call site**

This is one contiguous block (originally lines 1075-1301). Replace the whole block:

Old:
```tsx
                <StatCard
                  icon="📦"
                  value={
                    periodJobs.length
                  }
                  title="Total jobs"
                  caption="Jobs in this period"
                />

                <StatCard
                  icon="✅"
                  value={
                    completedJobs.length
                  }
                  title="Completed"
                  caption="Delivered or completed jobs"
                />

                <StatCard
                  icon="🗓️"
                  value={
                    plannedJobs.length
                  }
                  title="Planned"
                  caption="Booked, planned or allocated jobs"
                />

                <StatCard
                  icon="💷"
                  value={formatMoney(
                    revenue
                  )}
                  title="Revenue"
                  caption="Customer job value"
                />

                <StatCard
                  icon="🧾"
                  value={formatMoney(
                    subcontractorCost
                  )}
                  title="Subcontractor cost"
                  caption="External haulage cost"
                />

                <StatCard
                  icon="📈"
                  value={formatMoney(
                    margin
                  )}
                  title="Gross margin"
                  caption={`${marginPercent.toFixed(
                    1
                  )}% of revenue`}
                />

                <StatCard
                  icon="🚚"
                  value={`${ownFleetJobs} / ${subbedJobs.length}`}
                  title="Own fleet / subbed"
                  caption="In-house vs subcontracted"
                />
              </div>

              <SectionTitle>
                Delivery & POD
              </SectionTitle>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatCard
                  icon="📍"
                  value={`${deliveredStops.length} / ${deliveryStops.length}`}
                  title="Stops delivered"
                  caption="Delivered vs delivery stops"
                />

                <StatCard
                  icon="📸"
                  value={podRate}
                  title="POD rate"
                  caption="Delivery completion rate"
                />

                <StatCard
                  icon="⏳"
                  value={pendingPods}
                  title="PODs pending"
                  caption="Delivery stops awaiting POD"
                />
              </div>

              <SectionTitle>
                Invoicing
              </SectionTitle>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatCard
                  icon="💷"
                  value={formatMoney(
                    invoicedTotal
                  )}
                  title="Invoiced total"
                  caption="Invoices issued in this period"
                />

                <StatCard
                  icon="📤"
                  value={`${draftCount} / ${sentCount} / ${paidCount}`}
                  title="Draft / sent / paid"
                  caption="Invoice pipeline"
                />

                <StatCard
                  icon="⚠️"
                  value={
                    overdueInvoices.length
                  }
                  title="Overdue invoices"
                  caption="Unpaid invoices past due"
                />

                <StatCard
                  icon="💸"
                  value={formatMoney(
                    overdueValue
                  )}
                  title="Overdue value"
                  caption="Outstanding past due"
                />
              </div>

              <SectionTitle>
                Growth & compliance
              </SectionTitle>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatCard
                  icon="🆕"
                  value={newCustomers}
                  title="New customers"
                  caption="Customers added in this period"
                />

                <StatCard
                  icon="⏱️"
                  value={hoursAlerts}
                  title="Drivers' hours alerts"
                  caption="Driver-days over 9 hours"
                />

                <StatCard
                  icon="🚨"
                  value={
                    violationEvents
                  }
                  title="Violation events"
                  caption="Detected compliance events"
                />

                <StatCard
                  icon="📡"
                  value={speedAlerts}
                  title="Speed alerts"
                  caption={`Readings over ${SPEED_ALERT_THRESHOLD} km/h`}
                />

                <StatCard
                  icon="🕒"
                  value={`${drivingHours.toFixed(
                    1
                  )} h`}
                  title="Driving hours logged"
                  caption="Total driving time in this period"
                />
              </div>

              <SectionTitle>
                Fleet — right now
              </SectionTitle>

              <p className="mb-2 text-sm text-ink-3">
                Snapshot figures are not
                affected by the period
                selector.
              </p>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatCard
                  icon="🚛"
                  value={`${activeVehicles} / ${vehicles.length}`}
                  title="Active vehicles"
                  caption="Active vs total fleet"
                />

                <StatCard
                  icon="💼"
                  value={
                    billableVehicles
                  }
                  title="Billable vehicles"
                  caption="Active vehicles marked billable"
                />

                <StatCard
                  icon="🛠️"
                  value={
                    vehiclesOffRoad
                  }
                  title="Vehicles off road"
                  caption="Inactive / VOR vehicles"
                />

                <StatCard
                  icon="🧑‍✈️"
                  value={`${activeDrivers} / ${drivers.length}`}
                  title="Active drivers"
                  caption="Active vs total drivers"
                />

                <StatCard
                  icon="📄"
                  value={
                    licencesExpiringSoon
                  }
                  title="Licences expiring"
                  caption="Within the next 30 days"
                />
              </div>
```

New (identical structure, only the `icon="<emoji>"` props change to `icon={Component}`):
```tsx
                <StatCard
                  icon={Package}
                  value={
                    periodJobs.length
                  }
                  title="Total jobs"
                  caption="Jobs in this period"
                />

                <StatCard
                  icon={CircleCheck}
                  value={
                    completedJobs.length
                  }
                  title="Completed"
                  caption="Delivered or completed jobs"
                />

                <StatCard
                  icon={Calendar}
                  value={
                    plannedJobs.length
                  }
                  title="Planned"
                  caption="Booked, planned or allocated jobs"
                />

                <StatCard
                  icon={Banknote}
                  value={formatMoney(
                    revenue
                  )}
                  title="Revenue"
                  caption="Customer job value"
                />

                <StatCard
                  icon={Receipt}
                  value={formatMoney(
                    subcontractorCost
                  )}
                  title="Subcontractor cost"
                  caption="External haulage cost"
                />

                <StatCard
                  icon={TrendingUp}
                  value={formatMoney(
                    margin
                  )}
                  title="Gross margin"
                  caption={`${marginPercent.toFixed(
                    1
                  )}% of revenue`}
                />

                <StatCard
                  icon={Truck}
                  value={`${ownFleetJobs} / ${subbedJobs.length}`}
                  title="Own fleet / subbed"
                  caption="In-house vs subcontracted"
                />
              </div>

              <SectionTitle>
                Delivery & POD
              </SectionTitle>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatCard
                  icon={MapPin}
                  value={`${deliveredStops.length} / ${deliveryStops.length}`}
                  title="Stops delivered"
                  caption="Delivered vs delivery stops"
                />

                <StatCard
                  icon={Camera}
                  value={podRate}
                  title="POD rate"
                  caption="Delivery completion rate"
                />

                <StatCard
                  icon={Timer}
                  value={pendingPods}
                  title="PODs pending"
                  caption="Delivery stops awaiting POD"
                />
              </div>

              <SectionTitle>
                Invoicing
              </SectionTitle>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatCard
                  icon={Banknote}
                  value={formatMoney(
                    invoicedTotal
                  )}
                  title="Invoiced total"
                  caption="Invoices issued in this period"
                />

                <StatCard
                  icon={Send}
                  value={`${draftCount} / ${sentCount} / ${paidCount}`}
                  title="Draft / sent / paid"
                  caption="Invoice pipeline"
                />

                <StatCard
                  icon={TriangleAlert}
                  value={
                    overdueInvoices.length
                  }
                  title="Overdue invoices"
                  caption="Unpaid invoices past due"
                />

                <StatCard
                  icon={CircleDollarSign}
                  value={formatMoney(
                    overdueValue
                  )}
                  title="Overdue value"
                  caption="Outstanding past due"
                />
              </div>

              <SectionTitle>
                Growth & compliance
              </SectionTitle>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatCard
                  icon={Sparkles}
                  value={newCustomers}
                  title="New customers"
                  caption="Customers added in this period"
                />

                <StatCard
                  icon={Clock}
                  value={hoursAlerts}
                  title="Drivers' hours alerts"
                  caption="Driver-days over 9 hours"
                />

                <StatCard
                  icon={Siren}
                  value={
                    violationEvents
                  }
                  title="Violation events"
                  caption="Detected compliance events"
                />

                <StatCard
                  icon={Radio}
                  value={speedAlerts}
                  title="Speed alerts"
                  caption={`Readings over ${SPEED_ALERT_THRESHOLD} km/h`}
                />

                <StatCard
                  icon={Clock}
                  value={`${drivingHours.toFixed(
                    1
                  )} h`}
                  title="Driving hours logged"
                  caption="Total driving time in this period"
                />
              </div>

              <SectionTitle>
                Fleet — right now
              </SectionTitle>

              <p className="mb-2 text-sm text-ink-3">
                Snapshot figures are not
                affected by the period
                selector.
              </p>

              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <StatCard
                  icon={Truck}
                  value={`${activeVehicles} / ${vehicles.length}`}
                  title="Active vehicles"
                  caption="Active vs total fleet"
                />

                <StatCard
                  icon={Briefcase}
                  value={
                    billableVehicles
                  }
                  title="Billable vehicles"
                  caption="Active vehicles marked billable"
                />

                <StatCard
                  icon={Wrench}
                  value={
                    vehiclesOffRoad
                  }
                  title="Vehicles off road"
                  caption="Inactive / VOR vehicles"
                />

                <StatCard
                  icon={UserCheck}
                  value={`${activeDrivers} / ${drivers.length}`}
                  title="Active drivers"
                  caption="Active vs total drivers"
                />

                <StatCard
                  icon={FileText}
                  value={
                    licencesExpiringSoon
                  }
                  title="Licences expiring"
                  caption="Within the next 30 days"
                />
              </div>
```

- [ ] **Step 4: Manually verify in the browser**

Run: `npm run dev`, sign in, go to `/stats`.
Expected: every KPI tile shows a small blue-tinted icon square instead of an emoji, correctly matched per the mapping above.

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add app/stats/page.tsx
git commit -m "fix: replace Stats page emoji with lucide icons"
```

---

### Task 9: Super Admin dashboard and layout — emoji to icons

**Context:** `app/super-admin/page.tsx` and `app/super-admin/layout.tsx` are legacy inline-style pages (a stock photo background, `style={{}}` props, raw hex colors), not part of the `.ds` token system. Icons here render plainly (no accent-tinted chip) since there's no established blue/token palette on this page to tint against, and the cards themselves already sit on white — a colored chip would be introducing a new, disconnected design element rather than matching the existing (already ad hoc) look. `lucide-react` icons accept `size`/`color` props directly and don't depend on Tailwind or `.ds`, so they work here without any wrapper changes.

**Files:**
- Modify: `app/super-admin/page.tsx`
- Modify: `app/super-admin/layout.tsx`

- [ ] **Step 1: `app/super-admin/page.tsx` — add imports and swap the `stats` array**

At the top of the file, before `export default function SuperAdminPage() {`:

```tsx
import { Building2, Truck, Users, Banknote, FileText, type LucideIcon } from "lucide-react";

```

Old (lines 1-28):
```tsx
export default function SuperAdminPage() {

    const stats = [
        {
            title: "Companies",
            value: "24",
            description: "Active companies using TMS",
            icon: "🏢",
        },
        {
            title: "Vehicles",
            value: "186",
            description: "Total registered vehicles",
            icon: "🚚",
        },
        {
            title: "Users",
            value: "93",
            description: "Active system users",
            icon: "👥",
        },
        {
            title: "Monthly Revenue",
            value: "£4,320",
            description: "Vehicle based billing",
            icon: "💷",
        },
    ];
```

New:
```tsx
export default function SuperAdminPage() {

    const stats: Array<{ title: string; value: string; description: string; icon: LucideIcon }> = [
        {
            title: "Companies",
            value: "24",
            description: "Active companies using TMS",
            icon: Building2,
        },
        {
            title: "Vehicles",
            value: "186",
            description: "Total registered vehicles",
            icon: Truck,
        },
        {
            title: "Users",
            value: "93",
            description: "Active system users",
            icon: Users,
        },
        {
            title: "Monthly Revenue",
            value: "£4,320",
            description: "Vehicle based billing",
            icon: Banknote,
        },
    ];
```

- [ ] **Step 2: Swap the `links` array**

Old (lines 31-56):
```tsx
    const links = [
        {
            title: "Companies",
            description: "View and manage customer companies",
            href: "/super-admin/companies",
            icon: "🏢",
        },
        {
            title: "Users",
            description: "Manage platform users",
            href: "/super-admin/users",
            icon: "👥",
        },
        {
            title: "Billing",
            description: "Vehicle based billing configuration",
            href: "/super-admin/billing",
            icon: "💷",
        },
        {
            title: "Invoices",
            description: "Generate and track invoices",
            href: "/super-admin/invoices",
            icon: "📄",
        },
    ];
```

New:
```tsx
    const links: Array<{ title: string; description: string; href: string; icon: LucideIcon }> = [
        {
            title: "Companies",
            description: "View and manage customer companies",
            href: "/super-admin/companies",
            icon: Building2,
        },
        {
            title: "Users",
            description: "Manage platform users",
            href: "/super-admin/users",
            icon: Users,
        },
        {
            title: "Billing",
            description: "Vehicle based billing configuration",
            href: "/super-admin/billing",
            icon: Banknote,
        },
        {
            title: "Invoices",
            description: "Generate and track invoices",
            href: "/super-admin/invoices",
            icon: FileText,
        },
    ];
```

- [ ] **Step 3: Update the two render blocks to render the icon component**

Old (lines 111-113, inside the `stats.map`):
```tsx
                            <div style={{ fontSize: 28, marginBottom: 8 }}>
                                {item.icon}
                            </div>
```

New:
```tsx
                            <div style={{ marginBottom: 8, color: "#333" }}>
                                <item.icon size={28} aria-hidden />
                            </div>
```

Old (lines 170-177, inside the `links.map`):
```tsx
                            <div
                                style={{
                                    fontSize: 30,
                                    marginBottom: 10,
                                }}
                            >
                                {card.icon}
                            </div>
```

New:
```tsx
                            <div style={{ marginBottom: 10, color: "#333" }}>
                                <card.icon size={30} aria-hidden />
                            </div>
```

- [ ] **Step 4: `app/super-admin/layout.tsx` — swap the header emoji**

Old (line 61):
```tsx
          <strong style={{ fontSize: 18 }}>⚡ Super Admin</strong>
```

New: add the import first, at the top of the file after the existing imports (after line 5, `import { SUPER_ADMIN_ROLE, extractRoleName } from "../../lib/roles";`):

```tsx
import { Zap } from "lucide-react";
```

Then replace line 61:
```tsx
          <strong style={{ fontSize: 18, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Zap size={16} aria-hidden /> Super Admin
          </strong>
```

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, sign in as a super admin (or use the local dev-login helper with a super-admin account), go to `/super-admin`.
Expected: the four stat cards and four link cards show plain dark icons instead of emoji; the "Super Admin" header label shows a small lightning-bolt icon before the text.

- [ ] **Step 6: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add app/super-admin/page.tsx app/super-admin/layout.tsx
git commit -m "fix: replace Super Admin dashboard emoji with lucide icons"
```

---

### Task 10: Drivers page — compliance badge icons

**Files:**
- Modify: `components/Badge.tsx`
- Modify: `app/drivers/page.tsx`

- [ ] **Step 1: Give `Badge` room for an icon**

Lucide icons default to `stroke="currentColor"`, so they automatically pick up whatever text color `Badge`'s `tone` sets — no color prop needed. `Badge` just needs a small gap between an icon and its text.

Old (`components/Badge.tsx` line 22):
```tsx
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
```

New:
```tsx
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
```

- [ ] **Step 2: Add the icon imports to `app/drivers/page.tsx`**

After the existing imports (after line 12, `import Button from "../../components/Button";`):

```tsx
import { CircleCheck, TriangleAlert } from "lucide-react";
```

- [ ] **Step 3: Replace the compliance badges**

Old (lines 1625-1640):
```tsx
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {warnings.length === 0 ? (
                        <Badge tone="success">
                          ✓ Compliance current
                        </Badge>
                      ) : (
                        warnings.map((warning) => (
                          <Badge
                            key={warning}
                            tone="warning"
                          >
                            ⚠ {warning}
                          </Badge>
                        ))
                      )}
                    </div>
```

New:
```tsx
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {warnings.length === 0 ? (
                        <Badge tone="success">
                          <CircleCheck size={12} aria-hidden />
                          Compliance current
                        </Badge>
                      ) : (
                        warnings.map((warning) => (
                          <Badge
                            key={warning}
                            tone="warning"
                          >
                            <TriangleAlert size={12} aria-hidden />
                            {warning}
                          </Badge>
                        ))
                      )}
                    </div>
```

- [ ] **Step 4: Manually verify in the browser**

Run: `npm run dev`, sign in, go to `/drivers`.
Expected: compliance badges show a small check or warning-triangle icon before the text instead of a Unicode ✓/⚠ glyph, in the same green/amber tone as before.

- [ ] **Step 5: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add components/Badge.tsx app/drivers/page.tsx
git commit -m "fix: replace driver compliance badge glyphs with lucide icons"
```

---

### Task 11: Tracking map — truck marker icon

**Context:** This marker is built with vanilla DOM APIs (`document.createElement`), not JSX, because it's handed to the TomTom map SDK as a plain HTML element — `lucide-react` components can't be used here. This inlines the same `truck` SVG markup Lucide ships (24×24 viewBox, `stroke="currentColor"`), so it's visually identical to every other `Truck` icon used elsewhere in the app (the sidebar nav, Stats, Super Admin).

**Files:**
- Modify: `app/tracking/TrackingMap.tsx:115-135` (`createVehicleMarker`)

- [ ] **Step 1: Replace the emoji with an inline SVG, and set an explicit icon color**

The current `cssText` (lines 127-138) sets a `background` (green when live, amber otherwise) but no `color`, so an SVG using `stroke="currentColor"` would inherit whatever text color the map surface happens to have, not necessarily something visible against green/amber. Add an explicit white `color` alongside the icon swap.

Old (lines 119-138):
```tsx
  const element = document.createElement("div");
  const live = state === "live";

  element.textContent = "🚚";
  element.title = live
    ? "Live vehicle position"
    : "Last known vehicle position";

  element.style.cssText = [
    "width:40px",
    "height:40px",
    "border-radius:50%",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font-size:20px",
    live ? "background:#16a34a" : "background:#d97706",
    "border:3px solid white",
    "box-shadow:0 2px 9px rgba(0,0,0,.5)",
  ].join(";");
```

New:
```tsx
  const element = document.createElement("div");
  const live = state === "live";

  element.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>' +
    '<path d="M15 18H9"/>' +
    '<path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>' +
    '<circle cx="17" cy="18" r="2"/>' +
    '<circle cx="7" cy="18" r="2"/>' +
    "</svg>";
  element.title = live
    ? "Live vehicle position"
    : "Last known vehicle position";

  element.style.cssText = [
    "width:40px",
    "height:40px",
    "border-radius:50%",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "color:white",
    live ? "background:#16a34a" : "background:#d97706",
    "border:3px solid white",
    "box-shadow:0 2px 9px rgba(0,0,0,.5)",
  ].join(";");
```

(`font-size:20px` is dropped — it only sized the emoji glyph; the SVG is sized directly via its own `width`/`height` attributes.)

- [ ] **Step 2: Manually verify in the browser**

Run: `npm run dev`, sign in, go to `/tracking` with an active job that has a vehicle position.
Expected: the vehicle marker on the map shows a clean white truck icon instead of the emoji glyph, visible against both the green (live) and amber (last known) marker backgrounds.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add app/tracking/TrackingMap.tsx
git commit -m "fix: replace tracking map truck marker emoji with an inline lucide icon"
```

---

### Task 12: POD share page — lock icon

**Files:**
- Modify: `app/pod/share/[token]/page.tsx:469-473`

- [ ] **Step 1: Add the import**

After the existing imports (after line 4, `import ShareActions from "./ShareActions";`):

```tsx
import { Lock } from "lucide-react";
```

- [ ] **Step 2: Replace the emoji**

Old (lines 469-473):
```tsx
        <footer className="rounded-xl border border-slate-700 bg-[#111c2e] p-5 print:border-slate-300 print:bg-white">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-blue-500 text-lg text-blue-400">
              🔒
            </div>
```

New:
```tsx
        <footer className="rounded-xl border border-slate-700 bg-[#111c2e] p-5 print:border-slate-300 print:bg-white">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-blue-500 text-blue-400">
              <Lock size={18} aria-hidden />
            </div>
```

(Dropped `text-lg`, which only sized the emoji glyph — the icon is sized directly via the `size` prop instead.)

- [ ] **Step 3: Manually verify in the browser**

This page is only reachable via a valid signed share token. If you don't have one handy, at minimum confirm the change compiles and typechecks; a full visual check can happen in the signed-in QA pass (Task 13).

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/pod/share/[token]/page.tsx"
git commit -m "fix: replace POD share page lock emoji with a lucide icon"
```

---

### Task 13: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, 0 failures.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: builds successfully (catches anything the dev server's fast refresh might mask, e.g. unused-import lint-adjacent issues in strict mode).

- [ ] **Step 4: Grep for any remaining emoji in JSX**

Run: `grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" app components --include="*.tsx" | grep -v "node_modules"`
Expected: no output, or only matches inside comments/strings that were already out of scope per the design spec (typographic arrows `→`/`←` are not emoji and won't match this range).

- [ ] **Step 5: Signed-in manual QA pass**

Run: `npm run dev`, sign in (see the local sign-in helper), and check, in both dark (default) and light mode:
- `/invoices` — all ten tabs readable and visibly clickable; hover works; the four Credit Notes buttons visible on hover.
- `/settings` — icon chips instead of emoji.
- `/stats` — icon chips instead of emoji across all sections.
- `/super-admin` — plain icons instead of emoji (requires a super-admin account).
- `/drivers` — compliance badge icons.
- `/tracking` — truck marker icon (requires an active job with a position).
- A `<select>` on at least two different pages (e.g. `/jobs` new job form, `/invoices` credit note editor) — custom chevron, no overlap with text.
- A date input (e.g. `/jobs` new job form) — visible calendar icon in dark mode; switch to light mode and confirm it's still visible.

- [ ] **Step 6: Update README if page status changed**

Read `README.md`'s page inventory table. This pass doesn't change any page's functional status (OK/PARTIAL/LAUNCHER/STUB/PLANNED) — it's cosmetic only — so no update should be needed. Confirm this assumption holds; if any touched page's status line references outdated visual details, update it.
