# Console Restyle, Remaining Pages: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the last 13 legacy-styled console files (invoices, customers, subcontractors, vehicles, tachograph, telematics, stats, and the settings family) onto the `.ds` design system with zero logic change, on one branch with one commit per page.

**Architecture:** Each commit is a pure restyle of one page: inline `CSSProperties` objects and hardcoded hex are replaced with `.ds` token classes and the shared components in `components/`. Hooks, handlers, state, queries, and conditions do not change. Two new presentational components (`Select`, `MessageBanner`) are built first and used only on pages this batch touches. Suspicious logic goes in a findings doc, never fixed here.

**Tech Stack:** Next.js app router, Tailwind with CSS-variable tokens (`tailwind.config.ts` + `app/tokens.css`), shared components in `components/`, vitest (`npm test`).

**Spec:** `docs/superpowers/specs/2026-08-18-console-restyle-remaining-design.md`

---

## File Structure

- Create: `components/Select.tsx`, `components/MessageBanner.tsx` (Task 2)
- Create: `docs/superpowers/reviews/2026-08-18-console-restyle-remaining-findings.md` (Task 1)
- Modify (one commit each): `app/tachograph/page.tsx`, `app/telematics/page.tsx`, `app/settings/page.tsx`, `app/settings/permissions/page.tsx`, `app/settings/invoices/page.tsx`, `app/settings/portal-invites/page.tsx`, `app/settings/licences/page.tsx`, `app/settings/company/page.tsx`, `app/stats/page.tsx`, `app/vehicles/page.tsx`, `app/customers/page.tsx`, `app/subcontractors/page.tsx`, `app/invoices/page.tsx`

No other file changes. In particular `app/components/TenantGate.tsx`, the API routes, and the already-restyled pages are untouched.

---

## Restyle Reference

Every restyle task follows this recipe. It is the single source of truth for conversions; per-task sections list only what is unique to that page.

### Hard rules

