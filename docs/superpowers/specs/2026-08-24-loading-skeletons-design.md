# Loading skeletons, batch 1: foundation, gate inversion, dashboard and customers

Date: 2026-08-24
Status: agreed, ready for an implementation plan

## The problem

The app has 35 routes and exactly one skeleton. `DataTable`'s `state="loading"`
(`components/DataTable.tsx:81-91`) is used in a single place, `app/dashboard/page.tsx:241`.
Everywhere else, loading is a text string, and there are nine different strings for the
same idea: `Loading...`, `Loading customers...`, `Loading drivers...`, `Loading assets...`,
`Loading maintenance records...`, `Loading POD records...`, `Loading jobs…` (the only one
using a real ellipsis), `Loading the day's jobs...`, `Loading statistics...`.

Three problems sit underneath the inconsistency.

**The gate blanks the whole app.** `TenantProvider.resolve()` performs two serial awaited
round trips, `supabase.auth.getUser()` (`app/components/TenantProvider.tsx:39`) then the
`get_tenant_context` RPC (`:49`), before status leaves `loading`. `TenantGate` renders a
full-viewport panel containing the word `Loading...` for that whole window
(`app/components/TenantGate.tsx:25-27`), and `shouldShowShell` returns false unless status
is `ready` (`lib/nav/shouldShowShell.ts:15`), so the sidebar does not render either. The
first paint after sign-in is a bare dark screen with two words on it, roughly 300ms to 1.5s,
on every cold load of 15 gated routes.

**Four pages render wrong data rather than a loading state.** `/jobs` shows "No jobs match
the current filters." while its query is in flight. `/settings/invoices` shows £0 and
"0 licensed vehicles". `/pod`'s stat row shows zeroes. `/dashboard`'s "Needs attention"
panel shows "Nothing needs attention right now." These are false statements, not missing
skeletons.

**The one existing skeleton is nearly invisible and ignores reduced motion.**
`DataTable.tsx:86` fills its bars with `bg-surface-2`. In the dark theme `--surface-2`
(`#131B2B`) is darker than the `--surface` (`#161F31`) card it sits on, measuring 1.05:1.
It also uses Tailwind's `animate-pulse`, which in this codebase carries no
`prefers-reduced-motion` guard, so it animates infinitely for users who asked it not to.

## Scope

This spec covers batch 1 only. The work is split by a per-route allowlist so later batches
land independently, following the `THEMEABLE_ROUTES` precedent in `lib/nav/themeableRoutes.ts`.

In scope:

- A shared `Skeleton` primitive, a `--skeleton` token, motion and accessibility semantics.
- Inverting `TenantGate` and `shouldShowShell` behind a `SKELETON_READY_ROUTES` allowlist.
- Converting `/dashboard` and `/customers`.
- Repairing the existing `DataTable` skeleton on the way past.

Out of scope, deliberately:

- The other 14 design-system pages. They roll in as later batches, each adding itself to the
  allowlist.
- The seven legacy inline-styled pages (`TenantGate`'s own panels, `/driver/dashboard`,
  `/subcontractor/dashboard`, the four `/super-admin` list pages, `PodLink`). These cannot
  consume `ds` tokens and want converting to the design system first, which is a different
  project.
- Route-level `loading.tsx` and `Suspense` for the async server components
  (`/super-admin/*`, `/pod/share/[token]`, `/quotation/share/[token]`). The repo has zero of
  both today. Worth doing, unrelated to this.
- The false-data pages other than `/dashboard`, which is in scope only because it is being
  converted anyway.

## Decisions, and why

**Fidelity: pixel-faithful.** Skeletons mirror the real component's exact padding, borders,
avatar shapes and pill shapes, not generic grey boxes.

**Built as loading-aware components, not mirror files.** Each page's card or row is extracted
into a real component taking a `loading` prop, rendered N times with placeholder data. The
layout is defined once, so the skeleton cannot drift from the component it mirrors. The
rejected alternative was a separate `<CustomersSkeleton />` per page duplicating class names,
which is faster to land but leaves two copies of every layout drifting silently, with no test
that would ever catch it.

**Shell first, destination page skeleton.** The gate stops blocking and each converted page
draws its own skeleton while tenant context resolves, so the user lands on a recognisable
page from the first frame rather than a blank panel.

