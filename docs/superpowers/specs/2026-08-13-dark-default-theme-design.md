# Dark-default theme for control rooms: design

Date: 2026-08-13
Status: approved (Ethan, 2026-08-13)

## Problem

The console is used in control rooms, which are dim. The design system that shipped on
2026-08-11 (`docs/superpowers/specs/2026-08-11-console-design-system-phase1-2-design.md`) is
light-first: `--canvas: #F2F4F8`, white cards, near-black ink. A bright screen in a dim room
is a fatigue problem across a twelve-hour shift, and every page load currently flashes white.
The brief is to make dark the default.

The repo is already partway there, in two contradictory directions:

- `app/tokens.css` carries a `.dark` scaffold, but its own comment measures it as incomplete:
  it overrides 27 of 37 tokens, leaving the status colours, the focus ring, and all four
  shadows on their light values. Measured against that scaffold's own surface, the focus ring
  is 2.85:1 and the shadows are navy on a dark canvas, so invisible.
- The ~15 legacy inline-styled pages are *already* dark. `<body>` is hardcoded `#0f172a` in
  `app/layout.tsx:60`, and `TenantGate`'s full-screen panel is the same. So dark-default
  narrows the split between old and new pages rather than widening it. Only five pages have
  been pulled onto the light canvas so far.

## Goals

- Dark is the default theme, with no flash of light on load, including before hydration and
  with JavaScript disabled.
- A light option remains available for staff who are not in a dim room.
- Every token defined in both themes, with every foreground/background pair measured against
  WCAG AA rather than assumed.
- A documented, one-line mechanism for moving a legacy page onto the theme as the Phase 2-4
  rollout reaches it.

## Non-goals

- **Restyling the 14 legacy pages.** They stay pinned dark, on their existing inline styles.
- **Fixing the light theme's pre-existing contrast gaps.** Documented below under Known gaps,
  not fixed. Fixing them means changing already-shipped light values, which is a separate call.
- **Changing any business logic, query, auth guard, or RLS surface.** This is presentation only.
- **A dark treatment for the public landing page.** It stays light. See Decisions.
- Everything in the 2026-08-11 spec's Non-goals list stays non-goal (duplicated
  delivered-cascade logic, hardcoded VAT, destructive job-stop replace, and the rest).

## Decisions

Five decisions were settled with Ethan before this was written. Recording the reasoning, not
just the outcome, because several are non-obvious.

| # | Decision | Reasoning |
|---|---|---|
| 1 | Dark default, plus a light toggle | Not dark-only: day-shift and office staff (invoicing, customers) are not in a dim room. Cost accepted: two palettes to keep contrast-correct. |
| 2 | The toggle covers tokenised pages only | The 14 legacy pages use hardcoded inline literals and cannot respond to a theme class. `AppShell` renders everywhere, so an unguarded toggle on `/pod` would turn the sidebar light while the page stayed dark: visibly broken, not merely inconsistent. The toggle is hidden on legacy routes so it never lies. |
| 3 | `/login` goes dark, the landing page stays light | The landing is a sales asset viewed by prospects on normal monitors in daylight, and its light redesign shipped in July. `/login` is the first console screen an operator sees in a dim room, so a light login would be exactly the bright flash this change exists to remove. |
| 4 | Palette B, "control-room tuned" | Chosen from three mocked options. Canvas lifts off pure dark and text caps at a dimmed `#D6DEEC` rather than near-white. Pure white on near-black causes halation, where glyphs appear to bleed, which is worst in dim rooms. True black was rejected for the same reason: AA has no upper bound, comfort does. |
| 5 | Preference lives in `localStorage`, per device | Theme is a property of the room's lighting, not the person. Control-room machines are shared across shifts, so the screen should stay dark whoever signs in. It is also the only option readable synchronously before first paint. A Supabase profile value needs a network round trip, so it would flash the wrong theme on every load, plus a schema change and an RLS surface to review. |

## Architecture

### Theme mechanism: inverted default

Dark values live in `:root`. Light is a `.light` override block. This inverts the usual
convention, deliberately.

```css
:root  { /* dark: the default */ }
.dark  { /* the same dark values, so a subtree can pin itself dark */ }
.light { /* light overrides */ }
```

Three consequences:

