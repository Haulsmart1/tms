# Cosmetic polish pass: contrast, emoji removal, icon and control fixes

## Context

Ethan flagged a set of visual defects across the console app:

- Invoices tab row ("Ready to Invoice", "Invoices", etc.) is hard to read against the page background.
- Other buttons app-wide that blend into their background too closely.
- Emoji still used as UI content in several pages, should be swapped for the icon system already used in Settings/Stats.
- The native calendar-picker icon on `<input type="date">` renders jet-black on a dark-blue field.
- Dropdown/select arrows look skewed or hanging off the control.

A codebase audit (see findings below) confirmed and root-caused each item. Ethan also brought over a Claude Design mockup project ("TMSWizzard Dashboard Mockups") built as a separate exploration. That mockup is a full light-theme redesign — a different default theme direction than the app's deliberate dark-canvas default (documented in `CLAUDE.md`, "this app runs in dim control rooms"). Per Ethan's direction, **this pass does not adopt the mockup's theme or visual identity**; it only extracts specific interaction/component patterns from it (icon approach, button hover-state structure, select-arrow handling) and re-skins them in the app's existing dark tokens. A full light-theme rebrand is out of scope for this pass and would need its own spec if pursued later.

## Audit findings (root causes)

1. **Invoices tabs blend into the page.** `components/Tabs.tsx` gives inactive tabs `border-transparent` and no `bg-*` class — fully transparent, so they render as `--canvas` (`#0F1626`) on `--canvas`. The hover state (`hover:bg-surface-2`) is also broken: `--surface-2` (`#131B2B`) measures ~1.05:1 contrast against `--canvas` — the codebase's own `tokens.css` comment already calls this "invisible."
2. **Four hand-rolled buttons in `app/invoices/page.tsx`** (Cancel Edit L2444, Edit L3042, Approve & Apply L3063, Cancel Credit L3079) use `bg-surface ... hover:bg-canvas`. Their hover state matches their container's background exactly (the surrounding `<article>` is `bg-canvas`), so they visually disappear on hover. This is a local bug, not present in the shared `Button` component's variants.
3. **~40 emoji instances** are used as raw UI content, concentrated in `app/settings/page.tsx`, `app/stats/page.tsx`, `app/super-admin/page.tsx` and `app/super-admin/layout.tsx`, plus one-offs in `app/drivers/page.tsx`, `app/tracking/TrackingMap.tsx`, `app/pod/share/[token]/page.tsx`. None of these pages use an icon library — despite the premise, Settings/Stats don't have an existing icon system either, they render emoji strings. The app *does* have a real icon system already: `lucide-react` (a real dependency), used in `app/components/AppShell.tsx`'s sidebar via a `name string → component` map (`ICONS`), fed by `lib/nav/navConfig.ts`.
4. **Date input calendar icon**: `color-scheme` is never declared anywhere in the app. Chrome/Edge fall back to their light-mode native date-picker glyph (solid near-black) regardless of the app's dark theme, sitting on a dark `--surface` (`#161F31`) field.
5. **Dropdown arrows**: no page implements a custom arrow — every `<select>` (18 files, including the shared `components/Select.tsx`) relies entirely on the browser/OS-native arrow, with no `appearance: none`. There's no positioning bug in app code to fix line-by-line; the "skewed/hanging" look comes from the same missing `color-scheme` plus the mismatch between the OS-native arrow chrome and the app's dark `bg-surface` control box.

## Design decisions

### 1. Tabs (`components/Tabs.tsx`)

- **Every tab gets a visible fill at all times** (not just on hover/active), using a new subtly-lighter-than-canvas background so inactive tabs read as part of a button group at a glance.
- **Active tab is additionally marked with a bottom underline** in the primary accent color, layered on top of the fill (fill + underline hybrid, not pure underline).
- Approximate values (final values tuned during implementation against the contrast checker in `lib/theme/contrast.test.ts`):
  - Inactive tab: background a new token distinct from `--surface-2` (e.g. `~#1B2438`), text `--ink-2` (brighter than current `--ink-3` so it reads clearly against the new fill).
  - Active tab: existing `--primary-tint` background, `--primary-tint-border`/primary-accent underline, `--primary-deep` text — unchanged from today.
  - Hover (inactive): a further lightened step of the new fill token, not `--surface-2`.
- Scope check: `components/Tabs.tsx` is only imported by `app/invoices/page.tsx`, so this fix is contained to Invoices — no other page's tabs are affected.
- Rejected: the mockup's own `Tabs` component (pure underline, no fill on inactive) — Ethan explicitly picked the fill+underline hybrid over matching the mockup 1:1.

### 2. Token-level hover fix + hand-rolled button fix