**Skeletons appear immediately, with no delay and no minimum duration.** A 200ms delay was
considered, to avoid a skeleton flashing and vanishing on a fast warm session. It was rejected
because, once the gate passes through, the skeleton is the initial render rather than a
transition into one: there is no flicker on the way in, only on the way out. Immediate also
means no timers and nothing to clean up on unmount.

**Only data-bearing leaves become skeletons.** Structure, static labels, headings and
fixed-size controls render for real. This is less work and more faithful than skeletonising
whole blocks.

## Section A: the foundation

### The `--skeleton` token

`lib/theme/contrast.test.ts` asserts that every block in `app/tokens.css` declares the same
token names with no partial overrides, and that `.dark` is value-identical to `:root`. The new
token therefore goes in all three blocks:

- `:root` and `.dark`: `#2B3852`
- `.light`: `#CDD4E1`

Measured with the repo's own `contrastRatio`, against the three surfaces a skeleton can sit on:

| fill on | dark | light |
| --- | --- | --- |
| `--surface` | 1.40 | 1.49 |
| `--surface-2` | 1.47 | 1.30 |
| `--canvas` | 1.54 | 1.35 |

For comparison, today's `bg-surface-2` fill measures 1.05:1 on `--surface` in dark and 1.14:1
in light.

A new case in `lib/theme/contrast.test.ts` asserts `--skeleton` clears **1.25:1** against
`--surface`, `--surface-2` and `--canvas` in both themes. This deliberately does not use the
file's existing `AA_NON_TEXT` floor of 3:1: a placeholder bar at 3:1 reads as real content,
and since every skeleton is `aria-hidden` it is decorative rather than a UI control. The test
comment must say so, since the convention in that file is that every floor explains itself.

`bg-skeleton` is wired up by adding `skeleton: "var(--skeleton)"` to the `colors` map in
`tailwind.config.ts:63`, alongside the existing `surface` entry at `:65`.

### The primitive

`components/Skeleton.tsx`:

```tsx
type Props = { w?: string; h?: string; rounded?: "sm" | "full"; className?: string };

export default function Skeleton({ w = "100%", h = "0.75rem", rounded = "sm", className }: Props) {
  return (
    <span
      aria-hidden
      style={{ width: w, height: h }}
      className={cn("ds-pulse block bg-skeleton", rounded === "full" ? "rounded-full" : "rounded", className)}
    />
  );
}
```

### Motion

Reuses the existing `.ds-pulse` keyframe (`app/globals.css:66-80`), which already carries a
`prefers-reduced-motion` guard. A useful side effect: `ds-pulse` is scoped as `.ds .ds-pulse`,
so the primitive is inert on legacy pages by construction rather than by discipline.

### Accessibility

Replacing announced text with silent grey spans would be an accessibility regression, so:

- Every skeleton carries `aria-hidden`.
- The region being loaded carries `aria-busy="true"`.
- Each loading region carries one visually hidden `role="status"` line, for example
  "Loading customers".

Net effect is an improvement over the current text, not a downgrade.

### Repairing the existing skeleton

`DataTable.tsx:86` moves from `animate-pulse bg-surface-2` to the primitive, fixing both the
1.05:1 invisibility and the missing reduced-motion guard.

## Section B: inverting the gate

### The allowlist

New `lib/nav/skeletonReadyRoutes.ts`, shaped deliberately like its neighbour
`lib/nav/themeableRoutes.ts`: an exported array, an `isSkeletonReadyRoute(pathname)` helper
with the same trailing-slash normalisation and exact (not prefix) matching, a header comment
explaining what earns a route a place on the list, and a closing note that the file is deleted
once every route is listed. A matching `skeletonReadyRoutes.test.ts` follows the existing
`themeableRoutes.test.ts`.

Batch 1 contents: `/dashboard`, `/customers`.

### Why a route list rather than a prop

`TenantGate` is applied per page, inside each page body (`app/dashboard/page.tsx:288` closes
it). `AppShell` is rendered once, in `app/layout.tsx:82`, far from any page. A prop could only
reach the first. A pathname list reaches both consumers:

- `shouldShowShell` returns true when `status === "ready"`, or when `status === "loading"` and
  the route is skeleton-ready. `signed-out` and `no-tenant` keep returning false. The file's
  existing reasoning, an allowlist of good values rather than a denylist of bad ones, survives
  intact: it becomes an allowlist of two explicit combinations.