1. **No JavaScript is needed for the default.** Server-rendered HTML, a failed script, a slow
   hydration, and a JS-disabled browser all render dark. The flash of white becomes
   structurally impossible on the default path rather than merely unlikely.
2. **Only opted-in light users can flash**, and a blocking inline script in `<head>` prevents
   that too. It reads `localStorage["tms-theme"]` and adds `class="light"` to `<html>` before
   first paint. It must be a synchronous inline script, not a React effect, or it runs after
   paint and the flash returns.
3. **CSS variables cascade, so `.light` and `.dark` work at any depth**, not just on `<html>`.
   That is the whole pinning mechanism: no separate system is needed for the landing page or
   for legacy pages.

`.dark` duplicating `:root` looks redundant but is load-bearing. It is what lets a subtree
resist an ancestor `.light`, which is how legacy pages stay dark while the user is in light mode.

No `dark:` Tailwind variants exist anywhere in the codebase (verified), so the token swap does
all the work and the existing `darkMode: "class"` config stays inert. **`dark:` variants are
forbidden going forward**: under an inverted default they mean the opposite of what an author
would expect. This is stated in `tokens.css` and the README.

### Token table: dark values

All 37 existing tokens get dark values, including the ten the old scaffold left unthemed. Two
tokens are new.

```
/* surfaces */
--canvas: #0F1626      --surface: #161F31      --surface-2: #131B2B
--line: #26324A        --line-strong: #586B90

/* chrome (sidebar) */
--chrome: #0C1220      --chrome-raised: #1A2438  --chrome-border: #26324A
--chrome-text: #9AA7BD --chrome-text-strong: #E8EEF9

/* text */
--ink: #D6DEEC   --ink-2: #9AA7BD   --ink-3: #7787A0   --ink-4: #5E6C85

/* brand */
--primary: #7FA0F7          --primary-hover: #9AB4F9    --primary-active: #6489EF
--primary-tint: #1C2C55     --primary-tint-border: #4E6AB4
--primary-deep: #A9C0FB     --on-primary: #0F1626                  /* NEW */

/* accent */
--accent: #EFB458  --accent-text: #EFB458  --accent-tint: #33280F  --accent-border: #A07E26

/* status */
--success: #6FD79B  --success-strong: #6FD79B  --success-tint: #14301F  --success-border: #357A4F
--warning: #EFB458  --warning-strong: #EFB458  --warning-tint: #33280F  --warning-border: #8A6C1F
--danger:  #F08A8A  --danger-strong:  #F08A8A  --danger-tint:  #3A1C1C  --danger-border:  #B04C4C
--danger-hover: #F5A5A5     --on-danger: #2A0F0F                   /* NEW */
--focus: #7FA0F7

/* elevation: black-based, not navy */
--shadow-xs: 0 1px 2px rgba(0,0,0,.45);
--shadow-sm: 0 1px 2px rgba(0,0,0,.45), 0 2px 8px -2px rgba(0,0,0,.55);
--shadow-md: 0 4px 16px -4px rgba(0,0,0,.60), 0 2px 4px -2px rgba(0,0,0,.50);
--shadow-lg: 0 16px 40px -8px rgba(0,0,0,.70);
```

The shadows need replacing rather than retuning: the current four are `rgba(11,18,32,...)`,
navy on a dark canvas, so they render as nothing. Token names are unchanged, so none of the 12
`shadow-*` call sites move. In dark, elevation reads from the border first and the shadow second.

The two new tokens, `--on-primary` and `--on-danger`, exist because `Button.tsx` hardcodes
`text-white` on both solid variants. See Component fixes.

### Contrast verification

Measured, not estimated. Every pair below was computed with the WCAG relative-luminance
formula. The full script is committed as `scripts/contrast-check.mjs` so it can be rerun.

Dark theme, passing:

