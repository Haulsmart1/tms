# Loading skeletons, batch 2: the gated card pages, and the tenant union

Date: 2026-09-03
Status: agreed, ready for an implementation plan

Follows `2026-08-24-loading-skeletons-design.md`, which covered batch 1 and remains the
reference for the primitive, the token, the motion and accessibility rules, and the
`CustomerCard` recipe every page here copies. Read it first. This spec records only what is
new or corrected.

## Where batch 1 left things

`SKELETON_READY_ROUTES` holds three paths: `/dashboard` and `/customers` from batch 1, and
`/settings/billing`, added later by the billing restyle. Seventeen routes remain.

## Two corrections to the batch 1 spec's plan for later batches

**Correction 1: the "card grids" grouping does not hold.** Batch 1's spec grouped `/drivers`,
`/subcontractors`, `/maintenance`, `/vehicles`, `/assets` and `/settings/users` as one batch on
the grounds that they share a shape. They do not share the prerequisite. Rule 1 of
`lib/nav/skeletonReadyRoutes.ts` is that a route must render `<TenantGate>` before it can be
listed, or the sidebar appears during tenant resolution while the page body renders ungated
beside it. Of that group, `/drivers`, `/maintenance` and `/assets` do not render `TenantGate`
at all. They carry an extra step the grouping did not account for, and they are held back.

The seventeen remaining routes split on that line, not on page shape:

- Render `TenantGate`, ready for the recipe: `/jobs`, `/pod`, `/invoices`, `/planning`,
  `/stats`, `/subcontractors`, `/vehicles`, `/tracking`, `/settings/users`,
  `/settings/licences`, `/settings/portal-invites`.
- Do not render `TenantGate`, so they need one added first: `/drivers`, `/maintenance`,
  `/settings/documents`, `/settings/company`, `/assets`, `/tachograph`, `/telematics`.

`/settings/portal-invites` appears in neither of batch 1's batch lists. It was missed.

**Correction 2: the discriminated union is a three-page break, not fifteen.** Batch 1's spec
deferred making `TenantContextValue` a union on `status`, estimating "roughly 15 pages". The
real figure is three page files that call `filterByTenant` outside this batch, once the union is
scoped to that field alone (see Section A). The spec also said the union is "best done alongside
batch 1 or 2, while those pages are already being edited". At a fifth of the estimated cost, and
with the recommended window still open, it is in scope here.

## Scope

Five pages onto the allowlist, plus the union.

In scope:

- `/subcontractors`, `/vehicles`, `/settings/users`, `/settings/licences`,
  `/settings/portal-invites`.
- `TenantContextValue` becomes a minimal discriminated union on `status`.
- The three pages outside this batch that the union breaks gain a guard line each, and no
  skeletons.
- Two "no tenant selected" states, on the two pages that need a concrete tenant id.

Out of scope:

- The other twelve routes. Later batches.
- Adding `TenantGate` to the seven pages that lack one. That is its own batch, and doing it
  here would mix a UX change with a correctness change on pages nobody is otherwise touching.
- Memoizing the tenant context value. See Risks.
- Deleting `SKELETON_READY_ROUTES`. Twelve routes short of that.

## Section A: the minimal union

### The shape

`TenantContextValue` currently lives in `app/components/TenantProvider.tsx:18`, outside vitest's
reach (`vitest.config.ts` covers `lib/**` only). It moves to `lib/tenant/context.ts`, beside the
`TenantStatus` and `TenantRole` types it is built from, and splits:

```ts
type TenantContextBase = {
  status: TenantStatus;
  role: TenantRole;
  userEmail: string | null;
  tenants: TenantOption[];
  activeTenantId: string | null;
  setActiveTenantId: (id: string | null) => void;
};

export type ReadyTenantContext = TenantContextBase & {
  status: "ready";
  filterByTenant: <Q>(query: Q) => Q;
};

export type UnresolvedTenantContext = TenantContextBase & {
  status: "loading" | "signed-out" | "no-tenant";
};

export type TenantContextValue = ReadyTenantContext | UnresolvedTenantContext;
```