- `TenantGate` renders `children` instead of its panel when `status === "loading"` and the
  route is skeleton-ready. The `signed-out` and `no-tenant` branches are untouched, so the
  fail-closed behaviour that matters stays exactly where it is.

### The token-refresh flash

`TenantProvider.resolve()` calls `setData(LOADING)` on entry (`:38`) and re-runs on every
`SIGNED_IN`, `SIGNED_OUT` and `USER_UPDATED` event (`:66-70`). Today this is invisible, because
the gate blocks and nothing was on screen anyway. Once the gate passes through, a routine token
refresh would replace a fully populated page with a skeleton, which is strictly worse than
current behaviour.

`resolve()` is not changed: the tenant-context de-hardcode spec
(`docs/superpowers/specs/2026-07-29-tenant-context-de-hardcode-design.md:186`) records
re-gating on tenant change as deliberate. Instead the rule lives in a pure function, in `lib/`
where vitest can reach it:

```ts
// lib/loading/skeletonVisibility.ts
export function shouldShowSkeleton(
  { tenantStatus, fetching, hasData }:
  { tenantStatus: TenantStatus; fetching: boolean; hasData: boolean },
): boolean {
  if (hasData) return false;              // never flash a skeleton over content already on screen
  return tenantStatus !== "ready" || fetching;
}
```

Converted pages derive their skeleton visibility from this rather than from a local boolean.

### Querying before tenant resolves

CORRECTED 2026-08-24, during Task 7's review. This section originally claimed a gated page's
effects cannot run before `status === "ready"` because the page never mounts. That is false.
`TenantGate` is rendered *inside* each page's own JSX rather than wrapping the component, so
it swaps the visible DOM but has never prevented the page's own `useEffect` from firing.
`/dashboard` has been issuing its four Supabase queries with `activeTenantId === null` on
every cold load, and still does.

So the `status !== "ready"` early-return in each converted page's loader fixes a pre-existing
bug rather than merely insuring against the gate inversion. It is still exactly the change
described: early-return unless ready, with `status` in the dependency array. Only the reason
for it changed.

Blast radius, stated precisely: per `CLAUDE.md`, RLS in Postgres is the isolation boundary and
the SECURITY DEFINER helpers fail closed. `TenantGate` is a UX and correctness guard, not the
security perimeter. Getting this wrong produces a wasted round trip or a null crash, not
cross-tenant data.

### The structural enforcement, deferred

The guard above is a convention. The enforcement worth having is making `TenantContextValue`
a discriminated union on `status`, so `filterByTenant` and `writeTenantId` exist only on the
`ready` variant and `npm run typecheck` refuses to compile a page that queries before it is
ready.

It is deferred because every existing page destructures `filterByTenant` unconditionally, so
it is a roughly 15 page compile break. It belongs in the batch where those pages are already
being edited, not this one. This is a known gap in batch 1, recorded here so it is not
rediscovered as a finding.

## Section C: the two pages

### `/dashboard` (290 lines, no extraction needed)

- `Stat` tiles (`:211-230`) currently show `"—"` while loading. `Stat`'s `value` prop widens
  from `string` to `ReactNode`, a safe widening since `string` is assignable to `ReactNode`,
  and takes a `Skeleton`. This touches every `Stat` call site in the app, so `npm run typecheck`
  is the check.
- The "Today's jobs" `DataTable` (`:241-247`) needs no change: it already passes
  `state="loading"` and inherits the repaired skeleton from Section A.
- "Needs attention" (`:251-267`) currently renders "Nothing needs attention right now." during
  load, a false statement. Gains a loading branch of 3 placeholder rows.
- "Revenue, last 7 days" (`:269-283`) renders an empty bar row. Gains 7 skeleton bars. This one
  is genuinely zero-shift, since the count is known ahead of time.

### `/customers` (1094 lines, the archetype later batches copy)

Extract `app/customers/CustomerCard.tsx` taking `{ customer, loading }`. Widen the local `Info`
helper (`:1081`) `value` prop to `ReactNode`. The grid (`:859`) renders 6 placeholder cards
while loading.

The card has four bands, handled differently:

| Band | Source | Loading treatment |
| --- | --- | --- |
| Name, account code, status `Badge` | `:865-882` | Skeleton bar, skeleton bar, pill-shaped skeleton |
| 6 `Info` cells | `:884-916` | Real labels, skeleton values |
| Flag badges | `:919-935` | 2 placeholder pills |
| Edit and Delete buttons | `:937-955` | Real buttons, `disabled` |