| Pair | Ratio | Needs |
|---|---|---|
| `--ink` on `--surface` | 12.18:1 | 4.5 |
| `--ink` on `--canvas` | 13.34:1 | 4.5 |
| `--ink-2` on `--surface` | 6.78:1 | 4.5 |
| `--ink-3` on `--surface` | 4.52:1 | 4.5 |
| `--chrome-text` on `--chrome` | 7.69:1 | 4.5 |
| `--chrome-text-strong` on `--chrome` | 16.05:1 | 4.5 |
| `--primary` on `--surface` (links) | 6.49:1 | 4.5 |
| `--on-primary` on `--primary` (button) | 7.11:1 | 4.5 |
| `--on-primary` on `--primary-active` | 5.47:1 | 4.5 |
| `--on-danger` on `--danger` (button) | 7.42:1 | 4.5 |
| `--focus` on `--surface` | 6.49:1 | 3 |
| `--focus` on `--chrome` | 7.37:1 | 3 |
| `--line-strong` on `--surface` | 3.08:1 | 3 |
| Badge text on tint (success/warning/danger/info) | 6.39 to 8.06:1 | 4.5 |
| Badge border vs surface (success/warning/danger/info) | 3.13 to 3.33:1 | 3 |

The two failures the old scaffold had are both resolved: the focus ring moves from 2.85:1 to
6.49:1, and the status colours are now themed rather than inheriting light values.