1. **Logic freeze.** Do not change hooks, handlers, state shapes, queries, conditions, `useMemo` bodies, or the props wired to handlers. `value=`, `onChange=`, `onClick=`, `onSubmit=`, `disabled=`, `required`, `min`, `max`, `step`, `placeholder` expressions move to the new elements verbatim. If something looks wrong, add a findings entry and move on.
2. **`.ds` wrapper is mandatory.** Tailwind preflight is OFF in this repo. Every page shell must be `<div className="ds min-h-screen bg-canvas font-sans text-ink">`. This is the first thing checked on every page.
3. **No alpha modifiers.** Token colors are plain `var()` strings, so `bg-primary/10` compiles to NOTHING, silently. Use the `*-tint` tokens.
4. **`Button` defaults to `type="button"`.** When converting a submit button inside `<form onSubmit=...>` to `<Button>`, add `type="submit"` explicitly. (Survey note: every existing button on these 13 pages already carries an explicit `type`; carry each one over verbatim.)
5. **Keep `disabled={...}` expressions** exactly as they are on converted buttons, including "Saving..." label swaps (finding 15 already covers the family-wide cleanup; do not adopt `Button`'s `loading` prop here).
6. **Delete a style object/constant only after nothing references it.** Finish converting the file, then grep it for `styles.` and `Style}` and `Style)` before removing. Several pages use individually named constants (`pageStyle`, `inputStyle`, ...), not one `styles` object.
7. **Keep each page's existing gate wrapper** (`TenantGate`, role checks, tenant filters) exactly where it is. Adding or removing a gate is logic. Pages with NO gate (tachograph, telematics, settings hub, permissions, settings/invoices, company) stay ungated; that is a findings entry, not a fix.
8. **Data-driven styling survives as data-driven classes.** Where a style is computed from data (compliance level, active tab, message tone), re-express it as a ternary/lookup that picks className strings. The *condition* is copied verbatim; only the chosen values change from hex objects to token classes.
9. **Placeholder-only inputs stay raw.** Shared `Field`/`Select` require a `label`. Inputs whose only name is a placeholder (vehicles' 4 detail inputs, licences' whole form, customers' search, portal-invites' selects) keep their raw element with the token input/select classes below. Adding a visible label changes the UI; adding aria-labels is the queued findings-21/31 pass. Log, don't fix.
10. **Do not retype emoji or suspect characters.** `/stats` icons include ZWJ sequences (ðŸ§‘â€âœˆï¸) and variation selectors; `/invoices` contains mojibake literals (`Ã¢â‚¬â€` in `formatDate`, `Ã‚Â·` in option labels). Edit surgically around them; never rewrite the line by hand. The mojibake gets a findings entry.
11. **The Unsplash background image is removed** wherever it appears (tachograph, telematics, settings hub, permissions, licences, company, stats, vehicles). The dark scrim div and hardcoded white text go with it: with the image gone the page sits on `bg-canvas` and text becomes standard ink classes. This is styling, not logic.
12. **MessageBanner stays mounted.** Replace `{message ? <div style={styles.message}>{message}</div> : null}` with an always-rendered `<MessageBanner ...>{message}</MessageBanner>` (it renders `sr-only` when empty). Mounting the live region permanently is what makes announcements work. Do NOT keep the conditional.

### Token map

| Legacy inline pattern | Replacement |
|---|---|
| `<main style={...page...}>` + container/scrim div | `<div className="ds min-h-screen bg-canvas font-sans text-ink"><main className="mx-auto max-w-[1480px] px-6 py-8">` (keep a page's narrower `maxWidth` as e.g. `max-w-[1000px]` where it had one) |
| eyebrow / kicker text | `<div className="text-kicker uppercase text-ink-3">` |
| `<h1>` | `<h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">` |
| subtitle paragraph | `<p className="mb-4 text-sm text-ink-3">` |
| panel / card | `<Card>` from `components/Card.tsx`, or `<section className="rounded-lg border border-line bg-surface p-4 shadow-sm">` when it must stay a `<section>`/`<form>` element |
| `<h2>` section title | `<h2 className="mb-1 text-md font-semibold text-ink">` (or `Card`'s `kicker` prop) |
| sub-section `<h3>`/`SectionTitle` helpers | `<h3 className="mb-2 text-kicker uppercase text-ink-3">` |
| message banner (any tone) | `<MessageBanner tone={...}>` from Task 2 |
| label + `<input>` pair (label text present) | `<Field id="..." label="..." ... />`; ids use a page prefix (`veh-`, `cust-`, `sub-`, `co-`, `lic-`, `inv-`) |
| label + `<select>` pair (label text present) | `<Select id="..." label="...">` from Task 2 |
| label + `<textarea>` pair | `<Textarea id="..." label="..." ... />` |
| label-wrapped control inside a LOCAL helper component | convert the helper's internals to the same classes Field/Select/Textarea use, keeping the wrapped-`<label>` structure (no ids needed; accessible name unchanged). See per-task notes. |
| raw `<select>` (no label) | `className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"` |
| raw `<input>` (no label) | `className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"` |
| raw `<textarea>` | the input classes plus `min-h-24 py-2` (keep any `rows`) |
| checkbox label row | `<label className="flex items-center gap-2 text-sm text-ink-2">` with the `<input type="checkbox">` untouched |
| form grid | `<div className="grid gap-3 sm:grid-cols-2">` or `sm:grid-cols-2 lg:grid-cols-3` for the wide auto-fit grids |
| primary action button | `<Button type="submit">` / `<Button onClick={...}>` |
| neutral / cancel button | `<Button variant="secondary">` |
| destructive button | `<Button variant="danger">` |
| status pill | `<Badge tone={...}>`: red/expired/hold â†’ `danger`, amber/warning â†’ `warning`, ok/valid/active/eligible â†’ `success`, else `neutral` |
| summary tile (value + label, no icon) | `<Stat label="..." value={String(...)} />`, tiles in `<div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">` |
| `<table>` | keep the table, wrap in `<Card flush><div className="overflow-x-auto"><table className="w-full border-collapse text-sm">`; `<th className="border-b border-line px-3 py-2 text-left text-kicker uppercase text-ink-3">`; `<td className="border-b border-line px-3 py-2 text-ink">`; right-aligned money columns add `text-right font-mono tabular-nums` |
| operational data (registrations, references, money, dates, coordinates) | add `font-mono` (`tabular-nums` for figures) |
| card-list grid | `<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">` (matches the auto-fit minmax(300-330px) intent) |
| record card `<article>`/`<div>` | `<article className="rounded-lg border border-line bg-surface-2 p-3">` |
| `Info`-style label/value cells | `<span className="text-kicker uppercase text-ink-3">` + `<strong className="block text-sm text-ink">` |
| empty state | `<p className="text-sm text-ink-3">` |

Reference implementations to imitate: `app/drivers/page.tsx` (page shell, helper-component conversion, banners) and `app/pod/page.tsx` (Stat grid, toolbar) on current main.

### Per-page verification loop

Run after converting each page, before its commit:

```powershell
npm run typecheck
npm run build
npm test
```

Expected: all clean, vitest counts equal to the Task 0 baseline. Then grep the page for leftovers (`<file>` = the page just converted):

```powershell
git grep -n "style={styles\|Style}\|Style)\|style={{" -- "<file>"
git grep -n "unsplash\|#[0-9a-fA-F]\{6\}\|rgba(" -- "<file>"
```

Expected: no matches, EXCEPT the documented dynamic survivors listed in that page's task (each survivor is a className ternary, not a `style=` object, so in practice both greps should end up empty on every page).

---

## Task 0: Branch and baseline

**Files:** none (branch only)

- [x] **Step 1: Confirm the working tree**

```powershell
git status
```

Expected: on `main` with the spec commit `fd91941` present; only pre-existing noise (`docs/sql/schema_rls_dump.sql` modified; `docs/handoffs/`, `schema_dump.json`, `scripts/` untracked). None of those paths is touched by this plan. If anything under `app/` or `components/` is dirty, stop and ask Ethan.

- [x] **Step 2: Create the branch**

```powershell
git checkout -b ethan/console-restyle-remaining main
```

- [x] **Step 3: Record the vitest baseline**

```powershell
npm test
```

Write down the total test-file and test counts. Every later task compares against these numbers (no logic changes, so the counts must never move).

## Task 1: Findings doc

**Files:**
- Create: `docs/superpowers/reviews/2026-08-18-console-restyle-remaining-findings.md`

- [x] **Step 1: Create the doc with the entries already known**

```markdown
# Console Restyle (Remaining Pages) Findings

Logged while restyling `ethan/console-restyle-remaining`. Nothing here is
fixed on that branch (spec: logic freeze). Each entry: file, what was
seen, why it matters, suggested follow-up. Continues the queue in
2026-08-18-stuart-integration-findings.md.

## Known before the restyle started

### 1. /tachograph and /telematics have no tenant scoping
Neither page uses TenantGate, useTenant, or a tenant filter. Tachograph
selects `drivers` and `driver_activity_logs`, telematics selects
`telematics_positions`, all via bare `select("*")` with `limit`. RLS is
the only guard, if it covers those tables. Needs the tenant-context
treatment when the freeze lifts.

### 2. /settings/invoices (Billing) counts licences without a tenant filter
`vehicle_licences` is queried with only `.eq("active", true)`, so the
"Monthly Charge" figure is cross-tenant if RLS allows it. Same
treatment needed as entry 1.

### 3. /settings/permissions is unscoped and its toggle can only add
`profiles` is selected with no tenant filter. The checkbox grid is
uncontrolled (no `checked` prop), so it never reflects saved state, and
`toggle()` only upserts a `user_permissions` row; nothing ever deletes
one, so unticking is impossible. Pre-existing logic, frozen; the page
needs a real read-modify-write cycle when the freeze lifts.

### 4. /settings/company bypasses the tenant switcher
No TenantGate/useTenant. It resolves tenancy from a direct `profiles`
lookup (`resolveCompanyId`), reads `profiles.company_id` but writes
`company_profiles.tenant_id`. Same class as the /assets gap (Stuart
findings entry 10).

### 5. /settings/company ships console.log debug scaffolding
Auth user, Supabase URL, profile rows, and the save payload are logged
to the console (lines ~233-473 pre-restyle). Remove or gate behind a
dev flag when the freeze lifts.

### 6. /vehicles updates and inserts skip filterByTenant
`saveVehicle`'s update/insert path (~lines 436-449 pre-restyle) does
not go through `tenant.filterByTenant`, unlike the fleet-policy writes
on the same page. RLS is the only guard on the update's row scope.

### 7. Mojibake and em-dashes in /invoices copy
`formatDate` returns the literal `Ã¢â‚¬â€` (corrupted em-dash) and option
labels use `Ã‚Â·` (corrupted middot). Carried verbatim under the content
freeze; fix the encoding and sweep for the no-em-dash convention when
the freeze lifts.

### 8. Placeholder-only controls across the batch
/vehicles' four vehicle-detail inputs, the whole /settings/licences
form, /customers' search input, and /settings/portal-invites' selects
have no label or aria-label. Same class as Stuart findings 21/31;
converge on shared Field/Select in the post-freeze pass.

## Logged during the restyle

(add entries here as they are found)
```

- [x] **Step 2: Commit**

```powershell
git add docs/superpowers/reviews/2026-08-18-console-restyle-remaining-findings.md
git commit -m @'
Start the findings log for the remaining console restyle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 2: Select and MessageBanner components

**Files:**
- Create: `components/Select.tsx`
- Create: `components/MessageBanner.tsx`

Presentational only; mirrors `Field`'s API and comment conventions. No unit tests: the existing `components/` primitives have none, and these contain no logic beyond class selection.

- [x] **Step 1: Write `components/Select.tsx`**

```tsx
import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper, same as Field. The class
   list matches Field's input classes so mixed forms align; see Field.tsx
   for the border-ink-3 contrast rationale. */

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Classes for the wrapping <div>, e.g. "sm:col-span-2". `className` targets the <select>. */
  wrapperClassName?: string;
  /** Renders the label as an uppercase Console kicker instead of body text. */
  kickerLabel?: boolean;
  children: ReactNode;
};

export default function Select({
  id,
  label,
  hint,
  error,
  className,
  wrapperClassName,
  kickerLabel,
  children,
  ...props
}: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("grid gap-1.5", wrapperClassName)}>
      <label
        htmlFor={id}
        className={
          kickerLabel
            ? "text-kicker uppercase text-ink-3"
            : "text-sm font-medium text-ink-2"
        }
      >
        {label}
      </label>
      <select
        id={id}
        aria-describedby={cn(hintId, errorId) || undefined}
        aria-invalid={error ? true : undefined}
        className={cn(
          "h-10 w-full min-w-0 rounded-md border bg-surface px-3 text-base text-ink",
          error ? "border-danger" : "border-ink-3",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {hint ? (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-danger-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

- [x] **Step 2: Write `components/MessageBanner.tsx`**

```tsx
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/* Renders correctly ONLY inside a `.ds` wrapper, same as Card and Badge.

   Always render this component (never behind `{message ? ...}`): the
   sr-only empty state keeps the live region mounted, which is what makes
   screen readers announce a message when it later appears. */

export type BannerTone = "neutral" | "info" | "success" | "warning" | "danger";

const tones: Record<BannerTone, string> = {
  neutral: "border-line bg-surface text-ink-2",
  info: "border-primary-tint-border bg-primary-tint text-primary-deep",
  success: "border-success-border bg-success-tint text-success-strong",
  warning: "border-warning-border bg-warning-tint text-warning-strong",
  danger: "border-danger-border bg-danger-tint text-danger-strong",
};

export default function MessageBanner({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BannerTone;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={
        children
          ? cn("mb-4 rounded-lg border p-3 text-sm", tones[tone], className)
          : "sr-only"
      }
    >
      {children}
    </div>
  );
}
```

- [x] **Step 3: Verify**

```powershell
npm run typecheck
npm run build
```

Expected: clean (the components are not imported anywhere yet; typecheck still validates them).

- [x] **Step 4: Commit**

```powershell
git add components/Select.tsx components/MessageBanner.tsx
git commit -m @'
Add Select and MessageBanner design-system components

Select mirrors Field for labelled native selects. MessageBanner is the
persistent tinted status banner with a permanently mounted live region,
so new restyle call sites are born accessible (Stuart findings 13/14).
Existing pages are swapped in the queued post-freeze pass, not here.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 3: Restyle /tachograph and /telematics

Two near-identical tiny pages: Unsplash background, dark scrim, white text, card grids, no tenant gating (findings entry 1; leave the queries alone). Neither has a form, a banner state, or a single handler beyond load.

**Files:**
- Modify: `app/tachograph/page.tsx`
- Modify: `app/telematics/page.tsx`

- [x] **Step 1: Convert /tachograph**

Structure after conversion (queries, state, and `loadData` untouched):

- Shell per the token map; header kicker "Compliance", `<h1>` "Tachograph", subtitle keeps the existing copy "EU Drivers Hours & WTD compliance".
- `{loading && <p className="text-sm text-ink-3">Loading...</p>}` (same condition).
- Driver grid: `<div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">`; each driver card `<article className="rounded-lg border border-line bg-surface p-4 shadow-sm">` with `<h3 className="mb-1 text-md font-semibold text-ink">{driver.name}</h3>` and `<p className="text-sm text-ink-3">{driver.driver_type}</p>`.
- "Recent Activity" `<h2>` per the token map.
- Log grid: same grid classes; each log card an `<article>` as above with `<strong className="text-sm font-semibold text-ink">{log.activity_type}</strong>`, the timestamp and duration lines as `<p className="font-mono text-sm text-ink-2">` (mono: operational data).
- Delete `cardStyle` and every inline `style` object including the Unsplash `<main>` and scrim div.

- [x] **Step 2: Run the per-page verification loop** on `app/tachograph/page.tsx`.

- [x] **Step 3: Commit**

```powershell
git add app/tachograph/page.tsx
git commit -m @'
Restyle /tachograph to the design system, logic untouched

The Unsplash background and scrim go away; the unscoped queries stay
exactly as they were (findings entry 1).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

- [x] **Step 4: Convert /telematics** the same way: kicker "Compliance", `<h1>` "Telematics", subtitle "Vehicle GPS tracking and performance data" (existing copy), position cards with `<strong>` "Vehicle Position" and the latitude/longitude/speed/timestamp lines as `<p className="font-mono text-sm text-ink-2">`.

- [x] **Step 5: Run the per-page verification loop** on `app/telematics/page.tsx`.

- [x] **Step 6: Commit**

```powershell
git add app/telematics/page.tsx
git commit -m @'
Restyle /telematics to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 4: Restyle the small settings pages (hub, permissions, invoices)

Three tiny pages, three commits. All lose the Unsplash background. None gains a gate (findings entries 2 and 3).

**Files:**
- Modify: `app/settings/page.tsx`
- Modify: `app/settings/permissions/page.tsx`
- Modify: `app/settings/invoices/page.tsx`

- [x] **Step 1: Convert /settings (hub)**

Server component, no state. Shell per token map; kicker "Admin", `<h1>` "Settings", existing subtitle copy. Card grid `<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">`; each card:

```tsx
<a
  key={card.href}
  href={card.href}
  className="block rounded-lg border border-line bg-surface p-4 shadow-sm hover:border-primary-tint-border hover:shadow-md"
>
  <div aria-hidden className="mb-2 text-2xl">{card.icon}</div>
  <h2 className="mb-1 mt-0 text-md font-semibold text-ink">{card.title}</h2>
  <p className="m-0 text-sm text-ink-3">{card.description}</p>
</a>
```

The `cards` array (titles, descriptions, hrefs, emoji) is untouched. `aria-hidden` on the emoji div matches the /stats convention (finding 20 is about glyphs inside accessible names; these are decorative).

- [x] **Step 2: Verification loop** on `app/settings/page.tsx`, then commit:

```powershell
git add app/settings/page.tsx
git commit -m @'
Restyle /settings hub to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

- [x] **Step 3: Convert /settings/permissions**

- Shell per token map; kicker "Admin", `<h1>` "Permissions".
- Replace the conditional-less `message` state usage: the page sets `message` but never renders it today. RENDERING it would be a behavior change; leave it unrendered and leave the state alone. (Do not "helpfully" add a MessageBanner here.)
- Per-user card `<article className="mb-3 rounded-lg border border-line bg-surface p-4 shadow-sm">` with `<h3 className="mb-2 text-md font-semibold text-ink">{user.email}</h3>`.
- Checkbox grid `<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">`; each label per the checkbox row in the token map. The uncontrolled `<input type="checkbox" onChange={...}>` stays uncontrolled (findings entry 3).
- Delete the five named style constants (`pageStyle`...`gridStyle`) once unreferenced.

- [x] **Step 4: Verification loop** on `app/settings/permissions/page.tsx` (leftover grep must cover `Style}` names), then commit:

```powershell
git add app/settings/permissions/page.tsx
git commit -m @'
Restyle /settings/permissions to the design system, logic untouched

The upsert-only toggle and unscoped profiles query stay exactly as
they were (findings entry 3).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

- [x] **Step 5: Convert /settings/invoices (Billing)**

Kicker "Admin", `<h1>` "Billing". The single card becomes a `Stat`-style block; use the shared component since it is a plain value+label tile:

```tsx
<div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
  <Stat label="Monthly Charge" value={`Â£${count * PRICE}`} sub={`${count} licensed vehicles`} />
</div>
```

(`Stat` renders the value in mono; `count * PRICE` and the sub line keep the exact existing expressions.) Delete the four named style constants.

- [x] **Step 6: Verification loop** on `app/settings/invoices/page.tsx`, then commit:

```powershell
git add app/settings/invoices/page.tsx
git commit -m @'
Restyle /settings/invoices to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 5: Restyle /settings/portal-invites

Already flat-light and tenant-gated; a `styles` object page with two invite sections. Its selects are placeholder-only (findings entry 8): keep them raw.

**Files:**
- Modify: `app/settings/portal-invites/page.tsx`

- [x] **Step 1: Convert the page**

- Shell per token map, keep `max-w-[1000px]` (had `maxWidth: 1000`); kicker "Admin", `<h1>` "Portal Invitations", existing subtitle copy.
- `{message ? <div style={styles.message}>...}` â†’ always-mounted `<MessageBanner tone="neutral">{message}</MessageBanner>` (hard rule 12; the single string carries both errors and successes, so neutral; the tone split is queued, finding-30 pattern).
- The `!canManage` card â†’ `<Card>Only tenant admins can manage invites.</Card>` (same condition).
- Both invite sections â†’ `<section className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">` with `<h2 className="mb-3 text-md font-semibold text-ink">`.
- All four selects: raw select classes per token map (no labels exist; hard rule 9). Keep every option-building expression, including the "NO EMAIL"/"PORTAL ACTIVE" suffix logic, byte-identical.
- The subcontractor grid `styles.grid` â†’ `<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">`.
- Both buttons â†’ `<Button disabled={...} onClick={...}>` with the exact existing `disabled` and `onClick` expressions and the `busy ? "Working..." : ...` labels.
- Delete the `styles` object once unreferenced.

- [x] **Step 2: Verification loop**, then commit:

```powershell
git add app/settings/portal-invites/page.tsx
git commit -m @'
Restyle /settings/portal-invites to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 6: Restyle /settings/licences

Tenant-gated, Unsplash background, three-figure summary card, an all-placeholder form (hard rule 9), a neutral message box, and licence cards with toggle/delete buttons (`window.confirm` stays).

**Files:**
- Modify: `app/settings/licences/page.tsx`

- [x] **Step 1: Convert the page**

- Shell per token map (Unsplash + scrim removed); kicker "Admin", `<h1>` "Vehicle Licences", existing subtitle copy.
- Summary card â†’ three `Stat` tiles in the Stat grid: `Stat label="Licensed Vehicles" value={String(billableVehicleCount)}`, `Stat label="Monthly Charge" value={`Â£${monthlyTotal}`}`, `Stat label="Billing Rule" value="Â£10" sub="per licensed vehicle"`. Values keep the exact existing expressions.
- The `<form onSubmit={createLicence}>` â†’ `<form onSubmit={createLicence} className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">`. All five placeholder-only controls stay raw with token input/select classes (`required` attributes carried). The "Active for billing" checkbox label per the token-map checkbox row. Submit â†’ `<Button type="submit" disabled={saving}>{saving ? "Saving..." : "Add Licence"}</Button>` spanning `sm:col-span-2 lg:col-span-3` wrapped in a `<div>` so the grid keeps its shape.
- Message box â†’ always-mounted `<MessageBanner tone="neutral">{message}</MessageBanner>`.
- Loading card â†’ `<Card>Loading...</Card>` (same condition).
- Licence cards â†’ `<article className="rounded-lg border border-line bg-surface p-4 shadow-sm">` in `<div className="grid gap-3">`; `<h3 className="m-0 text-md font-semibold text-ink">{licence.licence_type}</h3>`; the five detail lines as Info-style pairs (kicker span + value; dates get `font-mono`). Buttons: toggle â†’ `<Button variant="secondary" onClick={...}>` with the existing ternary label; delete â†’ `<Button variant="danger" onClick={...}>`. `window.confirm` in `deleteLicence` is a handler, untouched.
- Delete `pageBackground` and the five style constants once unreferenced.

- [x] **Step 2: Verification loop**, then commit:

```powershell
git add app/settings/licences/page.tsx
git commit -m @'
Restyle /settings/licences to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 7: Restyle /settings/company

The big settings form: 7 sections, ~23 labelled inputs, 3 labelled selects, 1 textarea, a three-tone message state, and heavy debug logging (stays; findings entry 5). No gate (stays; findings entry 4). Style constants live INSIDE the component; they all go.

**Files:**
- Modify: `app/settings/company/page.tsx`

- [x] **Step 1: Convert the page**

- Shell per token map (Unsplash + scrim + white header text removed); kicker "Admin", `<h1>` "Company Profile", existing subtitle copy.
- The two pre-form fallback cards (`!companyId`, `loading || !profile`) â†’ `<Card className="font-medium">{...}</Card>` with the same conditions and children.
- The form stays `<form onSubmit={saveProfile} className="grid gap-4">`. Each `<section>` â†’ the section card classes with `<h2 className="mb-3 text-md font-semibold text-ink">` (replacing `sectionTitleStyle`); each of the six literal grid divs â†’ `<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">`.
- Every labelled field converts to the shared components with `co-` ids derived from the profile key: e.g. `<Field id="co-company-name" label="Company Name" required value={profile.company_name} onChange={...} />`, `<Select id="co-country" label="Country">{countryOptions.map(...)}</Select>`, `<Textarea id="co-notes" label="Notes" ... />`. Dynamic label text (the `isUS` swaps at old lines 672-674, 777, 788) moves into the `label` prop expression verbatim. Conditional fields/sections keep their exact `isUS`/`isGB`/`isTransportRelated` conditions.
- Message banner: replace the conditional `messageCardStyle` div with an always-mounted banner mapping the EXISTING `messageType` state:

```tsx
<MessageBanner
  tone={
    messageType === "error"
      ? "danger"
      : messageType === "success"
        ? "success"
        : "info"
  }
>
  {message}
</MessageBanner>
```

Keep it where it is in the form (near the submit button); moving it is gratuitous churn.
- Submit â†’ `<Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Profile"}</Button>` (existing label expressions; the opacity/cursor styling is replaced by Button's own disabled treatment, which is styling, not logic).
- Delete all eight in-component style constants once unreferenced. Do NOT touch `resolveCompanyId`, the console.logs, or the diagnostic strings.

- [x] **Step 2: Verification loop** (leftover grep must cover `Style}` names), then commit:

```powershell
git add app/settings/company/page.tsx
git commit -m @'
Restyle /settings/company to the design system, logic untouched

The manual tenant resolution and console.log scaffolding stay exactly
as they were (findings entries 4 and 5). First real consumer of the
shared Select component.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 8: Restyle /stats

Read-only page: 24 `StatCard` tiles with emoji icons, a period filter bar, two tables, an error-only banner. The local `StatCard` keeps its icon+caption shape (shared `Stat` has no icon/caption slots; the spec's "onto Stat where they are plain number cards" does not apply because none are plain); its INTERNALS convert to token classes. Hard rule 10 applies to every emoji.

**Files:**
- Modify: `app/stats/page.tsx`

- [x] **Step 1: Convert the page**

- Shell per token map (Unsplash + fixed-attachment background + scrim removed); kicker "Insights", `<h1>` "Company Stats", existing subtitle; the conditional tenant line â†’ `<p className="font-mono text-xs text-ink-3">` with the same condition and content.
- Refresh button â†’ `<Button variant="secondary" disabled={status === "loading"} onClick={...}>` with the existing label ternary.
- Error banner: `message` is error-only here, so the always-mounted banner is `<MessageBanner tone="danger">{message ? <><strong>Stats error</strong><div className="mt-1">{message}</div></> : null}</MessageBanner>` (same two-part content, same "Stats error" copy).
- Loading branch â†’ `<Card>Loading statistics...</Card>` (same condition).
- Period bar â†’ `<div className="mb-4 flex flex-wrap gap-2">`; each button keeps `type="button"`, `aria-pressed`, `onClick`, and label, with the whole-object style ternary re-expressed as a className ternary (hard rule 8):

```tsx
className={
  period === option.key
    ? "rounded-full border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-on-primary"
    : "rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-2"
}
```

- `SectionTitle` helper internals â†’ `<h2 className="mb-2 mt-6 text-md font-semibold text-ink">`; the fleet caption `<p className="mb-2 text-sm text-ink-3">`.
- Stat grids â†’ `<div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">`.
- `StatCard` internals â†’ tile markup mirroring shared `Stat`'s classes with the extra slots:

```tsx
<div className="flex min-w-0 flex-col items-start gap-1 rounded-lg border border-line bg-surface p-4 shadow-sm">
  <div aria-hidden="true" className="text-2xl">{icon}</div>
  <h2 className="m-0 font-mono text-2xl font-semibold tabular-nums slashed-zero text-ink">{value}</h2>
  <p className="m-0 text-sm font-semibold text-ink">{title}</p>
  <p className="m-0 text-xs text-ink-3">{caption}</p>
</div>
```

Props and all 24 call sites (icons included) are untouched.
- Both tables per the token-map table treatment (`Card flush` wrapper); Jobs/Completed/Revenue columns get `font-mono tabular-nums`, Revenue right-aligned.
- Delete all 21 module-level style constants once unreferenced.

- [x] **Step 2: Verification loop**, then commit:

```powershell
git add app/stats/page.tsx
git commit -m @'
Restyle /stats to the design system, logic untouched

StatCard keeps its icon+caption shape with converted internals; the
shared Stat tile has no icon or caption slot and none of these 24
figures is a plain value+label pair.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 9: Restyle /vehicles

Card-list page with compliance-driven card tinting (hard rule 8's biggest test), fleet-insurance and vehicle forms, a legend, `window.confirm` twice, `window.scrollTo` twice (all handlers, untouched). Four placeholder-only inputs stay raw (hard rule 9).

**Files:**
- Modify: `app/vehicles/page.tsx`

- [x] **Step 1: Convert the page**

- Shell per token map (Unsplash + scrim removed, white text â†’ ink classes); kicker "Fleet", `<h1>` "Vehicles", existing subtitle; `ComplianceLegend` stays in the header row (`flex flex-wrap items-start justify-between gap-3`).
- Helper conversions (do these first; most call sites inherit):
  - `SectionTitle` â†’ `<h3 className="mb-2 text-kicker uppercase text-ink-3">`.
  - `DateField` â†’ keep the wrapped-label structure with Field's classes: `<label className="grid gap-1.5"><span className="text-sm font-medium text-ink-2">{label}</span><input type="date" className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink" ... /></label>`.
  - `StatusBadge` internals â†’ `<Badge tone={result.level === "red" ? "danger" : result.level === "amber" ? "warning" : "success"}>{result.label}</Badge>`. The `small` prop becomes a no-op parameter kept for call-site compatibility (Badge has one size; visually equivalent at text-xs).
  - `ComplianceLegend` pills â†’ three `<Badge>` with tones `success`/`warning`/`danger` and the same three label strings.
  - `ComplianceItem` â†’ `<div className="rounded-md border border-line bg-surface p-2.5">` with kicker label span, `font-mono` date line (`formatDate(expiry)` or "Not set"), optional `extra` line `text-xs text-ink-3`, then the `StatusBadge` call unchanged.
  - `vehicleCardStyle(level)` â†’ returns className strings instead of style objects (same `level` switch): red â†’ `"rounded-lg border-2 border-danger bg-danger-tint p-4"`, amber â†’ `"rounded-lg border-2 border-warning bg-warning-tint p-4"`, default â†’ `"rounded-lg border border-line bg-surface p-4 shadow-sm"`. (2px, not the old 3px, both non-default cases so the layout shift between states stays consistent; the ok case keeps 1px like today.)
- Fleet Insurance section (admin-gated condition untouched): section card + `<h2>`; policy cards â†’ `<article className="rounded-lg border border-line bg-surface-2 p-3">` in the card-list grid, detail rows as Info-style pairs (`font-mono` for dates/counts), `StatusBadge` call sites unchanged; empty state â†’ a plain tinted div, NOT a MessageBanner (static content must not get a live region): `<div className="rounded-lg border border-warning-border bg-warning-tint p-3 text-sm text-warning-strong">` (same copy, same condition).
- Fleet policy form: labelled pairs â†’ `Field`/`DateField`(converted)/`Textarea id="veh-policy-notes"`; the renewal-days input keeps `type="number" min={0} max={365}`; the auto-renew checkbox row per the token-map checkbox row (the faux-input span wrapper is styling, replaceable). Submit/cancel â†’ `Button` per token map with existing types/handlers/disabled.
- Vehicle form: the four placeholder-only inputs â†’ raw inputs with token input classes (hard rule 9). The Insurance Type and Fleet Insurance Policy selects both sit inside `<label>` wrappers with span labels (verified, lines 974-1015 pre-restyle): convert them like `DateField` (wrapped label, span gets the label classes, select gets the token select classes). The `insurance_type === "fleet"` conditional branch structure is untouched, and the fleet-policy option-label expression (with its `â€¢` separators) is carried byte-identical.
- Message box â†’ always-mounted `<MessageBanner tone="neutral">{message}</MessageBanner>`; loading card â†’ `<Card>Loading vehicles...</Card>`.
- Vehicle cards: `className={cn(vehicleCardStyle(cardCompliance.level), !vehicle.active && "opacity-70")}`, keeping the `opacity` condition verbatim as a class. Registration `<h3 className="m-0 font-mono text-md font-semibold text-ink">`; "type â€¢ make model" line `text-sm text-ink-3`; ComplianceItems grid `<div className="my-3 grid gap-2 sm:grid-cols-3">`; status line `text-sm text-ink-2`; action buttons â†’ `Button size="sm"` variants (`secondary` edit/toggle, `danger` delete) with existing conditions and handlers.
- Delete the loose style constants and both style functions' old bodies once unreferenced.

- [x] **Step 2: Verification loop** (grep also for `legendStyle\|vehicleCardStyle(`; both must now return/consume classNames only), then commit:

```powershell
git add app/vehicles/page.tsx
git commit -m @'
Restyle /vehicles to the design system, logic untouched

Compliance tinting survives as data-driven token classes with the same
level conditions; the unscoped vehicle update path stays as it was
(findings entry 6).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 10: Restyle /customers

Single-`styles`-object page with local helpers (the leverage point), separate error/success banners (the one page that gets two tones today), debounced search, `window.confirm` delete, `window.scrollTo` on edit; all handlers untouched.

**Files:**
- Modify: `app/customers/page.tsx`

- [x] **Step 1: Convert the page**

- Shell per token map, keep `max-w-[1450px]`; header: kicker "Commercial", `<h1>` "Customers", subtitle, "+ Add Customer" â†’ `<Button type="button" onClick={...}>`.
- Banners â†’ two always-mounted banners in the existing order: `<MessageBanner tone="danger">{errorMessage}</MessageBanner>` then `<MessageBanner tone="success">{message}</MessageBanner>`.
- Helper conversions (all call sites inherit): `Section` â†’ `<section className="border-t border-line pt-4 mt-4">` with `<h3 className="mb-3 text-kicker uppercase text-ink-3">{title}</h3>`; `TextField`/`TextareaField`/`SelectField` keep their wrapped-`<label>` structure with Field's span/input classes (the textarea keeps `rows={4}` and gains `min-h-24 py-2 resize-y`); `CheckboxField` per the token-map checkbox row; `Info` per the token-map Info pair.
- The form card â†’ `<form onSubmit={saveCustomer} className="mb-4 rounded-lg border border-line bg-surface p-4 shadow-sm">` behind the same `showForm` condition; grids â†’ `grid gap-3 sm:grid-cols-2 lg:grid-cols-3`; checkbox grids â†’ `grid gap-2 sm:grid-cols-2 lg:grid-cols-3`; Cancel/submit â†’ `Button` with existing explicit types and `disabled={saving}` (the opacity spread is replaced by Button's disabled styling).
- Customer Accounts section card: heading + count line (`text-sm text-ink-3`) + search input â†’ raw input with token input classes plus `sm:w-64` (hard rule 9, placeholder-only; the debounce effect keys off state, not the element, so classes are safe to change but do not remount or wrap it).
- Customer cards â†’ `<article className="rounded-lg border border-line bg-surface-2 p-3">` in the card-list grid. Status badge ternary (hard rule 8): same `credit_hold` â†’ `<Badge tone="danger">Credit Hold</Badge>`, `active` â†’ `<Badge tone="success">Active</Badge>`, else `<Badge tone="neutral">Inactive</Badge>` priority order. Info grid `grid grid-cols-2 gap-2`; Credit Limit value keeps its exact `toLocaleString` expression and gains `font-mono`. Tag row â†’ `<Badge tone="neutral">` for ADR/Tail Lift/Timed/POD and `<Badge tone="info">API</Badge>`, same render conditions. Edit â†’ `Button variant="secondary" size="sm"`, Delete â†’ `Button variant="danger" size="sm"`.
- Delete the `styles` object once unreferenced.

- [x] **Step 2: Verification loop**, then commit:

```powershell
git add app/customers/page.tsx
git commit -m @'
Restyle /customers to the design system, logic untouched

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 11: Restyle /subcontractors

Largest helper-component page: 40+ fields across three forms, compliance badges, tinted vehicle cards. Same helper-conversion strategy as /customers; `StatusBadge`/`subcontractorCardStyle` same treatment as /vehicles. No delete buttons anywhere (spec: keep it that way).

**Files:**
- Modify: `app/subcontractors/page.tsx`

- [x] **Step 1: Convert the page**

- Shell per token map; kicker "Carrier Network", `<h1>` "Subcontractors", subtitle.
- Banner â†’ always-mounted `<MessageBanner tone="neutral">{message}</MessageBanner>` (single undifferentiated string; tone split is queued. Add a findings entry mirroring Stuart finding 30 covering this page plus /vehicles, /settings/licences, and /settings/portal-invites, since entry 8 covers labels, not message tones).
- Helper conversions, identical treatment to /customers: `Section` (here it renders `<h3 styles.subheading>`), `TextField`, `TextareaField`, `SelectField`, `DateField` (wrapped-label + Field classes), `CheckboxField` (token-map checkbox row), `Info` (token-map pair).
- `StatusBadge` internals â†’ `<Badge tone={...}>` with the same redâ†’danger / amberâ†’warning / okâ†’success mapping and `result.label` children (labels like "EXPIRED 12d" are content, untouched). The employee eligibility badge ternary â†’ `<Badge tone="success">Eligible</Badge>` / `<Badge tone="danger">No Portal Access</Badge>`, same condition.
- `subcontractorCardStyle(level)` â†’ className-returning, same switch: red â†’ `"rounded-lg border-2 border-danger bg-danger-tint p-3"`, amber â†’ `"rounded-lg border-2 border-warning bg-warning-tint p-3"`, default â†’ `"rounded-lg border border-line bg-surface-2 p-3"`.
- The admin-gated main form (same `isAdmin` condition) â†’ form card with the section/grid classes from Task 10; submit/cancel buttons keep their explicit types.
- Subcontractor Accounts section: card list per token map; each card keeps name/type/StatusBadge/4 Info pairs; Edit + Manage â†’ `Button variant="secondary" size="sm"` (Manage's `onClick` only sets `selectedSubcontractorId`; untouched).
- The conditional `selectedSubcontractor` block: both sections (Employees, Vehicles) â†’ section cards; inline forms â†’ `grid gap-3 sm:grid-cols-2 lg:grid-cols-3` inside a `bg-surface-2` sub-card (`rounded-lg border border-line bg-surface-2 p-3 mb-3`); list cards per the card-list treatment; vehicle cards use the converted `subcontractorCardStyle`.
- `window.scrollTo` in `startEdit` untouched. Delete the `styles` object once unreferenced.

- [x] **Step 2: Verification loop**, then commit:

```powershell
git add app/subcontractors/page.tsx
git commit -m @'
Restyle /subcontractors to the design system, logic untouched

No edit/delete affordances added; compliance tinting survives as
data-driven token classes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 12: Restyle /invoices

The largest commit: Stuart's 9-tab accounts page. No `<form>` elements exist (every button is `type="button"` + onClick; keep that, do not introduce forms). `Tabs` from `components/Tabs.tsx` fits the tab strip. Hard rule 10 applies to the mojibake literals.

**Files:**
- Modify: `app/invoices/page.tsx`

- [x] **Step 1: Convert the page**

- Shell per token map, keep `max-w-[1500px]`; header: kicker "Customer Accounts", `<h1>` "Invoices & Accounts", subtitle; the three header `Metric` tiles â†’ shared `Stat` (they are exactly value+label): `<Stat label="Outstanding" value={money(outstandingTotal, "GBP")} />`, `<Stat label="Overdue invoices" value={String(overdueInvoices.length)} />`, `<Stat label="Ready to invoice" value={String(readyJobs.length)} />` in `<div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">`. Delete the local `Metric` component once unreferenced.
- Tab strip â†’ shared `Tabs`:

```tsx
<div className="mb-4 overflow-x-auto">
  <Tabs
    label="Accounts sections"
    tabs={TABS.map(([key, label]) => ({ id: key, label }))}
    activeId={tab}
    onChange={(id) => setTab(id as Tab)}
  />
</div>
```

`TABS`, `tab`, `setTab`, and the programmatic `setTab("invoices")` after invoice creation are untouched.
- Banner â†’ always-mounted `<MessageBanner tone="neutral">{message}</MessageBanner>` (single string, no tone data; queued).
- Local helper conversions (used across all tabs):
  - `Field` (label + children wrapper) â†’ `<label className="grid gap-1.5"><span className="text-sm font-medium text-ink-2">{label}</span>{children}</label>`.
  - Raw selects/inputs inside those Fields â†’ token select/input classes; the textarea keeps `rows` behavior and gains `min-h-24 py-2 resize-y`.
  - `ActionButton` â†’ renders `<Button type="button" onClick={onClick} disabled={working || disabled}>{working ? "Working..." : label}</Button>` (exact existing expressions).
  - `Status` â†’ `<Badge tone="neutral"><span className="capitalize">{value.replaceAll("_", " ")}</span></Badge>` (no valueâ†’color mapping exists today; inventing one is a behavior change. This mirrors Stuart finding 8, StatusBadge with no danger branch; add a findings entry for it).
  - `Info` â†’ token-map Info pair (money/date values get `font-mono` where the call site formats them).
  - `RecordCards` â†’ `<article className="rounded-lg border border-line bg-surface-2 p-3">` grid; the `<pre>` becomes `<pre className="m-0 whitespace-pre-wrap break-all font-mono text-xs text-ink-2">` (`whitespace-pre-wrap` + `break-all` preserve the load-bearing wrap behavior).
- `ReadyToInvoicePanel`: card + `rowBetween` header (`flex flex-wrap items-center justify-between gap-3`), the "N selected / total" summary line with `font-mono` figures, 2-Field grid, ActionButton, and the one real table per the token-map table treatment (checkbox column header stays empty; Price th/td get `text-right font-mono tabular-nums`). Row checkboxes untouched.
- `InvoicesPanel` and the accounting tab's cards: `<article className="rounded-lg border border-line bg-surface-2 p-3">`, invoice number `font-mono font-semibold`, `Status` call sites unchanged, Info grid `grid grid-cols-2 gap-2`.
- Xero card: same structure in a `Card`; Connect/Test â†’ `Button variant="secondary" type="button"` (Connect keeps its `window.location.assign` handler); Disconnect â†’ `Button variant="danger" type="button"` (its `window.confirm` handler untouched); button row `flex flex-wrap gap-2.5 mt-3`.
- The 6 form-tab sections (payments, credits, statements, chase, customer-pos, supplier-pos) all follow: section card + `<h2>` + `grid gap-3 sm:grid-cols-2 lg:grid-cols-3` + ActionButton + RecordCards. Every `value`/`onChange`/option expression byte-identical, mojibake included.
- Delete the `styles` object once unreferenced.

- [x] **Step 2: Verification loop**, then commit:

```powershell
git add app/invoices/page.tsx
git commit -m @'
Restyle /invoices to the design system, logic untouched

Stuart's nine-tab accounts page keeps every handler and API call; the
tab strip moves onto the shared Tabs component, header metrics onto
Stat, and the mojibake copy is carried verbatim (findings entry 7).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

## Task 13: Full verification and handoff

**Files:**
- Modify: `docs/superpowers/reviews/2026-08-18-console-restyle-remaining-findings.md` (entries added during the restyle)

- [x] **Step 1: Whole-branch checks**

```powershell
npm run typecheck
npm run build
npm test
```

Expected: all clean, vitest counts equal to the Task 0 baseline exactly.

- [x] **Step 2: Restyle-purity audit**

```powershell
git diff main...HEAD --stat
git grep -n "style={styles\|Style}\|style={{" -- "app/tachograph" "app/telematics" "app/settings" "app/stats" "app/vehicles" "app/customers" "app/subcontractors" "app/invoices"
git grep -rn "unsplash" -- "app"
```

Expected: the diff touches only the 13 pages, the 2 new components, and the 2 docs; both greps empty (`app/settings/users` is already clean and stays out of the diff). Then, per page, eyeball `git diff main...HEAD -- <page>` confirming only JSX/className/import lines moved: every `onClick`/`onChange`/`onSubmit`/`value`/`disabled` expression, every query, and every condition should appear identically on both sides of the diff.

- [x] **Step 3: Signed-in visual pass (read-only; live Supabase)**

WARNING per memory: `.env.local` points at the LIVE Supabase. View only; submit NO forms, click NO destructive buttons.

```bash
# Git Bash, dev server running in another terminal (npm run dev)
node scripts/dev-login.mjs <email> /tachograph
```

Open the printed link, then walk: /tachograph, /telematics, /settings (and its five subpages), /stats, /vehicles, /customers, /subcontractors, /invoices (click through all nine tabs; tab switching is client state, safe). At each page check desktop and a ~390px viewport: `.ds` shell present, no white-on-white text left over from scrim removal, cards/tables not overflowing, banners tinted correctly. Fix markup-only issues and amend nothing; new commits per fix.

- [x] **Step 4: Commit findings-doc additions**

```powershell
git add docs/superpowers/reviews/2026-08-18-console-restyle-remaining-findings.md
git commit -m @'
Record findings from the remaining console restyle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

(Skip if nothing was added since Task 1.)

- [x] **Step 5: Hand off**

Do not merge to main or push inside this plan. Report status to Ethan and use the superpowers:finishing-a-development-branch skill to decide merge/PR. Ethan's signed-in manual pass joins the existing sign-off queue.