`writeTenantId: string | null` stays on `TenantContextBase`, available on both variants.

### Why `filterByTenant` is gated and `writeTenantId` is not

REVISED 2026-09-03, while writing the implementation plan. This spec originally gated both
fields and claimed the cost was "one guard line at the top of the loader" on six pages. That was
measured wrong. `/invoices` holds 35 `writeTenantId` references, all inside save handlers rather
than any loader, and `/settings/company:204` and `/settings/documents:112` destructure
`writeTenantId` in the component body, where no loader guard can reach it. Gating both fields is
about 45 edit sites across three large files, not six lines.

The two fields do not carry equal risk, so gating both was never the point.

`filterByTenant` fails **silently**. With an unresolved tenant, `applyTenantFilter` returns the
query unmodified (`lib/tenant/filter.ts:6`), so the read succeeds and comes back wrongly scoped.
Nothing throws and nothing is null. That invisibility is why `/dashboard` issued unscoped
queries on every cold load until batch 1 found it by reading the code.

`writeTenantId` is already fail-safe **by value**. While loading, `role` is the default `"staff"`
and `homeTenantId` is null, so `computeWriteTenantId` returns null (`lib/tenant/context.ts:61`),
and every call site already opens with a null check before writing. The compiler would be
enforcing a test the code already performs, at a cost of 45 edits.

So the union gates the field whose failure is invisible, and leaves alone the field whose failure
is already caught at every site. Gating `writeTenantId` too is recorded as a follow-up for the
batch that converts `/invoices`, when that file is open for other reasons.

The break is therefore three pages, not six.

### Why minimal rather than full

A full union, moving `role` and `activeTenantId` onto the ready variant too, is more honest:
`role` currently defaults to a fabricated `"staff"` while loading (`TenantProvider.tsx:32`),
which is a real if unexercised lie. It was rejected because almost every page computes
`const isAdmin = tenant.role === "admin" || tenant.role === "super_admin"` in the component body,
outside any status branch, and `activeTenantId` appears in effect dependency arrays where
narrowing cannot reach. That converts a six-line change into a restructure of every page's
opening lines, to guard against a bug nobody has hit. The fabricated `role` is worth fixing; it
is not worth fixing here, disguised as a skeletons batch.

An opt-in `isTenantReady()` predicate was also rejected. An optional guard is the honour-system
convention batch 1 already has, with better ergonomics. It would not have caught the `/dashboard`
bug that batch 1 found, because nothing would have forced anyone to call it.

### What it costs

Three pages outside this batch call `filterByTenant` without a status narrowing: `/jobs`
(5 calls), `/planning` (4) and `/tracking` (1). In all three every call sits inside a single
loader, so each page gains one guard at the top of that loader:

```ts
if (tenant.status !== "ready") return;
```

with `tenant.status` added to the effect's dependency array.

Two things about this are worth being precise about.

It is a **bug fix, not insurance**. Per the correction recorded in batch 1's spec, `TenantGate`
is an element inside each page's own JSX rather than a wrapper around the component, so it has
never stopped a page's effects from firing during tenant resolution. All three of these pages are
issuing queries with an unresolved tenant today. The guard stops that.

It does **not** make these pages skeleton-ready. They gain step 2 of the four-step checklist in
`lib/nav/skeletonReadyRoutes.ts` and nothing else. They stay off the allowlist, `TenantGate`
keeps blocking on them, and they keep their existing loading text. Adding any of them to the
list on the strength of this change alone would produce exactly the failure mode rule 3 warns
about.

Blast radius is unchanged from batch 1's statement of it: RLS in Postgres is the isolation
boundary and the SECURITY DEFINER helpers fail closed. Getting this wrong produces a wasted
round trip or a null crash, not cross-tenant data.

### How it is verified