Dark badge borders are deliberately stronger than their light counterparts (3.13 to 3.33:1
versus light's 1.36 to 1.58:1). Status scanning is the main job of the jobs board and the
dashboard, and in dark a tinted fill carries almost no signal: even tuned, a tint sits at
roughly 1.1:1 against the card. The accessible carrier is the badge *text*, which passes 4.5:1
comfortably; the stronger border is a legibility improvement on top of that, not the thing
meeting the requirement.

### Component fixes

- **`components/Button.tsx`**: `primary` is `bg-primary text-white` and `danger` is
  `bg-danger text-white`. Under dark, `--primary` becomes a light blue and white-on-it measures
  **2.97:1**, so the most-clicked control in the app would fail AA. Both variants switch to the
  new `--on-primary` / `--on-danger` tokens, which are `#FFFFFF` in light and dark ink in dark.
  This keeps the fix in the token layer, so no per-theme classes are introduced.
- **Focus ring**: `--focus` becomes `#7FA0F7`. The rule at `tokens.css:77` is deliberately
  global and unscoped, so this fixes the ring on the legacy pages too, at once.
- **`components/Badge.tsx`**: no API or shape change. It picks up the new tint and border
  tokens automatically. Its existing `.ds`-dependency comment stays accurate.
- **`app/components/TenantGate.tsx`**: the hardcoded `#0f172a` panel retints to the palette's
  canvas. It stays a hardcoded literal rather than a token, because it must not follow the
  light toggle (it renders on every route, including legacy ones, before the theme is relevant).

### Toggle and the activation switch

A single source of truth, consumed in two places:

```ts
// lib/nav/themeableRoutes.ts
export const THEMEABLE_ROUTES = [
  "/", "/login", "/dashboard", "/jobs", "/super-admin/requests",
];
export function isThemeableRoute(pathname: string): boolean
```

- A layout-level wrapper applies the `.dark` pin to any route **not** on the list. It reads the
  path with `usePathname`, so it is a client component, sitting inside `TenantProvider`
  alongside `AppShell` rather than replacing the server root layout.
- `AppShell` calls the same function to decide whether to render the toggle, which is what
  implements Decision 2.

This mirrors the existing `lib/nav/shouldShowShell.ts` and its test file, so the pattern and
its test shape are already established in the repo.

**Activating a legacy page then becomes one line**: add its path to `THEMEABLE_ROUTES`. The
toggle appears there and the page starts following the theme.

**What this does not do.** The list entry is the plumbing, not the work. A legacy page only
*responds* to the theme once its inline colour literals are converted to tokens and it paints
its own `bg-canvas` on a `.ds` wrapper, the way the five current pages do
(`app/page.tsx:50`, `app/login/page.tsx:62`, `app/dashboard/page.tsx:179`,
`app/jobs/page.tsx:249`, `app/super-admin/requests/page.tsx:79`). The switch means Phase 2 does
not have to rediscover how theming is wired and there is no second place to remember to update.
It removes the plumbing step from fourteen future pages, not the styling.

Two side effects worth having: the list is an allowlist, so a brand new page defaults to
pinned-dark and legacy-safe rather than half-themed; and once every route is on it, the list
and its wrapper can be deleted in a single commit.

### Legacy boundary

`<body>` keeps a hardcoded dark background rather than `var(--canvas)`, retinted from `#0f172a`
to the new canvas. This is deliberate. If `<body>` followed the token, switching to light would
give the 14 legacy pages a light background while their inline text colours stayed tuned for
dark, which is worse than inconsistent: `/tracking` puts white cards and white headings on that
backdrop and would become white-on-white.

### Landing page pin

`app/page.tsx:50`'s root becomes `className="ds light ..."`. No other change. Because the light
overrides are a class rather than a media query, this needs no separate mechanism and no
JavaScript.

## Known gaps, flagged not fixed

Following this project's convention of documenting rather than silently absorbing:

- **The light theme has three pre-existing contrast failures**, present today and unrelated to
  this change: `--ink-3` on white is 4.15:1 (needs 4.5), `--ink-4` on white is 2.63:1, and
  `--line-strong` on white is 1.84:1 (needs 3:1 as a UI component boundary). Not fixed here:
  they require changing already-shipped light values, which is its own decision. The dark
  equivalents are all better (4.52:1, 3.11:1, 3.08:1 respectively), and two of the three pass.
- **`--ink-4` still fails 4.5:1 in dark** at 3.11:1. It is currently unused by any component
  (verified), so nothing renders at that ratio today. It is defined to complete the tonal ramp.
  If it is ever used for text, it needs raising first.
- **`JobForm.tsx` uses `border-ink-3` for input borders**, not `border-line-strong`. That
  measures 4.52:1 in dark, so it is fine, but it is an inconsistency worth knowing about.
- **The `primary-50..950` literal hex ramp in `tailwind.config.ts:80-81` is not themed** and
  never will be, since it is raw hex. It is currently unused by any component (verified).
  Recommend deleting it in this change as a two-line removal of a live trap: it duplicates
  five token values and would silently break theming for anyone who used it. Called out
  explicitly rather than folded in silently, so it can be vetoed.

## Contributor documentation

The inverted default is the one genuinely surprising thing here, so it is documented in the
three places someone would actually be looking:

1. **A header comment in `app/tokens.css`**, where the surprise lives: that `:root` is the dark
   theme by design, that `.light` is the opt-out rather than `.dark` being the opt-in, why
   (flash-free dark with no JavaScript), and that `.dark` duplicates `:root` on purpose so a
   subtree can pin itself.
2. **The `dark:` variant prohibition**, stated alongside it, because that is the trap: a
   contributor writing `dark:bg-surface` gets behaviour inverted from what they expect.
3. **A short section in `README.md`**, since that is what a new contributor reads before
   opening a CSS file.

## Files touched

- `app/tokens.css`: inverted structure, full dark token set, two new tokens, new shadows,
  contributor header comment.
- `app/layout.tsx`: blocking inline theme script in `<head>`; `<body>` background retinted;
  legacy `.dark` pin wrapper.
- `app/page.tsx`: `.light` pin on the root element.
- `components/Button.tsx`: `text-white` replaced with the `--on-primary` / `--on-danger` tokens.
- `app/components/AppShell.tsx`: theme toggle in the footer, guarded by `isThemeableRoute`.
- `app/components/TenantGate.tsx`: panel retinted.
- `lib/nav/themeableRoutes.ts` and its test: new.
- `scripts/contrast-check.mjs`: new, committed.
- `tailwind.config.ts`: remove the dead `primary-50..950` ramp (see Known gaps).
- `README.md`: contributor section.

Not touched: the 14 legacy pages, every query, guard, and validation schema.

## Verification

- `npm run typecheck` and `npm run build` clean.
- `npm test`, including a new test for `isThemeableRoute` mirroring `shouldShowShell.test.ts`.
- `scripts/contrast-check.mjs` passes for both themes, with the Known gaps list as its only
  documented exceptions.
- Manual: hard reload each themed page in both modes, watching for a flash. Reload with
  JavaScript disabled and confirm dark renders.
- Manual: confirm the toggle is absent on a legacy route, and that switching to light on
  `/dashboard` then navigating to `/pod` leaves `/pod` dark and readable.
- Manual: confirm the landing page stays light with the global preference set to dark.
- Security: no auth, query, or RLS change in this phase. The one check worth making is that the
  inline theme script reads and writes only `localStorage["tms-theme"]` and interpolates nothing
  from the page, so it introduces no injection surface.

## Open questions

One, and it does not block implementation: whether to delete the dead `primary-50..950` ramp
from `tailwind.config.ts` as part of this change, or leave it. Recommended for removal under
Known gaps; the rest of the spec is unaffected either way.

All five product decisions are settled and recorded under Decisions.
