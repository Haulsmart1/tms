# Console restyle, remaining pages: design

Date: 2026-08-18
Status: approved by Ethan (interactive brainstorm, all sections signed off).

## Problem

After five restyle batches (foundation + dashboard/jobs, POD console, tracking console,
drivers + settings/users, Stuart theme integration covering pod/assets/maintenance), the
console still has 13 legacy-styled files across 8 areas: `/invoices`, `/customers`,
`/subcontractors`, `/vehicles`, `/tachograph`, `/telematics`, `/stats`, and the settings
family (`/settings` hub, `company`, `permissions`, `licences`, `invoices`,
`portal-invites`; `/settings/users` is already done). They style via hardcoded
`CSSProperties` objects or inline hex; `/tachograph`, `/telematics`, and the `/settings`
hub additionally load a remote Unsplash background image. This batch finishes the app-wide
rollout of the established design system with zero logic change.

## Scope

In scope (one commit per page, one branch):

1. `/tachograph` and `/telematics` (smallest risk, first)
2. Settings family: `/settings` hub, `/settings/company`, `/settings/permissions`,
   `/settings/licences`, `/settings/invoices`, `/settings/portal-invites`
3. `/stats`
4. `/vehicles`
5. `/customers` and `/subcontractors`
6. `/invoices` (largest, last)

Out of scope: `/settings/users` (done), super-admin pages, driver/subcontractor portal
dashboards, the 33 findings queued in
`docs/superpowers/reviews/2026-08-18-stuart-integration-findings.md` (still queued), and
any DataTable structural conversions.

## Ground rules (the freeze)

- Visual-only. Every query, handler, validation rule, and state shape stays
  byte-identical. Only JSX structure, classNames, and imports change.
- Known quirks are preserved, not fixed: asymmetric success messages between customers
  and subcontractors, no edit/delete UI on subcontractors, no delete-guard on customers,
  unconfirmed toggle-active, `window.confirm` deletes where they exist, single
  undifferentiated message strings.
- Pages keep their current shape: card lists stay card lists, tables stay tables, inline
  edit forms stay inline. No new interaction affordances.
- Established wrapper pattern verbatim: root
  `<div className="ds min-h-screen bg-canvas font-sans text-ink">` (the missing `.ds`
  wrapper was the root cause found in the 2026-08-12 polish pass, so it is the first
  thing checked on every page), kicker + title header, token classes throughout, shared
  `Badge`/`Button`/`Field`/`Textarea`/`Stat` where the markup calls for them, IBM Plex
  Mono (`font-mono`) for operational data: registrations, references, money, dates,
  coordinates, durations.
- The Unsplash background image goes away as part of the restyle (styling, not logic,
  and an external request besides).
- No em-dashes in any new copy. Existing UI copy is content and stays as-is.

## New shared components (presentational only)

- `components/Select.tsx`: Field-like API (label, id wiring, error text slot) wrapping a
  native `<select>`. Prevents the raw-select class string (finding 14) from multiplying
  through this batch. Used on newly-touched pages only; the existing call sites in /pod
  and /assets stay untouched until the queued post-freeze swap.
- `components/MessageBanner.tsx`: the persistent info/success/danger banner every page
  hand-rolls. Same persistent semantics (no auto-dismiss, no behavior change), tinted
  per tone, with `role="status"` / `aria-live="polite"` (finding 13's fix, markup-only,
  so new call sites are born correct). Pages whose message state cannot distinguish
  tones render it neutral; splitting that state stays queued (finding 30 pattern).

## Per-page treatment

### /tachograph and /telematics

Full visual rebuild; there is barely a design to preserve. ds header with kicker,
driver/position data into token-styled card grids (their current shape), mono for
timestamps/durations/coordinates, proper loading text state. Queries stay exactly as they are: unscoped, `select("*")`, limit 20. The tenant
gap is logged, not fixed (Ethan's explicit call, consistent with how /assets' identical
gap was carried as finding 10).

### Settings family

Hub becomes a token card grid (links unchanged, emoji icons kept as content). Subpages
get the standard treatment: forms onto `Field`/`Select`/`Textarea`/`Button`, message
strings onto `MessageBanner`, tables and lists restyled in place. `/settings/licences`
(billing actions) and `/settings/company` (large form) are the two substantial ones.

### /stats

KPI figures onto `Stat` tiles where they are plain number cards today. The hand-rolled
chart rendering keeps its structure exactly, recolored onto tokens with mono numerals.
No chart library introduced.

### /vehicles

The big-page treatment proven on /drivers: create/edit form onto shared components,
card/list restyled in place, compliance dates in mono, status onto `Badge`.

### /customers and /subcontractors

Per the still-valid sections of
`docs/superpowers/specs/2026-08-11-console-design-system-phase1-2-design.md`: inline
create/edit forms plus lists restyled. All preserved quirks listed under Ground rules
apply here.

### /invoices

The one page whose 2026-08-11 spec section is stale: Stuart rewrote it (9 tabs, VAT and
currency fields, Xero sync, credits/payments/statements/chase/POs/accounting). Treatment:
tab strip onto the token pill/tab pattern (reuse `components/Tabs.tsx` if its API fits,
otherwise style in place), metric header cards onto `Stat`, both tables and every tab's
forms onto tokens/`Field`/`Select`, statuses onto `Badge` (draft/sent/paid plus
accounting sync states). Largest single commit of the batch. `createInvoice`, Xero sync,
and credits/payments math untouched.

## Branch and sequencing

One branch, `ethan/console-restyle-remaining`, one commit per page, in the scope order
above (smallest risk first, invoices last). Single review and merge at the end.

## Findings log

New doc `docs/superpowers/reviews/2026-08-18-console-restyle-remaining-findings.md`,
same format as the Stuart findings doc, seeded upfront with:

1. /tachograph and /telematics have no TenantGate and no tenant filter; RLS on
   `drivers`, `driver_activity_logs`, and `telematics_positions` is the only guard.
   Needs the tenant-context treatment when the freeze lifts.

Everything else spotted mid-restyle gets logged there, not fixed.

## Security

- No query, RLS, or write-path changes anywhere. No new affordances, so no new
  authorization surface.
- Two incidental design-only wins: the third-party Unsplash request is removed, and
  `MessageBanner` adds a live region.

## Verification

- `npm run typecheck` and `npm run build` clean after each page commit; `npm test` at
  the end. No logic changed, so no new tests are expected; a test failure means the
  freeze was broken.
- Per-page diff self-check that no handler/query/state line changed: the diff should be
  JSX, classNames, and imports only.
- Signed-in visual pass per page at desktop and mobile width via `scripts/dev-login.mjs`,
  strictly read-only: no form submissions locally, because `.env.local` points at the
  live Supabase.
- Ethan's own signed-in pass stays the final gate, post-merge, as with previous batches.