`npm run typecheck` is the whole verification, and it is exhaustive for this class of error by
construction: a page that reaches `filterByTenant` without narrowing cannot compile. The
sequence is: clean before, failing on exactly those three pages after the type change, clean
again after the three guards. If the middle step names a fourth file, the count in this spec was
wrong and the plan needs revisiting rather than the extra file quietly fixing.

## Section B: the four card pages

Each is the `CustomerCard` recipe unchanged: extract the row type to `types.ts`, extract the
card into a component taking `loading`, render N placeholders while loading, skeletonise only
data-bearing leaves, and render fixed-size buttons real but `disabled`. Both carried-over
details from batch 1 apply throughout: `Skeleton` needs `display="inline-block"` anywhere it
stands in for text, and each loader early-returns unless the tenant is ready, which the union
now enforces.

Each page's loading region also gains `aria-busy` and one visually hidden `role="status"` line,
per batch 1's accessibility rule.

### `/subcontractors` (1634 lines)

New: `app/subcontractors/types.ts` (`Subcontractor`, `Employee`, `SubcontractorVehicle`),
`app/subcontractors/SubcontractorCard.tsx`.

| Band | Loading treatment |
| --- | --- |
| Name, owner-driver / fleet type line | Skeleton bar, skeleton bar |
| `StatusBadge` (compliance) | Pill-shaped skeleton |
| 4 `Info` cells: Contact, Phone, Operator Licence, Terms | Real labels, skeleton values |
| Edit and other buttons | Real, `disabled` |

Six placeholder cards. The grid is `md:grid-cols-2 xl:grid-cols-3` (`:955`), so six fills two
or three whole rows at every breakpoint rather than leaving a ragged last row.

The employee and vehicle detail panel below the grid renders only when a subcontractor is
selected, and nothing is selected while loading, so it needs no loading state. The current
three-way `loading / empty / grid` branch at `:946` becomes `loading-or-grid / empty`.

### `/vehicles` (1226 lines)

New: `app/vehicles/types.ts` (`Vehicle`, `FleetInsurancePolicy`), `app/vehicles/VehicleCard.tsx`.

| Band | Loading treatment |
| --- | --- |
| Registration (mono), type / make / model line | Skeleton bar, skeleton bar |
| `StatusBadge` (compliance) | Pill-shaped skeleton |
| 3 `ComplianceItem`s: MOT, Tax, Insurance | Real labels, skeleton values |
| "Status: Active" line | Skeleton value, real label |
| Edit / Delete / Deactivate buttons | Real, `disabled` |

`ComplianceItem` gains a `loading` prop, the same widening `Info` took in batch 1.

Four placeholder cards: these are full-width, in a single-column `grid gap-4` (`:946`).

**A bug fixed on the way past.** The loading notice at `:944` renders *above* the grid rather
than instead of it (`{loading ? <Card>Loading vehicles...</Card> : null}` followed by an
unconditional `<div className="grid">`), so during load the page shows a loading card and an
empty grid together. The placeholder cards replace both, which removes the double state rather
than restyling it.

### `/settings/users` (403 lines)

New: `app/settings/users/UserCard.tsx`. No `types.ts`: `TenantUser` is already a named type at
the top of the file and is not needed anywhere else.

| Band | Loading treatment |
| --- | --- |
| Name, email, phone | Three skeleton bars |
| Role `Badge` | Pill-shaped skeleton |
| Edit button | Real, `disabled` |

Four placeholder cards. This page fetches `/api/settings/users/invite`, not Supabase, so it
takes no `filterByTenant` and the union does not touch it. It still needs its own
`tenant.status` guard, for the ordering reason in Section C.

The inline edit form inside a card is only reachable via the Edit button, which is disabled
while loading, so it needs no loading state.

### `/settings/licences` (390 lines)

New: `app/settings/licences/LicenceCard.tsx`.

