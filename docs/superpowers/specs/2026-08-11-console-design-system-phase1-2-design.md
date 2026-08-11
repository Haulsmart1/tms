# Console design system — Phase 1 (Dashboard & Jobs) + Phase 2 (Operations): design

Date: 2026-08-11
Status: approved. **Scope narrowed 2026-08-11 (same day, after initial approval):** Ethan
asked to defer Phase 2 (Operations: POD, Tracking, Invoices, Customers, Subcontractors) along
with Phases 3-5, and to add the landing page ("hero") to the active build instead. **Active
build scope is now: Foundation + Landing/Hero + Dashboard + Jobs.** The Phase 2 sections below
stay in this document as a preserved reference for when that work is picked back up (the
analysis doesn't go stale, only the sequencing changed) — read them as "not being built right
now," not "wrong." See the new "Landing / Hero" section for the added scope.

## Problem

The app runs two parallel styling systems: ~15 legacy pages in raw inline styles on a dark
`#0f172a` canvas, and three pages (`/`, `/login`, `/super-admin/requests`) on an opt-in
Tailwind + IBM Plex "ds" system (`docs/landing-redesign-guide.md`). Neither matches the
finalized brand: the logo project (`TMSWizzard Logo Concepts`) settled on blue `#2953E3` /
ink `#0B1220`, but the shipped `ds` tokens use `#2D54DE` / `#0F172A`. A third Claude Design
project, `TMSWizzard Console` (the latest iteration, confirmed authoritative), specifies a
full visual language on that finalized palette — dark chrome sidebar, IBM Plex Mono for
operational data, a grouped nav taxonomy, card+table patterns — but only mocks up two
screens (Dashboard, Jobs) as an interactive prototype. There is no design system yet that
covers the other ~13 operational pages, and `/dashboard` itself has no data layer at all
(static link grid).

This spec covers the first two build phases of the app-wide rollout: the shared foundation
(tokens, shell) plus Dashboard and Jobs (Phase 1, matches the Console mockup directly), and
the five Operations pages — POD, Tracking, Invoices, Customers, Subcontractors (Phase 2,
Console's *principles* applied, no mockup to match 1:1). Fleet/Compliance, Admin, and the
landing/login re-theme are separate later phases, out of scope here.

## Goals

- Re-theme the existing Tailwind foundation (`app/tokens.css`, `tailwind.config.ts`) to
  Console's exact tokens, replacing the landing page's current values.
- Replace `AppHeader` with an `AppShell` (sidebar + topbar) matching Console's visual
  language and nav taxonomy, **preserving the existing auth/tenant security guard exactly**.
- Give `/dashboard` a real, tenant-scoped data layer (it currently has none) so it matches
  Console's mockup instead of being a static launcher.
- Rebuild `/jobs` visually onto the new system while preserving 100% of its existing
  business logic, validation, and known quirks.
- Extend the same tokens/components/table-state pattern to POD, Tracking, Invoices,
  Customers, Subcontractors, again with zero business-logic change.
- A security-audit pass alongside the code-quality pass on this phase, per the standing
  agreement for this project.

## Non-goals (explicitly preserved, not "fixed" by this redesign)

- **Duplicated delivered-cascade logic** in both `jobs.tsx` (`saveJob`/`savePod`) and
  `pod.tsx` (`savePod`) stays duplicated. Do not consolidate.
- **Destructive job-stop replace on edit** (`app/jobs/page.tsx:380-427`, delete-all-then-
  reinsert) stays as-is.
- **VAT hardcoded to `0`** on invoices (`invoices.tsx:155`) stays.
- **No edit/delete for subcontractors**, no tenant re-check on customer/subcontractor
  updates, no delete-guard on customers (unlike jobs' planned-only rule) — all stay exactly
  as they are. Do not add affordances that change what a user can do.
- **Orphaned POD files** on re-upload (`pod.tsx`) — not touched.
- **Tracking page's silent error swallowing** — not touched (see Phase 2 detail below for
  the one place this needs a *presentational* loading/error state without changing what
  happens on fetch failure).
- Dark mode / "operator theme" — deferred, no work this phase.
- Landing page / `/login` re-theme to the new palette — separate phase (5), not blocking
  this one; the two can ship in either order.
- Fleet, Compliance, Admin, Super-admin pages — separate phases (3, 4).

## Approach

Foundation ships as part of Phase 1 (Jobs and the new Dashboard can't render without it).
Phase 2 is purely "apply the established pattern," no new foundation work.

## Architecture

### Foundation: tokens

Re-key `app/tokens.css` and `tailwind.config.ts` from the landing page's current values to
Console's, sourced from the Console design-system bundle
(`tokens/colors.css`, `spacing.css`, `typography.css`):

| Semantic role | Old (landing, current) | New (Console) |
|---|---|---|
| Action/primary blue | `#2D54DE` | `#2953E3` |
| Ink (dark chrome / headline text) | `#0F172A` | `#0B1220` |
| Canvas (page background) | `#F4F6F8` | `#F2F4F8` |
| Card surface | `#FFFFFF` | `#FFFFFF` (unchanged) |
| Border | `#E2E8F0` | `#E4E7EE` |
| Secondary text | `#475569` | `#5B6474` (slate-600) |

Full ramps to carry over verbatim from Console's `colors.css`: blue 50/100/200/300/500/600/
700/800, ink 700/800/900/950 (chrome + raised chrome), slate 300/400/500/600/700, gray 50/
100/200, status green/amber/red (100+600+700 each, tuned to the new blue's saturation).
Spacing stays 4px-based (`--sp-1..16`); radii become controls=6, menus=10, cards/dialogs=14,
pill=999, logo tile=27% (nothing else uses the tile radius). Shadows stay border-first /
whisper-faint (`--shadow-card`, `--shadow-raised`, `--shadow-overlay`).

`tailwind.config.ts`'s `theme.extend.colors` gets the same key names it has today
(`canvas`, `surface`, `line`, `ink`, `primary`, `accent`, `success`, `warning`, `danger`,
`focus`) so no class names change app-wide — only the `var()` values they resolve to move.

**Decision:** this means the *already-shipped* landing/login pages pick up the new palette
automatically the moment this file changes, ahead of their own dedicated Phase 5 rework.
Accepted deliberately: `#2D54DE`→`#2953E3` and `#0F172A`→`#0B1220` are both AA-checked, close
enough to be barely perceptible, and shared token keys avoid running two colour systems
in parallel during the rollout. Phase 5 still does the *structural* re-theme (whatever that
turns out to mean) separately; this phase only moves the color values everyone already
inherits from the shared tokens.

### Foundation: fonts

`app/layout.tsx` already declares `plexMono` (`IBM_Plex_Mono`, `--font-mono`) but only loads
weights `400`/`500`. Console's typography needs weight `600` too (e.g. the dashboard revenue
figure, `600 22px/28px var(--font-data)`) — add `"600"` to the `weight` array. No other font
work needed; Plex Sans is already loaded.

### AppShell (replaces `AppHeader`)

Dark `ink-950` sidebar, grouped nav (from Console's own `NAV` definition, which already maps
onto the app's real routes):

```
Dashboard
Operations   Jobs · Proof of delivery · Tracking · Invoices · Customers · Subcontractors
Fleet        Vehicles · Drivers · Assets · Maintenance
Compliance   Tachograph · Telematics
Insights     Stats
Admin        Settings
```

Only the ungrouped Dashboard link plus the Operations group are wired to real pages this
phase; the rest render as nav items pointing at their (still legacy-styled) existing pages —
clicking out of the new shell to an old page is expected and fine mid-rollout.

**Security guard — carried over from `AppHeader`, not weakened:**

**Correction (caught by adversarial code review during implementation, then independently
verified against `git show 91fa6b0`): the historical incident was cosmetic, not an auth
bypass.** 91fa6b0's own commit message states it plainly: "Signed-out visitors were never
affected (the header hides when signed out), so this is cosmetic, not an auth bypass." The
actual bug was that `/login` was missing from `AppHeader`'s pathname exemption, so an
**already-signed-in** user landing on `/login` (bookmark, back button, a consumed magic link)
saw a stray "Dashboard" link on what should be a plain sign-in page — not a signed-out
visitor seeing the internal nav. This correction supersedes every other place in this spec,
the implementation plan, and prior session memory that described this as a nav-leak/auth-
bypass fixed for signed-out users; that framing was wrong and originated with me
(Claude), not with the historical commit itself.

The `shouldShowShell` guard below is still correct and still worth having exactly as
designed — the status check remains a genuine fail-closed improvement (it's stricter than
`AppHeader` ever was, since `AppHeader` never covered `"no-tenant"`) — the guard just isn't
"the fix for a real unauthenticated nav leak," because no such leak occurred.

```ts
// Both checks are required. The pathname exemption alone was the gap 91fa6b0
// closed: /login was missing from it, so an ALREADY-SIGNED-IN user saw a
// stray Dashboard link on the sign-in page (cosmetic, not an auth bypass —
// signed-out visitors were already blocked by the status check below). The
// status check is the fail-closed backstop regardless: implemented (see the
// plan) as `status === "ready"` — an allowlist of the one good value, not a
// denylist of bad ones — so any future status value not yet accounted for
// defaults to hidden too.
function shouldShowShell(pathname: string, status: TenantStatus): boolean {
  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) {
    return false;
  }
  return status === "ready";
}
```

This is a strictly fail-closed generalization of today's `AppHeader` (which only checks
`loading`/`signed-out`) — a signed-in user with an unresolved tenant (`"no-tenant"`, an edge
case: orphaned profile) now also gets no nav chrome, closing a minor gap for free while this
file is already being rewritten.

Topbar/header: page title, user chip, sign-out. **No search input, no notifications bell** —
dropped from the build (not "visual only" as first drafted here): neither has a backend, and
a search box that doesn't search or a bell with no notifications is a half-finished feature,
not a visual match. Add them once there's something real behind them. Sign-out is new:
`AppHeader` never had one (flagged as a gap in the roadmap). Wired to
`supabase.auth.signOut()` then redirect to `/login`.

### Components

Restyle in place (already accessibility-hardened, keep their APIs): **turns out to need zero
code changes.** `Button`, `Badge`, `Field`, `Textarea`, `Container` already reference the
token-driven Tailwind classes (`bg-primary`, `text-ink`, `border-line`, etc.), confirmed by
reading all of them — only `app/tokens.css`/`tailwind.config.ts`'s values change, and every
one of these picks up the new palette automatically. One accepted visual gap: `Badge` keeps
its existing tinted-background-plus-border pill shape rather than switching to Console's
flatter border-less pill, to avoid touching a component that otherwise needs nothing — a
minor, easily-revisited style nuance, not a functional difference.

**Correction (caught during plan-writing, 2026-08-11): these are NOT already in this repo.**
`AppShell`/`DataTable`/`Modal`/`Toast`/`Skeleton` only exist as TSX in the Claude Design MCP
"TMS Wizzard Redesign" project's `handoff/components/` folder — that project was never
imported into this codebase, only read via the design tool during brainstorming. They must be
**built new**. Reusing the handoff's actual code isn't a shortcut here either: its `AppShell`
implements the *light, collapsible* sidebar from that project's own visual direction (the one
NOT chosen — Console's dark `ink-950` chrome sidebar was picked instead), so it's the wrong
shape to adapt. Build these five directly from Console's mockup markup instead, which is
already fully read and is the authoritative pixel spec regardless.

New, from Console's spec (no existing equivalent): `Stat` (KPI tile), `DataTable` (generic
table with the loaded/loading-skeleton/error-with-retry/empty-with-action states from
Console's job board prototype), `Modal` (generic dialog). **Correction (caught during
plan-writing): no `Drawer`, no `AssignDialog`, no `Toast` stack.** The real Jobs page has no
detail-view route, no assign-as-a-separate-step flow, and no filter/search state to clear —
those are Console prototype inventions with no real-app equivalent, and Non-goals rules out
adding new interaction affordances. `DataTable`'s first real consumer is `/dashboard`
(Jobs keeps its current card-per-job shape — see the corrected `/jobs` section below for why);
it remains available for Phase 2's genuinely flat-list pages. Jobs' existing single persistent
message banner (info/error/success funneled through one string) is kept as-is, restyled, not
converted to auto-dismissing toasts — that would change behavior (a toast disappears after a
timeout; the banner persists), which Non-goals also rules out.

### Landing / Hero (added to active scope 2026-08-11)

Good news surfaced while scoping this: `app/page.tsx` (landing) and its sections
(`components/landing/*`) already compose the shared design-system primitives — `Badge`,
`Container`, `buttonClasses` — rather than hardcoding their own colors. `Hero.tsx`'s
`ProductMock` (the illustrative jobs-table mock, `components/landing/Hero.tsx:23-65`) already
uses `font-mono` for reference/value columns and `Badge` for status, which is exactly Console's
"data speaks in mono, status is a badge" convention. **This means the Foundation token re-theme
alone visually updates the landing page correctly, with no changes needed to `Hero.tsx` or the
other landing sections' logic or copy.**

The one concrete gap: `components/landing/LandingNav.tsx:22` renders the logo as a bare
placeholder — `<span className="h-5 w-5 rounded-md bg-primary" aria-hidden />`, a colored
square, not the actual mark. Now that the logo is finalized, swap it for the real asset. Using
Console's own exported SVGs (fetched from the Logo Concepts project, confirmed identical to
what the Console mockup itself renders as `{{logoEl}}`):

```svg
<!-- tile mark (nav / header use) -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="#2953E3"/><circle cx="13" cy="35" r="5" fill="#FFFFFF"/><path d="M13 35 C 13 21.5, 21 13.5, 31 13.5" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/><polygon points="29,6.5 41,13.5 29,20.5" fill="#FFFFFF"/></svg>
```

Inline as an SVG component (not an `<img>`, so it inherits no extra request and can use
`currentColor`-free fixed brand colors as designed — the mark's colors are fixed regardless of
theme per the logo project's own rationale). Same swap applies to the favicon
(`app/favicon.ico` or `app/icon.*` — check what Next's file convention currently serves; the
Logo Concepts project also exports `favicon-16.png`/`favicon-32.png`/`apple-touch-icon.png` if
a raster favicon is preferred over an SVG one).

No changes to landing/login business logic, copy, or the request-access flow. This is a
visual-only addition to the Foundation phase, not its own separate build phase.

### `/dashboard` — new data layer (Phase 1)

Currently `app/dashboard/page.tsx` is a server component with no data, no tenant gating, and
a hardcoded 14-card link grid. Console's mockup needs: 5 KPI tiles, a "today's jobs" table, a
"needs attention" list, and a revenue bar chart. Real schema (`jobs`, `job_stops`,
`invoices`, `vehicles`) grounds four of the five KPIs directly; the fifth needs a proposed
stand-in because the real `jobs.status` vocabulary is narrower than the mockup assumes (only
`"planned"` / `"completed"` exist in this codebase — no `cancelled`, `in_transit`, or `late`):

| KPI | Query (tenant-filtered via `filterByTenant`, same pattern as every other page) |
|---|---|
| Jobs today | `jobs` where `scheduled_date = today` |
| Unassigned | `jobs` where `status = 'planned' AND (vehicle_id IS NULL OR driver_id IS NULL)` |
| **On the road** (stand-in, confirmed) | `jobs` where `status = 'planned' AND scheduled_date = today AND vehicle_id IS NOT NULL` — reads as "vehicles rostered on today's jobs," **not** live position. |
| PODs awaiting | `job_stops` where `type = 'delivery' AND pod_status != 'delivered'`, joined to `jobs` where `status = 'planned'` |
| Overdue invoices | `invoices` where `status != 'paid' AND due_date < today` |

**Confirmed by Ethan (2026-08-11): the "On the road" definition is approved as a stand-in,
not a final implementation.** Flagging clearly for the future, so it isn't mistaken for done:
once the TomTom live-tracking integration lands (already on the product roadmap), this tile
and the Jobs board's dropped "late" badge are the two identifiers in this spec that should be
**reimplemented against real vehicle position/ETA data** rather than the `vehicle_id IS NOT
NULL` / status-vocabulary proxies used here. This phase's versions are legitimate and shippable
now, just not the end state — worth a one-line TODO comment at each call site in the code
(`// stand-in until TomTom tracking lands, see docs/superpowers/specs/2026-08-11-...`) so a
future pass can grep for it.

"Needs attention" list: PODs awaiting > 48h old (via `job_stops.planned_at`) and overdue
invoices, merged and sorted by age — both already-fetched sets, no new query. "Today's jobs"
table: same `jobs` query as the Jobs board (see below), filtered to today, capped at ~8 rows,
"View all" links to `/jobs`. Revenue chart: last-7-days sum of `invoices.total` (confirmed the
correct name by querying the live database directly with the service-role key after an earlier
review-time "fix" to `total_amount` turned out to be wrong — see the plan's Task 17) where
`status = 'paid'`, grouped by `issue_date` — client-side aggregation, matching the pattern
already used on `/stats`. All reads only; this page gains a data layer but no write path.
Wrapped in `TenantGate` like every other data page (it currently isn't gated at all).

### `/jobs` (Phase 1)

Visual rebuild only. **Correction (caught during plan-writing, after reading the actual
994-line file): the real page has no assign flow, no job-detail view, and no search/filter/
tabs at all** — those are Console mockup inventions that don't exist in this app's real data
model (vehicle/driver are just fields on the same create/edit form; every field, including
all stops and their POD sub-forms, is already always visible on the job card, there's no
separate detail route to open). Building an `AssignDialog`/`Drawer`/search-and-filter bar
would be new functionality, not a restyle, so none of that is in scope. What actually
happens: create/edit form → `Field`/`Button` styling (extracted to `JobForm`); nested stop +
POD sub-form → extracted to `StopCard`, restyled; job list stays its current card-per-job
shape (not converted to `DataTable` — that needs a flat-row model, and hiding the always-
visible stops behind a table-row click would be a real behavior change), restyled onto
tokens; `window.confirm` on delete → a real `Modal`-based `DeleteJobDialog` (same yes/no
gate, just not a native browser dialog — this one substitution is a legitimate presentational
upgrade, not new behavior). **No change to `saveJob`, `savePod`, `deleteJob`, validation
schemas, or the delivered-cascade logic** — only the JSX/styling around them. See the
implementation plan (`docs/superpowers/plans/2026-08-11-console-foundation-hero-dashboard-jobs.md`)
for the exact file split.

### `/pod` (Phase 2)

Visual rebuild: stop cards → `DataTable`/card pattern with the new tokens; upload widgets
restyled but functionally identical (`upsert:false`, same storage path convention, same
filename sanitization). **Correction: `PodLink` is NOT token-driven** — it uses raw hardcoded
hex (`#111827`, `#b91c1c`), not CSS variables (verified by reading it while building
`StopCard` for Jobs in the active build, where its two color literals were already updated to
the new palette's hex values). By the time Phase 2 picks this up, `PodLink` will already be on
the new palette; nothing further needed there.

### `/tracking` (Phase 2)

Visual rebuild onto `DataTable`. This is the one page in Phase 2 that gets a genuine (small)
logic addition, not just presentation: today it swallows fetch errors entirely (no `error`
destructured from either query, `tracking.tsx`). Adding the standard loading/error/empty
table states requires actually capturing that error rather than discarding it — this is a
minimal, additive fix (show "Couldn't load tracking data, retry" instead of a silently blank
table), not a behavior change to what's fetched. Flagging it here so it doesn't read as
scope creep when it shows up in the diff — it's required to render the table-state pattern
at all on this specific page.

### `/invoices` (Phase 2)

Visual rebuild of both tables (Ready to Invoice / Invoices) onto `DataTable`. Status `Badge`
for `draft`/`sent`/`paid`. **VAT stays hardcoded to `0`, invoice-number generation stays
client-side random** — no changes to `createInvoice`/`updateInvoiceStatus`.

### `/customers` and `/subcontractors` (Phase 2)

Visual rebuild of the create/edit-inline-form + card-list pattern onto the new `Field`/
`Button`/`DataTable` (or card grid, whichever reads better for these — a card, unlike the
others, doesn't have many columns). Toggle-active stays a toggle with no confirmation
(matches existing behavior, including the existing message-on-success asymmetry between
these two pages — not evening it out, that's a behavior change). Subcontractors keeps no
edit/delete UI. Customers keeps no delete-guard.

## Security

- The AppShell rewrite is the highest-risk file in this phase because it's where the historical
  91fa6b0 fix lived — reviewed above under Architecture (correction: that fix was cosmetic, an
  already-signed-in user seeing a stray link, not an auth bypass), both guards carried
  forward, `no-tenant` gap closed.
- `/dashboard`'s new queries are reads only, through the same `filterByTenant` every other
  page uses; no new write path, no new RLS surface. Wrapping it in `TenantGate` is itself a
  security improvement (today it renders un-gated, though it currently has no data to leak).
- No RLS/query changes anywhere else in this phase — this is a presentation layer change on
  top of existing, already-reviewed data access.
- Flagging, not fixing: `AppShell`'s pathname guard is still a hardcoded array, same shape as
  `AppHeader`'s. Every future public route has to remember to add itself. Worth inverting to
  an allowlist-of-app-routes model at some point; out of scope for this phase, noted for the
  security pass so it's a documented decision, not a missed one.
- Sign-out is new functionality (didn't exist before) — needs its own check: confirm it
  clears the Supabase session client-side and that `TenantProvider`'s `onAuthStateChange`
  listener correctly resets `status` to `signed-out` (it already listens for `SIGNED_OUT`,
  per `TenantProvider.tsx:63` — should work without changes, verify in testing).

## Files touched

Superseded by the implementation plan's File Structure section, which reflects everything
actually decided during planning (extraction of `JobForm`/`StopCard`/`DeleteJobDialog`, the
pure `lib/nav/` and `lib/dashboard/` logic, `TenantProvider`'s new `userEmail` field, etc.):
see `docs/superpowers/plans/2026-08-11-console-foundation-hero-dashboard-jobs.md`.

**Not touched in the active build** (Phase 2, deferred): `app/pod/page.tsx`,
`app/tracking/page.tsx`, `app/invoices/page.tsx`, `app/customers/page.tsx`,
`app/subcontractors/page.tsx` — their design sections above stay as reference for later.

## Verification

- `npm run typecheck` + `npm run build` clean after each page.
- `npm test` — no new pure logic expected except the Tracking error-state fix, add a test if
  it's extracted into a testable function.
- Manual pass per page at desktop + mobile width.
- Manual: sign-out actually signs out and the AppShell disappears; a signed-out visitor
  hitting any Operations page directly still gets `TenantGate`'s redirect (unchanged, but
  reverify after the AppShell swap doesn't interfere with it).
- Security pass: confirm the AppShell guard behaves identically to `AppHeader`'s (test both
  conditions — wrong path, wrong status) before this ships; confirm `/dashboard`'s new
  queries are read-only and tenant-filtered; confirm no page's write path changed.

## Dependencies / order (active build: Foundation + Landing/Hero + Dashboard + Jobs)

1. Foundation (tokens + fonts + AppShell) — nothing else can build without it. Confirmed:
   shared token keys update now, so landing/login inherit the new palette as a side effect.
2. Landing/Hero logo swap — small, independent of Dashboard/Jobs, can land alongside or right
   after Foundation. No data/logic dependency on anything else in this phase.
3. Dashboard (new data layer) and Jobs (visual-only) — Phase 1 proper, matches the Console
   mockup, can happen in either order or in parallel once the foundation lands.

**Deferred, not in this build:** Phase 2 (POD, Tracking, Invoices, Customers, Subcontractors)
and Phases 3-5, per Ethan's 2026-08-11 scoping decision. Their design sections above remain
valid for when this is picked back up.

No open product-behavior questions remain in the active scope — both flagged decisions (token
scoping, "On the road" stand-in) are confirmed above.