- Fix `--surface-2` itself in `app/tokens.css` (both `.light` and default/dark values) so it passes real contrast against `--canvas` — every existing `hover:bg-surface-2` usage app-wide becomes visible as a side effect, not just the tabs.
- Run `lib/theme/contrast.test.ts` after the change and update any documented "known gap" floors the test asserts on, if the new value moves them.
- Replace the four hand-rolled buttons in `app/invoices/page.tsx` (Cancel Edit, Edit, Approve & Apply, Cancel Credit) with the shared `Button` component (`variant="secondary"` or `"ghost"` as appropriate) instead of patching their custom classes — the shared component's hover states don't have this bug.
- **Noted but explicitly out of scope for this pass**: ~79 `variant="secondary"` buttons nested inside `Card` share the same `bg-surface` background as the card itself, differentiated only by a real-but-weak `border-line-strong` border. This is a systemic version of the same problem but touching it means changing the secondary button's default visual identity app-wide, which is a bigger, separate decision. Flagging for a future pass.

### 3. Emoji → icon replacement

- Replace all ~40 emoji instances (catalogued in the audit) with `lucide-react` icons, reusing the same `name → component` lookup pattern already established in `AppShell.tsx`'s `ICONS` map, so there's one consistent way the codebase does "icon by name" rather than a second parallel system.
- **Treatment rule, informed directly by the mockup**: the mockup itself doesn't apply one icon style everywhere — its sidebar nav icons are plain/inline (no background), while its "Needs attention" list-row icons sit in a small accent-tinted chip. This pass follows the same rule:
  - **Card/tile-leading icons** (Settings cards, Stats KPI tiles, Super Admin cards) → **accent-tinted chip**: small square, `background: var(--primary-tint)`, icon stroke `var(--primary-deep)` — matches the mockup's alert-icon pattern and the app's existing active-tab accent.
  - **Inline-with-text icons** (driver compliance ✓/⚠ badges, super-admin header ⚡ label, POD share page 🔒 footer note, tracking map 🚚 marker) → **plain icon**, no chip, sized and colored to match the surrounding text/badge (e.g. compliance badges keep their existing badge tone colors, just swap the emoji glyph for a Lucide icon in that same color).
- Icon mapping (emoji → Lucide name), per the audit's survey:

  | Emoji | Lucide icon |
  |---|---|
  | 🏢 | `Building2` |
  | 👥 | `Users` |
  | 🔐 / 🔒 | `Lock` |
  | 📄 | `FileText` |
  | 💷 | `Banknote` |
  | 📦 | `Package` |
  | ✅ / ✓ | `CircleCheck` |
  | ⚠ / ⚠️ | `TriangleAlert` |
  | 🗓️ | `Calendar` |
  | 🧾 | `Receipt` |
  | 📈 | `TrendingUp` |
  | 🚚 / 🚛 | `Truck` |
  | 📍 | `MapPin` |
  | 📸 | `Camera` |
  | ⏳ / ⏱️ / 🕒 | `Clock` |
  | 📤 | `Send` |
  | 💸 | `CircleDollarSign` |
  | 🆕 | `Sparkles` |
  | 🚨 | `Siren` |
  | 📡 | `Radio` |
  | 💼 | `Briefcase` |
  | 🛠️ | `Wrench` |
  | 🧑‍✈️ | `UserCheck` |
  | ⚡ | `Zap` |

### 4. Dropdown/select arrows

- Fix the shared `components/Select.tsx`: add `appearance: none` and render the app's own `ChevronDown` (Lucide) icon, absolutely positioned inside the control — directly mirrors the mockup's `Select` component pattern (it also hides the native arrow and renders its own `chevron-down`).
- For the many hand-rolled `<select>` elements across the other 17 files (not yet going through the shared component): apply a small shared CSS utility (a global rule targeting `select`, or a `.select-arrow` class) so every dropdown in the app gets the same `appearance:none` + custom chevron treatment immediately, without requiring a JSX migration of every page to the shared component in this pass. Migrating individual pages to the shared `Select` component can happen opportunistically later; it's not required for the visual fix.

### 5. Date input calendar icon

- Add `color-scheme: dark` (or a theme-aware `color-scheme: light dark`, synced to the existing `.light`/`.dark` class toggling) once, in `app/tokens.css` or `app/globals.css`. This is the standard mechanism for native form-control chrome (date-picker icon, checkboxes, scrollbars) to follow the app's theme instead of the OS/browser default, and fixes the jet-black calendar glyph without touching any of the ~30 individual `<input type="date">` usages.

## Explicitly out of scope

- Adopting the Claude Design mockup's light theme, brand blue, or full component library as the app's new visual identity — that's a separate, much larger initiative if Ethan wants to pursue it.
- The systemic secondary-button-on-Card low-contrast pattern (79 usages) — noted for a future pass.
- Migrating all 17 hand-rolled `<select>` usages to the shared `Select.tsx` component — the CSS-level fix covers the visual bug without this refactor.

## Testing

- `lib/theme/contrast.test.ts` must pass after any token value changes (`--surface-2`, any new tab-fill token) — update documented contrast floors only if the new values genuinely change them, not to paper over a regression.
- Manual signed-in pass on Invoices (tabs + the four fixed buttons), Settings, Stats, Super Admin, Drivers, Tracking map, and POD share page (emoji swaps), plus a spot-check of a date input and a `<select>` in both `.light` and dark modes.