| Band | Loading treatment |
| --- | --- |
| Licence type heading | Skeleton bar |
| 5 label/value cells: Vehicle, Issue Date, Expiry Date, Billing Status, Notes | Real labels, skeleton values |
| Activate / Deactivate and Delete buttons | Real, `disabled` |

Three placeholder cards, in a single-column `grid gap-3`.

This file is indented with four spaces where the rest of the app uses two. Match the file, do
not reformat it. A whitespace-only rewrite of 390 lines would bury the actual change in the
diff for no benefit.

## Section C: portal-invites, and the two "no tenant selected" states

### `/settings/portal-invites` (251 lines)

This page has no loading flag at all. `loadData` (`:59`) populates four `<select>` dropdowns
from one fetch, and until it returns they render with no options, so the page silently states
that no drivers, subcontractors or employees exist.

It gains the missing `loading` flag. The selects then render **real and `disabled`** while
loading, with no skeletons anywhere on the page.

That is not an exception to the recipe, it is the recipe. A `<select>` is a fixed-size control
whose options are not visible until it is opened, so it carries no data on screen. Batch 1's
"only data-bearing leaves become skeletons" principle covers exactly this case, and it is the
same reasoning that leaves `CustomerCard`'s Edit and Delete buttons rendering real but disabled
rather than as grey rectangles. Skeletonising a form control would have been a new pattern
contradicting a settled one.

### The two "no tenant selected" states

`/settings/users` and `/settings/portal-invites` are the only two pages in this batch that need
a concrete tenant id, because both call an API route that takes `tenantId` as a query parameter
rather than going through `filterByTenant`. `applyTenantFilter` treats a null active tenant as
"do not filter, let RLS decide" (`lib/tenant/filter.ts:5`), so the other three pages work
correctly on "All tenants". These two do not.

Both currently early-return when `tenant.activeTenantId` is null. `/settings/users` then renders
"No users found for this tenant." (`:278`) and `/settings/portal-invites` renders empty
dropdowns. "All tenants" is the **default** view for admins (`pickInitialActiveTenant` returns
null for them), so this is the first thing a company admin sees on both pages, and it is false.

Each gains a third state, distinct from loading and from empty: a short line naming the tenant
selector in the header as the control to use. Copy is a plan-level detail, but it must name the
selector rather than merely saying no tenant is selected, since the point is to tell the user
what to do.

This is scope creep and is accepted deliberately, for a reason specific to this batch: without
it, a skeleton on these two pages is ambiguous. `loading` would be true in a case where nothing
is ever going to arrive, so the placeholder would pulse forever. The state has to be
distinguishable before the skeleton can be correct.

**The order of the two checks is the whole difficulty.** `tenant.activeTenantId` is null in two
completely different situations: while the tenant context is still resolving, and when a
resolved admin is deliberately on "All tenants". Both pages today test only for null and so
cannot tell them apart. Testing null first would show "pick a tenant" for a moment on every
cold load, before the context resolves and the real state replaces it, which is a worse flash
than the one this project exists to remove. So on both pages the checks are ordered:

1. `tenant.status !== "ready"` renders the loading state. This is also the step-2 guard from
   the `skeletonReadyRoutes.ts` checklist, so these two pages get it even though the union does
   not force them to.
2. Then, and only then, a null `activeTenantId` renders "pick a tenant".
3. Then loading, then empty, then content.

The three states are mutually exclusive by that ordering rather than by three independent
booleans, and the implementation should make that structural (a single derived state value)
rather than leaving three conditions to be kept consistent by hand.

## Testing

- `lib/nav/skeletonReadyRoutes.test.ts`: extended for the five new paths.
- `lib/tenant/context.test.ts`: new type-level cases asserting `filterByTenant` and
  `writeTenantId` are absent on `UnresolvedTenantContext` and present on `ReadyTenantContext`.
  vitest does not type-check, so these document the intent and `npm run typecheck` is the gate
  that enforces it. The test comment must say so, rather than implying the assertions run.
