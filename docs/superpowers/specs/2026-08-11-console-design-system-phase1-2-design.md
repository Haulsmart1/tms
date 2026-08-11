# Console design system — Phase 1 (Dashboard & Jobs) + Phase 2 (Operations): design

Date: 2026-08-11
Status: brainstormed, pending user review

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

```tsx
// Both checks are required. The pathname check alone was the original bug
// (91fa6b0): before it existed, /login rendered the full internal nav to a
// signed-out visitor. The status check is the fail-closed backstop — it's
// what makes a forgotten future public route safe by default.
if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) {
  return null;
}
if (status === "loading" || status === "signed-out" || status === "no-tenant") {
  return null;
}
```

One change from today's `AppHeader`: adding `"no-tenant"` to the status check. Today's
`AppHeader` only hides on `loading`/`signed-out`, so a signed-in user with an unresolved
tenant (an edge case — orphaned profile) briefly sees full nav chrome before `TenantGate`
blocks the page content itself. No real data exposure (every page's own `TenantGate` still
fail-closes), but it's a free tightening while this file is already being rewritten, called
out explicitly rather than done silently.

Topbar: page title, global search (visual only this phase — no search backend exists),
notifications bell (visual only — no notifications backend exists), user chip, sign-out.
Sign-out is new: `AppHeader` never had one (flagged as a gap in the roadmap). Wire it to
`supabase.auth.signOut()` then redirect to `/login`.

### Components

Restyle in place (already accessibility-hardened, keep their APIs):
`Button`, `Badge`, `Field`, `Textarea`, `Container`.

Flesh out from unused scaffolding (real TSX already in the repo from the earlier handoff,
just needs Console's visual values, not a rewrite):
`AppShell`, `DataTable`, `Modal`, `Toast`, `Skeleton`.

New, from Console's spec (no existing equivalent):
`Stat` (KPI tile), a job-detail `Drawer` (slide-over), kicker/section-label text style,
status-pill variants matching Console's semantics (`--status-ontime`, `-atrisk`, `-late`,
`-planned`, `-idle`; Phase 1's Jobs board only uses `planned`/`unassigned`/`completed` per
the real status vocabulary, see below).

**Table states**, generalized from the Jobs board prototype's four-state pattern (loaded /
loading-skeleton / error-with-retry / empty-with-clear-filters) — applied to every page in
this phase that renders a fetched table. This is new *presentation* around the existing
fetch call, not a change to what's fetched or how errors are handled underneath, **except**
Tracking (see below), which currently has no error state to make presentational at all.

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
"View all" links to `/jobs`. Revenue chart: last-7-days sum of `invoices.total` where
`status = 'paid'`, grouped by `issue_date` — client-side aggregation, matching the pattern
already used on `/stats`. All reads only; this page gains a data layer but no write path.
Wrapped in `TenantGate` like every other data page (it currently isn't gated at all).

### `/jobs` (Phase 1)

Visual rebuild only. Create/edit form → `AppShell`'s content area with the new `Field`/
`Button` styling; job list → `DataTable` with status `Badge` (using only the two real
statuses, `planned`/`completed`, plus a derived "unassigned" visual state when
`vehicle_id`/`driver_id` is null — **not** a third database status); nested stop cards → the
same POD-capture sub-form, restyled; the prototype's "assign"/"cancel" actions become
`Modal`s (using the newly-fleshed-out `Modal` component) instead of inline forms, matching
Console's interaction pattern; job detail becomes the new `Drawer` instead of expanding
inline. **No change to `saveJob`, `savePod`, `deleteJob`, validation schemas, or the
delivered-cascade logic** — only the JSX/styling around them.

### `/pod` (Phase 2)

Visual rebuild: stop cards → `DataTable`/card pattern with the new tokens; upload widgets
restyled but functionally identical (`upsert:false`, same storage path convention, same
filename sanitization); `PodLink` component unchanged (already token-driven via CSS
variables, not raw inline hex, so it inherits the new palette with minimal edits).

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

- The AppShell rewrite is the highest-risk file in this phase because it's exactly where the
  original hotfix (91fa6b0) was needed — reviewed above under Architecture, both guards
  carried forward, `no-tenant` gap closed.
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

New:
- `app/components/AppShell.tsx` (or restyled from the existing unused scaffold)
- `components/Stat.tsx`, `components/Drawer.tsx` (or equivalent names matching existing
  component file conventions)
- Dashboard data-fetching logic (likely `app/dashboard/page.tsx` becomes `"use client"`, or a
  server component + client sub-component split — decide in planning)

Modified:
- `app/tokens.css`, `tailwind.config.ts` (token re-key)
- `app/layout.tsx` (Plex Mono weight 600, mount `AppShell` instead of `AppHeader`, remove
  `AppHeader`)
- `app/components/AppHeader.tsx` → deleted, replaced by `AppShell`
- `app/dashboard/page.tsx`, `app/jobs/page.tsx`, `app/pod/page.tsx`, `app/tracking/page.tsx`,
  `app/invoices/page.tsx`, `app/customers/page.tsx`, `app/subcontractors/page.tsx`
- `components/Button.tsx`, `Badge.tsx`, `Field.tsx`, `Textarea.tsx`, `Container.tsx`
  (restyled to new tokens, API unchanged)
- `app/components/PodLink.tsx` (token values only)

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

## Dependencies / order

1. Foundation (tokens + fonts + AppShell) — nothing else in this phase can build without it.
   **Confirm the token-scoping question above (shared keys vs. new keys) before starting**,
   since it decides whether the landing page changes color as a side effect.
2. Dashboard (new data layer) and Jobs (visual-only) — Phase 1 proper, matches the Console
   mockup, can happen in either order or in parallel once the foundation lands.
3. Phase 2 pages (POD, Tracking, Invoices, Customers, Subcontractors) — stack on the
   foundation + component set from step 1, apply the established pattern. Tracking carries
   the one small additive logic change (error capture); the rest are presentation-only.

No open product-behavior questions remain in this spec — both flagged decisions (token
scoping, "On the road" stand-in) are confirmed above.