The buttons are the instructive case: they are fixed-size and carry no data, so rendering them
real-but-disabled is both more faithful and more honest than a grey rectangle. This is the
"only data-bearing leaves" principle in practice.

### Where pixel-faithful hits its ceiling

Two things shift on arrival and cannot be fixed without knowing the data in advance. They are
recorded rather than papered over:

- **Card count.** 6 skeleton cards render regardless of how many customers arrive.
- **Flag badge row.** 0 to 5 badges in reality, 2 while loading.

## Testing

vitest covers `lib/**/*.test.ts` only (`vitest.config.ts`), so all new unit tests live in `lib/`:

- `lib/nav/skeletonReadyRoutes.test.ts`, new, following `themeableRoutes.test.ts`.
- `lib/loading/skeletonVisibility.test.ts`, new. Covers the `hasData` short circuit
  specifically, since that is the token-refresh regression.
- `lib/theme/contrast.test.ts`, new case for `--skeleton` at the 1.25:1 floor in both themes.
- `lib/nav/shouldShowShell.test.ts`, extended: the new loading-plus-allowlisted combination
  returns true, and `signed-out` and `no-tenant` still return false on an allowlisted route.

`npm run typecheck` catches the two prop widenings (`Stat.value`, `Info.value`).

Components are not unit tested in this repo, so `Skeleton` and `CustomerCard` are covered by
typecheck plus a signed-in manual pass.

Before starting, run the two Playwright layout specs in `tests/`, which is a separate npm
project and not part of `npm test`. `tests/tracking-layout.spec.mjs:134` and
`tests/pod-layout.spec.mjs:106` both assert against the `TenantGate` panel as the thing
rendered on redirect to `/login`. Neither route is in batch 1, so pass-through should not apply
to them, but this must be verified rather than assumed.

## Risks

- **`Stat.value` widening touches every call site.** Safe in principle, confirmed by typecheck.
- **The Playwright specs assert on `TenantGate`.** Checked before and after, per above.
- **`/dashboard` is already considered done.** Replacing its `"—"` placeholders is a visible
  change to a shipped page, and wants a signed-in look before merge.
- **The allowlist can disagree with reality.** A route added to `SKELETON_READY_ROUTES` before
  its loader early-returns on `status` would query with an unresolved tenant. Mitigated by the
  list being short, documented and reviewed; removed properly by the deferred discriminated
  union.

## Files

New:

- `components/Skeleton.tsx`
- `lib/nav/skeletonReadyRoutes.ts`, `lib/nav/skeletonReadyRoutes.test.ts`
- `lib/loading/skeletonVisibility.ts`, `lib/loading/skeletonVisibility.test.ts`
- `app/customers/CustomerCard.tsx`

Changed:

- `app/tokens.css` (the new token in all three blocks)
- `tailwind.config.ts` (the `skeleton` entry in the `colors` map)
- `components/DataTable.tsx`, `components/Stat.tsx`
- `app/components/TenantGate.tsx`, `lib/nav/shouldShowShell.ts`
- `app/dashboard/page.tsx`, `app/customers/page.tsx`
- `lib/theme/contrast.test.ts`, `lib/nav/shouldShowShell.test.ts`

## Later batches

Each adds its route to `SKELETON_READY_ROUTES` and follows the `/customers` recipe. Rough
grouping by shape, largest files noted:

1. Card grids: `/drivers` (2150), `/subcontractors` (1634), `/maintenance` (1710),
   `/vehicles` (1226), `/assets` (802), `/settings/users` (403).
2. Tables and lists: `/pod` (1816), `/invoices` (4796, includes `QuotationPanel` and
   `QuoteRequestsInbox`).
3. Bespoke layouts: `/tracking` (320), `/planning` (568), `/stats` (1452).
4. Small pages: `/telematics` (80), `/tachograph` (109), `/settings/licences` (390),
   `/settings/company` (878), `/settings/documents` (1574).
5. `TenantContextValue` becomes a discriminated union; the convention guard becomes a compile
   error. Best done alongside batch 1 or 2 above, while those pages are open.
6. `SKELETON_READY_ROUTES` and its helper are deleted once every route is listed, and
   `TenantGate`'s loading panel goes with them.

`/jobs` is a special case within batch 2: it has no loading flag at all today, so converting it
requires adding one, which necessarily fixes its "No jobs match the current filters." false
empty state.