- `npm run typecheck`: the primary check, per Section A.
- `npm test`: must stay green. No existing test asserts on the tenant context type or on any
  page in this batch, so the expectation is no change rather than new passes.
- The two Playwright specs in `tests/`, checked before and after as batch 1 did. Neither
  `/pod` nor `/tracking` is in this batch, so pass-through should not reach them, but
  `tests/tracking-layout.spec.mjs:134` and `tests/pod-layout.spec.mjs:106` both assert against
  the `TenantGate` panel, and `/tracking` is one of the three pages gaining a guard. Verify
  rather than assume.

Components are not unit tested in this repo, so the four cards ride on typecheck plus a
signed-in manual pass. That pass must cover, at minimum: each of the five pages on a cold load;
the two "no tenant selected" states as an admin on "All tenants"; light mode on at least one of
the five, since no test can see a skeleton that is invisible against its surface; and reduced
motion stopping the pulse.

## Risks

- **The union can break a page nobody is looking at.** This is the only change here with
  reach beyond its own file. Typecheck is exhaustive for it, which is precisely why the union
  was chosen over a predicate.
- **Five routes join the allowlist in one merge.** Each needs its four-step checklist verified
  individually. The failure mode is not subtle (a page showing its empty state as fact while
  querying) but it is per-page, so five pages means five checks, not one.
- **The context value is not memoized.** `TenantProvider.tsx:172` builds a fresh object and a
  fresh `filterByTenant` closure on every provider render. `/subcontractors` puts the whole
  `tenant` object in a `useCallback` dependency array (`:236`) and its effect depends on that
  callback (`:240`). This is safe today only because `useContext` hands out a new object when
  the provider re-renders rather than when the page does. It is one `useMemo` away from a fetch
  loop, and one careless dependency away from one. Recorded as a follow-up, deliberately not
  fixed here: changing provider re-render behaviour app-wide does not belong in a skeletons
  batch, and it wants its own signed-in pass.
- **Placeholder counts are guesses.** Six, four, four and three cards regardless of what
  arrives. Same ceiling recorded in batch 1, unchanged and unfixable without knowing the data
  in advance.

## Files

New:

- `app/subcontractors/types.ts`, `app/subcontractors/SubcontractorCard.tsx`
- `app/vehicles/types.ts`, `app/vehicles/VehicleCard.tsx`
- `app/settings/users/UserCard.tsx`
- `app/settings/licences/LicenceCard.tsx`

Changed:

- `lib/tenant/context.ts` (the union moves in), `app/components/TenantProvider.tsx`
- `lib/nav/skeletonReadyRoutes.ts` (five paths), `lib/nav/skeletonReadyRoutes.test.ts`
- `lib/tenant/context.test.ts`
- `app/subcontractors/page.tsx`, `app/vehicles/page.tsx`, `app/settings/users/page.tsx`,
  `app/settings/licences/page.tsx`, `app/settings/portal-invites/page.tsx`
- Guard line only, no skeletons: `app/jobs/page.tsx`, `app/planning/page.tsx`,
  `app/tracking/page.tsx`

## What is left after this

Twelve routes, in the corrected grouping:

1. Gated, recipe applies: `/jobs`, `/pod`, `/invoices`. `/jobs` still needs a loading flag
   invented, which necessarily fixes its "No jobs match the current filters." false empty state.
2. Gated, bespoke layouts: `/tracking`, `/planning`, `/stats`.
3. Not gated, need `TenantGate` added first: `/drivers`, `/maintenance`, `/assets`,
   `/settings/company`, `/settings/documents`, `/tachograph`, `/telematics`.

Then the teardown described in the header of `lib/nav/skeletonReadyRoutes.ts`, which is one
commit deleting that file, `TenantGate`'s loading panel, and unwinding both consumers.

The seven legacy inline-styled pages remain out of the project entirely, as batch 1 recorded:
they cannot consume `ds` tokens and want converting to the design system first.
