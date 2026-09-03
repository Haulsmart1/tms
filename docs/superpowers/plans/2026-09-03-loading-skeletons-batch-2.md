# Loading Skeletons Batch 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert five gated routes (`/subcontractors`, `/vehicles`, `/settings/users`, `/settings/licences`, `/settings/portal-invites`) to loading skeletons, and make `TenantContextValue` a discriminated union so querying before the tenant resolves stops compiling.

**Architecture:** Every page follows the batch 1 `CustomerCard` recipe: row types move to a `types.ts`, the card becomes a component taking a `loading` prop, the page renders N placeholder cards while loading, and only data-bearing leaves become skeletons. Structure, labels and fixed-size buttons render for real, buttons merely `disabled`. Separately, `TenantContextValue` splits into a `ready` variant carrying `filterByTenant` and an `unresolved` variant without it, which turns batch 1's early-return convention into a compile error.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind (Preflight off, `ds` scoped reset), Supabase, vitest (covers `lib/**` only).

**Spec:** `docs/superpowers/specs/2026-09-03-loading-skeletons-batch-2-design.md`. Read it and its batch 1 predecessor before starting.

---

## Before you start

Read these three files. They are the whole context you need and none of them is long:

- `components/Skeleton.tsx` — the primitive. Note the `display="inline-block"` comment; it is load-bearing, not cosmetic.
- `app/customers/CustomerCard.tsx` — the archetype. Every card in this plan is this shape.
- `lib/nav/skeletonReadyRoutes.ts` — the four-step checklist a route must pass before it goes on the allowlist. Tasks below satisfy steps 1 to 3 before step 4.

Two rules carried from batch 1 that apply in every task:

1. `Skeleton` needs `display="inline-block"` anywhere it stands in for text. A block skeleton collapses the parent's line box and the card visibly shrinks while loading.
2. Never render a skeleton over content already on screen. `lib/loading/skeletonVisibility.ts` encodes this; use it rather than a raw `loading` boolean.

Establish the baseline before touching anything:

```bash
npm run typecheck && npm test
```

Expected: typecheck clean, all tests pass. Record the test count. If either fails on a clean checkout, stop and report it rather than building on a broken baseline.

---

## File Structure

**New files:**

| File | Responsibility |
| --- | --- |
| `app/subcontractors/types.ts` | `Subcontractor`, `Employee`, `SubcontractorVehicle`, `ComplianceLevel`, `ComplianceResult` |
| `app/subcontractors/compliance.tsx` | `getCompliance`, `mostUrgent`, `subcontractorCardStyle`, `StatusBadge`, `Info`, shared by the page and the card |
| `app/subcontractors/SubcontractorCard.tsx` | One subcontractor card, both states |
| `app/vehicles/types.ts` | `Vehicle`, `FleetInsurancePolicy`, `ComplianceLevel`, `ComplianceResult` |
| `app/vehicles/compliance.tsx` | `getCompliance`, `getVehicleCardCompliance`, `vehicleCardStyle`, `StatusBadge`, `ComplianceItem` |
| `app/vehicles/VehicleCard.tsx` | One vehicle card, both states |
| `app/settings/users/UserCard.tsx` | One tenant-user card, both states |
| `app/settings/licences/LicenceCard.tsx` | One licence card, both states |

The `compliance.tsx` files are not in the spec's file list. They are required rather than optional: `getCompliance`, `StatusBadge` and friends are each used three to nine times in their page *outside* the card, so they cannot move into the card file (the page would import the card and the card would import the page). A third module both sides import is the only arrangement without a cycle.

**Modified files:**

| File | Change |
| --- | --- |
| `lib/tenant/context.ts` | `TenantContextValue` moves in and splits into two variants |
| `lib/tenant/context.test.ts` | `@ts-expect-error` cases pinning the union |
| `app/components/TenantProvider.tsx` | Imports the type, builds the value per variant |
| `app/jobs/page.tsx`, `app/planning/page.tsx`, `app/tracking/page.tsx` | One guard line inside the loader |
| The five batch pages | Skeletons, extraction, allowlist entry |
| `lib/nav/skeletonReadyRoutes.ts` + test | Five new paths |

---

## Task 1: The discriminated union

**Files:**
- Modify: `lib/tenant/context.ts` (append after line 3)
- Modify: `app/components/TenantProvider.tsx:18-27` and `:172-181`
- Test: `lib/tenant/context.test.ts`

This task deliberately ends with typecheck FAILING. Task 2 fixes it. Do not commit a broken typecheck; tasks 1 and 2 share one commit at the end of Task 2.

- [ ] **Step 1: Write the failing test**

Append to `lib/tenant/context.test.ts`. Add `ReadyTenantContext` and `UnresolvedTenantContext` to the existing import block at the top of the file.

```ts
/* These assertions are enforced by `npm run typecheck`, NOT by vitest, which
   strips types without checking them. The @ts-expect-error lines are the real
   test: if filterByTenant ever reappears on the unresolved variant, the
   directive becomes unused and tsc fails with "Unused '@ts-expect-error'".
   The runtime expects below only stop vitest reporting an empty test. */
describe("TenantContextValue as a discriminated union", () => {
  const base = {
    role: "admin" as const,
    userEmail: "a@b.co",
    tenants: [T("t1", "Depot A")],
    activeTenantId: "t1",
    setActiveTenantId: () => {},
    writeTenantId: "t1",
  };

  it("exposes filterByTenant on the ready variant", () => {
    const ready: ReadyTenantContext = {
      ...base,
      status: "ready",
      filterByTenant: (query) => query,
    };
    expect(typeof ready.filterByTenant).toBe("function");
  });

  it("does not expose filterByTenant while the tenant is unresolved", () => {
    const unresolved: UnresolvedTenantContext = { ...base, status: "loading" };
    // @ts-expect-error filterByTenant is the whole point of the union: an
    // unresolved tenant must not be able to build a query at all.
    void unresolved.filterByTenant;
    expect(unresolved.status).toBe("loading");
  });

  it("keeps writeTenantId on both variants, since it is already null while loading", () => {
    const unresolved: UnresolvedTenantContext = { ...base, status: "loading" };
    expect(unresolved.writeTenantId).toBe("t1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/tenant/context.test.ts`
Expected: FAIL. vitest cannot resolve the `ReadyTenantContext` / `UnresolvedTenantContext` imports, so the file errors before any test runs.

- [ ] **Step 3: Add the union to `lib/tenant/context.ts`**

Insert directly after line 3 (`export type TenantOption = ...`), before the `TenantContextData` comment block:

```ts
/* THE TENANT CONTEXT VALUE, and why it is a union.

   filterByTenant fails SILENTLY when the tenant has not resolved: applyTenantFilter
   returns the query unmodified (./filter.ts), so the read succeeds and comes back
   scoped to nothing. Nothing throws, nothing is null, and no test sees it. That is
   how /dashboard shipped issuing unscoped queries on every cold load.

   Splitting on status makes it a compile error instead. A page must narrow to the
   ready variant before it can build a query:

     if (tenant.status !== "ready") return;   // inside the function that queries
     tenant.filterByTenant(...)               // only compiles after that line

   Put the guard INSIDE the function that calls filterByTenant, not merely in the
   effect that calls that function. TypeScript does not carry a narrowing across a
   function boundary, so a guard in the effect leaves the loader body unnarrowed.

   writeTenantId deliberately stays on the base, available on both variants. It is
   already fail-safe by value (computeWriteTenantId returns null while loading, and
   every call site null-checks before writing), so gating it would compile-enforce a
   check the code already performs, at a cost of ~45 edits across three large files. */
type TenantContextBase = {
  status: TenantStatus;
  role: TenantRole;
  userEmail: string | null;
  tenants: TenantOption[];
  activeTenantId: string | null;
  setActiveTenantId: (id: string | null) => void;
  writeTenantId: string | null;
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/tenant/context.test.ts`
Expected: PASS, all cases including the three new ones.

- [ ] **Step 5: Point `TenantProvider` at the shared type**

In `app/components/TenantProvider.tsx`, delete the local `TenantContextValue` declaration at lines 18-27 entirely, and add `type TenantContextValue` to the existing import from `../../lib/tenant/context` (the block at lines 8-11, which already imports `TenantContextData`, `TenantOption`, `TenantRole`, `TenantStatus`).

- [ ] **Step 6: Build the value per variant**

Replace the `const value: TenantContextValue = { ... };` block at lines 172-181 with:

```tsx
  /* Built as two branches rather than one object with an optional field: an
     optional filterByTenant would type-check at every call site and defeat the
     union. The `data.status === "ready"` test is what narrows the result. */
  const base = {
    role: data.role,
    userEmail,
    tenants: data.tenants,
    activeTenantId,
    setActiveTenantId,
    writeTenantId,
  };

  const value: TenantContextValue =
    data.status === "ready"
      ? {
          ...base,
          status: "ready",
          filterByTenant: (query) => applyTenantFilter(query, activeTenantId),
        }
      : { ...base, status: data.status };
```

- [ ] **Step 7: Run typecheck and confirm it fails on exactly three files**

Run: `npm run typecheck`
Expected: FAIL, with errors in exactly these seven files: `app/dashboard/page.tsx`, `app/jobs/page.tsx`, `app/planning/page.tsx`, `app/subcontractors/page.tsx`, `app/settings/licences/page.tsx`, `app/tracking/page.tsx`, `app/vehicles/page.tsx`.

**If an eighth file appears, stop and report it.** Do not silently fix the extra file.

The error shapes are not uniform. Most are `TS2339 Property 'filterByTenant' does not exist`, but `/planning:469` and `/tracking:255` pass `tenant` whole into a helper typed `TenantFilter` and fail as `TS2345`; a guard before the call narrows those too. `/dashboard` also emits cascading `TS7006` implicit-any errors that clear once its guard lands.

---

## Task 2: Guard the seven pages the union breaks

CORRECTED 2026-09-03, after Task 1 was first compiled. This task originally named three pages.
The real figure is seven. Two reasons, both recorded in the spec:

- `/subcontractors`, `/vehicles` and `/settings/licences` were excluded because Tasks 3, 4 and 6
  guard them anyway. True, but the union lands here and typecheck is all-or-nothing, so their
  loader guards move forward into this task. Tasks 3, 4 and 6 then skip their guard step.
- `/dashboard` was excluded because batch 1 recorded it as fixed. Its guard is real but sits in
  the effect, while its queries sit in a nested `async function load()`, so the narrowing never
  reached them. The page batch 1 held up as the good example was still querying unscoped. This
  is the best evidence available that the union earns its place.

**Files:**
- Modify: `app/jobs/page.tsx:88`
- Modify: `app/planning/page.tsx:190`
- Modify: `app/tracking/page.tsx:164`
- Modify: `app/dashboard/page.tsx` (inside `async function load()`, around line 67)
- Modify: `app/subcontractors/page.tsx` (loader at 190, plus three save handlers)
- Modify: `app/vehicles/page.tsx` (loader at 107, plus one save handler)
- Modify: `app/settings/licences/page.tsx` (loader at 67)

None of these seven pages gets anything else. They gain no skeletons and they do **not** go on the allowlist; `TenantGate` keeps blocking on them and they keep their existing loading text. Adding them to the allowlist here would produce exactly the failure the allowlist's rule 3 warns about.

The guard is a bug fix, not insurance. `TenantGate` sits inside each page's JSX rather than wrapping the component, so it has never stopped these effects from firing. All three query with an unresolved tenant today.

- [ ] **Step 1: Guard `/jobs`**

In `app/jobs/page.tsx`, `loadData` begins at line 88 with `setMessage("");`. Insert above that line:

```ts
    /* Inside loadData, not in the effect below: TypeScript does not carry a
       narrowing across a function boundary, so a guard at the call site leaves
       this body unnarrowed and filterByTenant still will not compile. */
    if (tenant.status !== "ready") return;
```

Then change the effect at line 123 from:

```tsx
  useEffect(() => { loadData(); }, [tenant.activeTenantId]);
```

to:

```tsx
  useEffect(() => { loadData(); }, [tenant.status, tenant.activeTenantId]);
```

- [ ] **Step 2: Guard `/planning`**

`app/planning/page.tsx` already has `if (tenant.status !== "ready") return;` in the effect at line 442, and that effect already lists `tenant.status` in its deps. It is not enough on its own, because `loadData` is a separate function. Add the guard inside `loadData`, which begins at line 190 with `setLoading(true);`. Insert above that line:

```ts
    /* The effect below already checks this before calling. Repeated here
       because a narrowing does not cross a function boundary, so without it
       filterByTenant is unavailable in this body. */
    if (tenant.status !== "ready") return;
```

Leave the effect and its dependency array alone.

- [ ] **Step 3: Guard `/tracking`**

In `app/tracking/page.tsx`, the nested `async function load(showSkeleton: boolean)` begins at line 164 with `if (inFlight) return;`. Insert above that line:

```ts
      if (tenant.status !== "ready") return;
```

Then change the effect's dependency array at line 297 from:

```tsx
  }, [tenant.activeTenantId, reloadToken]);
```

to:

```tsx
  }, [tenant.status, tenant.activeTenantId, reloadToken]);
```

Place the guard BEFORE `if (inFlight) return;`, so an unresolved tenant never marks a load in
flight.

- [ ] **Step 3a: Guard `/dashboard`**

The guard at line 63 stays where it is: it also stops a token refresh flashing a skeleton over a
populated page, which is a separate job and its comment says so. Add a second one as the first
statement inside `async function load()` (around line 67, above `setState("loading")`):

```ts
      /* The effect above already returned for this case. Repeated here because
         a narrowing does not cross a function boundary: batch 1's guard sat in
         the effect while these queries sit in here, so it never reached them
         and this page kept querying unscoped. */
      if (tenant.status !== "ready") return;
```

Expect roughly seven `TS7006` implicit-any errors on this page to disappear on their own once
this lands. They were cascade: with `filterByTenant` unresolved, the query results degraded to
`any` in the `.map`/`.reduce` callbacks. If any survive, report them rather than annotating them.

- [ ] **Step 3b: Guard the three loaders inside this batch**

These are lifted forward from Tasks 3, 4 and 6, unchanged. Add to each loader, as its first
statement, before any `setLoading(true)`:

```ts
    if (tenant.status !== "ready") return;
```

- `app/subcontractors/page.tsx`, in `loadData` (line 190, above `setLoading(true)`). Also add
  `tenant.status` to the effect's dependency array at line 240:
  `}, [loadData, tenant.status, tenant.activeTenantId]);`
- `app/vehicles/page.tsx`, in `loadVehicles` (line 107, above `setLoading(true)`). Also change
  the effect deps at line 153 from `[tenant.activeTenantId]` to
  `[tenant.status, tenant.activeTenantId]`.
- `app/settings/licences/page.tsx`, in `loadData` (line 67, above `setLoading(true)`). Also
  change the effect deps at line 132 from `[tenant.activeTenantId]` to
  `[tenant.status, tenant.activeTenantId]`. **This file is indented with four spaces**; match it.

- [ ] **Step 3c: Guard the four save handlers**

Four `filterByTenant` calls sit in user-initiated save handlers rather than loaders:
`app/subcontractors/page.tsx` around lines 431, 497 and 565, and `app/vehicles/page.tsx` around
line 297. A bare `return` there would silently swallow a user's save, which is worse than the bug
being fixed.

Use the shape these same files already use for the same class of precondition, in some cases
three lines away:

```ts
    if (tenant.status !== "ready") {
      setMessage("Still loading. Try again in a moment.");
      return;
    }
```

Place it at the **top of the handler function**, next to the existing
`if (!tenant.writeTenantId) { setMessage(...); return; }` check where there is one, and always
**before** any `setSaving(true)` / `setEmployeeSaving(true)` / `setVehicleSaving(true)`, so no
save flag is left stuck on.

Do not put it at the `filterByTenant` call site: these handlers do work before that point, and a
guard halfway down reads as an afterthought rather than a precondition.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: typecheck clean, and `npm test` reporting 590 tests in 52 files (baseline 587 plus the three new cases from Task 1).

- [ ] **Step 5: Commit**

```bash
git add lib/tenant/context.ts lib/tenant/context.test.ts app/components/TenantProvider.tsx app/jobs/page.tsx app/planning/page.tsx app/tracking/page.tsx app/dashboard/page.tsx app/subcontractors/page.tsx app/vehicles/page.tsx app/settings/licences/page.tsx
git commit -m "feat(tenant): gate filterByTenant behind a ready-status union

Querying before the tenant resolves now fails to compile instead of
silently returning an unscoped query. Fixes the seven pages that were
doing exactly that, /dashboard included: batch 1 guarded its effect but
its queries live in a nested load(), so the narrowing never reached
them and the page it recorded as fixed was still querying unscoped.

writeTenantId stays on both variants: it is already null while loading
and every call site checks it, so gating it would enforce a test the
code already performs across ~45 sites.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BL5k8UCJHsvLKiXWQDfRJ"
```

---

## Task 3: `/subcontractors`

**Files:**
- Create: `app/subcontractors/types.ts`, `app/subcontractors/compliance.tsx`, `app/subcontractors/SubcontractorCard.tsx`
- Modify: `app/subcontractors/page.tsx`
- Modify: `lib/nav/skeletonReadyRoutes.ts`, `lib/nav/skeletonReadyRoutes.test.ts`

- [ ] **Step 1: Extract the types**

Create `app/subcontractors/types.ts` by **moving** (cut, not copy) the `Subcontractor`, `Employee`, `SubcontractorVehicle`, `ComplianceLevel` (line 86) and `ComplianceResult` (line 88) type declarations out of `page.tsx`, adding `export` to each. Then import them back into `page.tsx`.

Do not retype them from memory. Move the exact declarations so the fields cannot drift.

- [ ] **Step 2: Extract the shared helpers**

Create `app/subcontractors/compliance.tsx` by **moving** `getCompliance`, `mostUrgent`, `subcontractorCardStyle`, `StatusBadge` and `Info` out of `page.tsx` (they sit around lines 1530-1640), adding `export` to each, and importing what they need (`Badge` from `../../components/Badge`, the types from `./types`). Import them back into `page.tsx`.

`Info`'s `value` prop widens from `string | null | undefined` to `ReactNode` and it gains a `loading` prop, matching `CustomerCard`'s local `Info`:

```tsx
export function Info({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="text-sm">
      <span className="text-kicker uppercase text-ink-2">{label}</span>{" "}
      <strong className="block text-ink">
        {/* inline-block keeps this block-level <strong>'s line box at its
            text height. A block skeleton shrinks each cell by 4px, and with
            two rows of cells the card jumps while loading. */}
        {loading ? <Skeleton display="inline-block" w="80%" h="0.875rem" /> : value || "—"}
      </strong>
    </div>
  );
}
```

- [ ] **Step 3: Write the card**

Create `app/subcontractors/SubcontractorCard.tsx`:

```tsx
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import { Info, StatusBadge, subcontractorCardStyle } from "./compliance";
import type { ComplianceResult, Subcontractor } from "./types";

type Props = {
  subcontractor: Subcontractor;
  /** Null while loading, since it is derived from data that has not arrived. */
  compliance: ComplianceResult | null;
  loading?: boolean;
  onEdit: (subcontractor: Subcontractor) => void;
  onManage: (id: string) => void;
};

/* ONE layout definition for both states, per the batch 1 decision. A separate
   skeleton component mirroring these class names drifts the first time anyone
   edits the real card, and no test in this repo would catch it.

   Only data-bearing leaves become skeletons. Labels, structure and the two
   buttons render for real. */
export default function SubcontractorCard({
  subcontractor,
  compliance,
  loading = false,
  onEdit,
  onManage,
}: Props) {
  return (
    <article
      /* While loading there is no compliance level, so the card takes the
         calm "ok" border rather than flashing a red or amber alarm border
         that the data may not justify. */
      className={subcontractorCardStyle(compliance?.level ?? "ok")}
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-md font-semibold text-ink">
            {loading ? <Skeleton display="inline-block" w="11ch" h="1rem" /> : subcontractor.name}
          </h3>
          <span className="text-sm text-ink-2">
            {loading ? (
              <Skeleton display="inline-block" w="8ch" h="0.75rem" />
            ) : subcontractor.subcontractor_type === "owner_driver" ? (
              "Owner Driver"
            ) : (
              "Fleet Subcontractor"
            )}
          </span>
        </div>

        {loading || !compliance ? (
          <Skeleton w="4.5rem" h="1.375rem" pill />
        ) : (
          <StatusBadge result={compliance} />
        )}
      </div>

      <div className="my-2 grid grid-cols-2 gap-2">
        <Info
          label="Contact"
          loading={loading}
          value={subcontractor.contact_name || subcontractor.email}
        />
        <Info label="Phone" loading={loading} value={subcontractor.phone} />
        <Info
          label="Operator Licence"
          loading={loading}
          value={subcontractor.operator_licence_number}
        />
        <Info
          label="Terms"
          loading={loading}
          value={`${subcontractor.payment_terms_days ?? 30} days`}
        />
      </div>

      {/* Real buttons, disabled. Fixed size and no data, so this is both more
          faithful than a grey rectangle and more honest about being inert. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={loading}
          onClick={() => onEdit(subcontractor)}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={loading}
          onClick={() => onManage(subcontractor.id)}
        >
          Manage
        </Button>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Add the placeholder row shape**

Add near the top of `app/subcontractors/page.tsx`, after the imports:

```ts
/* Six, because the grid is md:grid-cols-2 xl:grid-cols-3, so six fills whole
   rows at every breakpoint instead of leaving a ragged last row. The count is
   a guess about data that has not arrived; the grid will reflow on arrival.
   Recorded in the spec rather than papered over. */
const SKELETON_CARDS = 6;

const PLACEHOLDER_SUBCONTRACTOR = {
  id: "",
  name: "",
  subcontractor_type: "fleet",
  contact_name: null,
  email: null,
  phone: null,
  operator_licence_number: null,
  payment_terms_days: null,
} as unknown as Subcontractor;
```

- [ ] **Step 5: Confirm the guard is already in place**

Task 2 added this page's loader guard and effect dependency, along with three save-handler
guards. Nothing to do here. Confirm with:

```bash
grep -n "tenant.status" app/subcontractors/page.tsx
```

Expected: four guards (one in `loadData`, three in save handlers) plus `tenant.status` in the
effect's dependency array. If any is missing, stop and report rather than adding it yourself:
Task 2 is committed, and a gap there means its verification passed when it should not have.

- [ ] **Step 6: Render the skeletons**

Replace the three-way branch at `page.tsx:946-955` (`{loading ? <p>Loading subcontractors...</p> : subcontractors.length === 0 ? <p>No subcontractors found.</p> : <div className="grid...">`) with:

```tsx
            {showSkeleton ? null : subcontractors.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-3">
                No subcontractors found.
              </p>
            ) : null}

            {showSkeleton || subcontractors.length > 0 ? (
              <div
                className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
                aria-busy={showSkeleton}
              >
                {/* One announcement for the region, not one per bar. Replaces
                    what the old "Loading subcontractors..." text gave free. */}
                {showSkeleton ? (
                  <span className="sr-only" role="status">Loading subcontractors</span>
                ) : null}

                {showSkeleton
                  ? Array.from({ length: SKELETON_CARDS }, (_, index) => (
                      <SubcontractorCard
                        key={`skeleton-${index}`}
                        subcontractor={PLACEHOLDER_SUBCONTRACTOR}
                        compliance={null}
                        loading
                        onEdit={() => {}}
                        onManage={() => {}}
                      />
                    ))
                  : subcontractors.map((subcontractor) => (
                      <SubcontractorCard
                        key={subcontractor.id}
                        subcontractor={subcontractor}
                        compliance={mostUrgent([
                          getCompliance(subcontractor.goods_in_transit_expiry),
                          getCompliance(subcontractor.public_liability_expiry),
                          getCompliance(subcontractor.employers_liability_expiry),
                          getCompliance(subcontractor.motor_insurance_expiry),
                          getCompliance(subcontractor.waste_carrier_expiry),
                        ])}
                        onEdit={startEdit}
                        onManage={setSelectedSubcontractorId}
                      />
                    ))}
              </div>
            ) : null}
```

The old inline Edit handler did two things (`page.tsx:1004-1009`): `setSelectedSubcontractorId(subcontractor.id)` then `startEdit(subcontractor)`. Preserve both by passing a wrapper rather than `startEdit` alone:

```tsx
                        onEdit={(item) => {
                          setSelectedSubcontractorId(item.id);
                          startEdit(item);
                        }}
```

Derive `showSkeleton` next to the other hooks:

```ts
  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: subcontractors.length > 0,
  });
```

importing `shouldShowSkeleton` from `../../lib/loading/skeletonVisibility`. The `hasData` short circuit is what stops a routine token refresh replacing a populated page with a skeleton.

The employee/vehicle detail panel below needs no loading state: it renders only when a subcontractor is selected, and nothing is selected while loading.

- [ ] **Step 7: Add the route to the allowlist**

In `lib/nav/skeletonReadyRoutes.ts`, add to the array:

```ts
  "/subcontractors",          // app/subcontractors/page.tsx
```

In `lib/nav/skeletonReadyRoutes.test.ts`, add `"/subcontractors"` to the expected array in the "lists exactly the routes converted so far" case.

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add app/subcontractors lib/nav/skeletonReadyRoutes.ts lib/nav/skeletonReadyRoutes.test.ts
git commit -m "feat(subcontractors): loading skeletons, card extracted

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BL5k8UCJHsvLKiXWQDfRJ"
```

---

## Task 4a: share the compliance helpers, and test them

ADDED 2026-09-03, from the Task 3 code review. Not in the original plan.

Task 3 extracted `getCompliance`, `mostUrgent`, `ComplianceLevel` and `ComplianceResult` into
`app/subcontractors/compliance.tsx`. `/vehicles` holds a duplicate of all four, and Task 4b would
otherwise extract a second copy. The review verified the two implementations are equivalent:
same thresholds (0, 7, 30), same labels, same shapes, differing only in `startOfToday()` versus
an inlined `new Date()` with `setHours(0,0,0,0)`, which produce the same value.

**The reason to move them is not DRY.** It is that `vitest.config.ts` covers `lib/**` only, so
nothing under `app/` can have a unit test. This is date-boundary arithmetic with no test anywhere
in the repo. Moving it to `lib/` is what makes a test possible, and the test is the point.

`vitest.config.ts` pins `TZ=Europe/London` deliberately, and `CLAUDE.md` warns not to "fix" a
timezone-sensitive failure by changing it. This code is exactly that class, so the test must
exercise the day boundary rather than only the middle of a day.

What must NOT move: `subcontractorCardStyle` and `vehicleCardStyle` genuinely differ
(`p-3`/`bg-surface-2` versus `p-4`/`bg-surface shadow-sm`), and each page's `StatusBadge` differs
(vehicles' carries a vestigial `small` prop). Those stay per-page.

**Files:**
- Create: `lib/compliance/expiry.ts`, `lib/compliance/expiry.test.ts`
- Create: `components/InfoField.tsx`
- Modify: `app/subcontractors/compliance.tsx`, `app/subcontractors/SubcontractorCard.tsx`,
  `app/subcontractors/types.ts`, `app/subcontractors/page.tsx`

- [ ] **Step 1: Move the four to `lib/compliance/expiry.ts`**

Move `ComplianceLevel`, `ComplianceResult`, `getCompliance` and `mostUrgent` out of
`app/subcontractors/compliance.tsx` and `app/subcontractors/types.ts` into a new
`lib/compliance/expiry.ts`. Move them verbatim; do not retype. Keep the `mostUrgent` empty-list
throw that Task 3 added.

The file is pure logic with no JSX, so it is `.ts` not `.tsx`.

- [ ] **Step 2: Write the test that could not exist before**

Create `lib/compliance/expiry.test.ts`. This is the whole justification for the move, so it must
actually exercise the boundaries rather than smoke-test the happy path. Cover, with `vi.setSystemTime`
so the cases are deterministic:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCompliance, mostUrgent } from "./expiry";

/* Frozen so "today" cannot drift under the test. Europe/London is pinned in
   vitest.config.ts on purpose (see CLAUDE.md): these are day-boundary
   comparisons, and a UTC runner would let an off-by-one pass unnoticed. */
beforeEach(() => vi.setSystemTime(new Date("2026-09-03T12:00:00")));
afterEach(() => vi.useRealTimers());
```

Required cases, each asserting the `level` and that the `label` is not misleading:

- A null expiry. Document what it returns; Task 3 established it is `amber`, and the card relies
  on that being true, so pin it.
- Expiry in the past (expired).
- Expiry exactly today. State in a comment which side of the boundary this falls and why that is
  the intended reading for a licence or an insurance policy.
- Expiry tomorrow, at 7 days, at 8 days, at 30 days, at 31 days. The 7 and 30 cases are the
  threshold edges: assert both the boundary day and the day either side, since an off-by-one here
  is exactly the bug a test like this exists to catch.
- `mostUrgent` returning the worst of a mixed list, in both argument orders, so the result does
  not depend on ordering.
- `mostUrgent` throwing on an empty list.

If any assertion surprises you (a boundary that is not where you expected), do NOT change the
implementation to match the test. Report it: this code ships today and a boundary change is a
behaviour change, not a fix.

- [ ] **Step 3: Promote `Info` to `components/InfoField.tsx`**

The Task 3 review flagged `Info` as a passenger in `compliance.tsx`: four exports are one topic
and `Info` is a generic label/value cell that landed there only because it also needed to escape
`page.tsx`. It is also a near-copy of the private `Info` inside `app/customers/CustomerCard.tsx`.

Move it to `components/InfoField.tsx`, exported as `InfoField`, keeping its `loading` prop and
the `display="inline-block"` comment verbatim (that comment records real pixel arithmetic).

Do NOT touch `app/customers/CustomerCard.tsx`. Collapsing its private copy is a change to a
shipped, signed-off page for no functional gain, and it belongs in whatever batch next has that
file open. Leave a one-line note in `InfoField.tsx` saying a third near-copy lives there.

- [ ] **Step 4: Update the importers and delete what is now empty**

Point `app/subcontractors/compliance.tsx`, `SubcontractorCard.tsx`, `types.ts` and `page.tsx` at
the new homes. If `compliance.tsx` is left holding only `StatusBadge` and `subcontractorCardStyle`,
that is fine and correct; update its header comment so it describes what it actually contains now,
and drop the "Info is a passenger" note, which will no longer be true.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test`

Expected: typecheck clean. Test count RISES from 590 by however many cases you wrote in Step 2;
report the new number. This is the one task in the batch that should change the count.

- [ ] **Step 6: Commit**

```bash
git add lib/compliance components/InfoField.tsx app/subcontractors
git commit -m "refactor(compliance): move expiry logic to lib/ and test it

The two copies of getCompliance/mostUrgent (subcontractors and vehicles)
were equivalent, but the reason to move them is not DRY: vitest covers
lib/ only, so nothing under app/ can be tested. This is date-boundary
arithmetic that shipped with no test anywhere in the repo, and the day
0/7/30 edges now have one.

Info moves to components/InfoField, having been a passenger in a module
about compliance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BL5k8UCJHsvLKiXWQDfRJ"
```

---

## Task 4b: `/vehicles`

**Files:**
- Create: `app/vehicles/types.ts`, `app/vehicles/compliance.tsx`, `app/vehicles/VehicleCard.tsx`
- Modify: `app/vehicles/page.tsx`
- Modify: `lib/nav/skeletonReadyRoutes.ts`, `lib/nav/skeletonReadyRoutes.test.ts`

This page has a real bug to fix on the way past. At line 944 the loading notice renders *above* an unconditional grid, so during load the page shows a loading card AND an empty grid together. The placeholders replace both.

- [ ] **Step 1: Extract types and helpers**

Task 4a already moved `ComplianceLevel`, `ComplianceResult`, `getCompliance` and `mostUrgent` to
`lib/compliance/expiry.ts`. **Do not create a second copy of any of them.** `/vehicles` currently
holds its own duplicates (around lines 46, 48, 1155-1198, plus a `startOfToday()` helper); DELETE
those and import from `lib/compliance/expiry` instead.

Confirm before deleting that the vehicles implementation really is equivalent to the shared one.
The Task 3 review found they match on thresholds (0, 7, 30), labels and shapes, differing only in
`startOfToday()` versus an inlined `new Date()` with `setHours(0,0,0,0)`. Verify that yourself; if
they differ in any way that changes a result, STOP and report rather than deleting.

Then create `app/vehicles/types.ts` by moving `Vehicle` and `FleetInsurancePolicy` out of
`page.tsx` with `export` added, and `app/vehicles/compliance.tsx` by moving `getVehicleCardCompliance`,
`vehicleCardStyle`, `StatusBadge` and `ComplianceItem` out, with `export` added. These four are
genuinely vehicle-specific and must NOT be shared: `vehicleCardStyle` differs from the
subcontractors one (`p-4`/`bg-surface shadow-sm` versus `p-3`/`bg-surface-2`), and this
`StatusBadge` carries a vestigial `small` prop. Import both back into `page.tsx`.

Use `InfoField` from `components/InfoField.tsx` (Task 4a) anywhere this page wants a label/value
cell, rather than writing a third copy.

`ComplianceItem` gains a `loading` prop and its value becomes a skeleton, the same widening `Info` took:

`result` becomes nullable, since it is derived from data that has not arrived:

```tsx
export function ComplianceItem({
  label,
  expiry,
  result,
  extra,
  loading,
}: {
  label: string;
  expiry: string | null;
  result: ComplianceResult | null;
  extra?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-2.5">
      {/* The label is static, so it renders for real. */}
      <span className="block text-kicker uppercase text-ink-3">{label}</span>

      <div className="font-mono text-sm font-semibold text-ink">
        {loading ? (
          <Skeleton display="inline-block" w="9ch" h="0.875rem" />
        ) : expiry ? (
          formatDate(expiry)
        ) : (
          "Not set"
        )}
      </div>

      {loading ? (
        <div className="text-xs text-ink-3">
          <Skeleton display="inline-block" w="70%" h="0.75rem" />
        </div>
      ) : extra ? (
        <div className="text-xs text-ink-3">{extra}</div>
      ) : null}

      <div className="mt-2">
        {loading || !result ? (
          <Skeleton w="3.5rem" h="1.25rem" pill />
        ) : (
          <StatusBadge result={result} small />
        )}
      </div>
    </div>
  );
}
```

`formatDate` stays in `page.tsx` if it is used elsewhere there; move it into `compliance.tsx` and import it back if not. Check with `grep -c formatDate app/vehicles/page.tsx` before deciding.

**REVISED 2026-09-03, from the Task 3 code review.** This task originally passed five computed
values into the card (`cardCompliance`, `mot`, `tax`, `insurance`, `insuranceExpiry`). The Task 3
review showed why that is wrong: a computed-compliance prop sitting alongside `loading` creates
states that cannot both be true, and the card's own consumers then disagree about which signal to
believe. `SubcontractorCard` now derives its compliance internally, and this card must match.

All five derive from `(vehicle, policy)`. Only `policy` needs page state, because `getFleetPolicy`
closes over `fleetPolicies`. So move these two out of `page.tsx` into `compliance.tsx` as pure
functions taking the policy explicitly:

```ts
export function insuranceExpiryOf(
  vehicle: Vehicle,
  policy: FleetInsurancePolicy | null,
): string | null {
  if (vehicle.insurance_type === "fleet") return policy?.expiry_date ?? null;
  return vehicle.insurance_expiry;
}

export function vehicleCardCompliance(
  vehicle: Vehicle,
  policy: FleetInsurancePolicy | null,
): ComplianceResult {
  return mostUrgent([
    getCompliance(vehicle.mot_expiry),
    getCompliance(vehicle.tax_expiry),
    getCompliance(insuranceExpiryOf(vehicle, policy)),
  ]);
}
```

`page.tsx` keeps `getFleetPolicy`, which needs its state, and passes the result in.

**The derivation must sit behind the `loading` branch**, exactly as `SubcontractorCard` does and
for the same reason: every placeholder expiry is null, `getCompliance(null)` returns **amber**, so
deriving unconditionally would paint an amber alarm border and three amber badges on every
skeleton card. Guard it:

```tsx
  const cardCompliance = loading ? null : vehicleCardCompliance(vehicle, policy);
  const insuranceExpiry = loading ? null : insuranceExpiryOf(vehicle, policy);
  const mot = loading ? null : getCompliance(vehicle.mot_expiry);
  const tax = loading ? null : getCompliance(vehicle.tax_expiry);
  const insurance = loading ? null : getCompliance(insuranceExpiry);
```

Because `result` is nullable, there are no `mot!` / `tax!` / `insurance!` assertions to write.

- [ ] **Step 2: Write the card**

Create `app/vehicles/VehicleCard.tsx`. It takes the whole card body currently inlined at `page.tsx:946-1046`:

```tsx
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import { cn } from "../../lib/cn";
import { ComplianceItem, StatusBadge, vehicleCardStyle } from "./compliance";
import type { ComplianceResult, FleetInsurancePolicy, Vehicle } from "./types";

type Props = {
  vehicle: Vehicle;
  /** The only value that cannot be derived here: it needs the page's
   *  fleetPolicies state. Null when this vehicle is not on a fleet policy. */
  policy: FleetInsurancePolicy | null;
  isAdmin: boolean;
  loading?: boolean;
  onEdit: (vehicle: Vehicle) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
};

export default function VehicleCard({
  vehicle, policy, isAdmin, loading = false, onEdit, onDelete, onToggle,
}: Props) {
  // The five derivations from the REVISED block above go here, each behind
  // `loading`. They are not repeated; that block is the source of truth.
  return (
    <div
      className={cn(
        // "ok" while loading: no compliance data has arrived, so an alarm
        // border would be a claim the page cannot support yet.
        vehicleCardStyle(cardCompliance?.level ?? "ok"),
        !loading && !vehicle.active && "opacity-70",
      )}
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="m-0 font-mono text-md font-semibold text-ink">
            {loading ? <Skeleton display="inline-block" w="8ch" h="1rem" /> : vehicle.registration}
          </h3>
          <div className="text-sm text-ink-2">
            {loading ? (
              <Skeleton display="inline-block" w="14ch" h="0.75rem" />
            ) : (
              <>
                {vehicle.vehicle_type || "No type"} • {vehicle.make || "-"} {vehicle.model || ""}
              </>
            )}
          </div>
        </div>

        {loading || !cardCompliance ? (
          <Skeleton w="4.5rem" h="1.375rem" pill />
        ) : (
          <StatusBadge result={cardCompliance} />
        )}
      </div>

      <div className="my-3 grid gap-2 sm:grid-cols-3">
        <ComplianceItem label="MOT" expiry={vehicle.mot_expiry} result={mot} loading={loading} />
        <ComplianceItem label="Tax" expiry={vehicle.tax_expiry} result={tax} loading={loading} />
        <ComplianceItem
          label="Insurance"
          expiry={insuranceExpiry}
          result={insurance}
          loading={loading}
          extra={
            vehicle.insurance_type === "fleet"
              ? policy
                ? `Fleet • ${policy.provider}${policy.auto_renew ? " • Auto renew" : ""}`
                : "Fleet policy not selected"
              : vehicle.insurance_provider || "Individual policy"
          }
        />
      </div>

      <div className="text-sm text-ink-2">
        Status:{" "}
        {loading ? (
          <Skeleton display="inline-block" w="5ch" h="0.75rem" />
        ) : vehicle.active ? (
          "Active"
        ) : (
          "Inactive"
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {isAdmin ? (
          <>
            <Button variant="secondary" size="sm" type="button" disabled={loading} onClick={() => onEdit(vehicle)}>
              Edit
            </Button>
            <Button variant="danger" size="sm" type="button" disabled={loading} onClick={() => onDelete(vehicle.id)}>
              Delete
            </Button>
          </>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={loading}
          onClick={() => onToggle(vehicle.id, vehicle.active)}
        >
          {loading ? "Deactivate" : vehicle.active ? "Deactivate" : "Activate"}
        </Button>
      </div>
    </div>
  );
}
```

The last button's label is a real trade-off: its text depends on data. "Deactivate" is used as the loading label because it is the wider of the two, so the button does not grow on arrival. Note it in the commit.

- [ ] **Step 3: Derive the flag (the guard is already in place)**

Task 2 added this page's loader guard, its effect dependency and one save-handler guard. Confirm
with `grep -n "tenant.status" app/vehicles/page.tsx` (expect two guards plus the effect dep) and
stop and report if any is missing rather than adding it yourself.

Add next to the other hooks:

```ts
  const showSkeleton = shouldShowSkeleton({
    tenantStatus: tenant.status,
    fetching: loading,
    hasData: vehicles.length > 0,
  });
```

- [ ] **Step 4: Render the skeletons**

Add the placeholder constants after the imports:

```ts
/* Four, because these cards are full width in a single-column grid, so four
   is roughly one screen. A guess about data that has not arrived. */
const SKELETON_CARDS = 4;

const PLACEHOLDER_VEHICLE = {
  id: "",
  registration: "",
  vehicle_type: null,
  make: null,
  model: null,
  mot_expiry: null,
  tax_expiry: null,
  insurance_type: null,
  insurance_provider: null,
  active: true,
} as unknown as Vehicle;
```

Delete line 944 entirely (`{loading ? <Card className="mb-4">Loading vehicles...</Card> : null}`) and replace the grid at line 946 with:

```tsx
          <div className="grid gap-4" aria-busy={showSkeleton}>
            {showSkeleton ? (
              <span className="sr-only" role="status">Loading vehicles</span>
            ) : null}

            {showSkeleton
              ? Array.from({ length: SKELETON_CARDS }, (_, index) => (
                  <VehicleCard
                    key={`skeleton-${index}`}
                    vehicle={PLACEHOLDER_VEHICLE}
                    cardCompliance={null}
                    mot={null}
                    tax={null}
                    insurance={null}
                    insuranceExpiry={null}
                    policy={null}
                    isAdmin={isAdmin}
                    loading
                    onEdit={() => {}}
                    onDelete={() => {}}
                    onToggle={() => {}}
                  />
                ))
              : vehicles.map((vehicle) => (
                  <VehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    cardCompliance={getVehicleCardCompliance(vehicle)}
                    mot={getCompliance(vehicle.mot_expiry)}
                    tax={getCompliance(vehicle.tax_expiry)}
                    insurance={getCompliance(getInsuranceExpiry(vehicle))}
                    insuranceExpiry={getInsuranceExpiry(vehicle)}
                    policy={getFleetPolicy(vehicle)}
                    isAdmin={isAdmin}
                    onEdit={startEdit}
                    onDelete={(id) => void deleteVehicle(id)}
                    onToggle={(id, active) => void toggleVehicle(id, active)}
                  />
                ))}
          </div>
```

`getInsuranceExpiry` and `getFleetPolicy` stay in `page.tsx`: `getFleetPolicy` closes over `fleetPolicies` state, so it cannot move to a pure module.

- [ ] **Step 5: Add the route to the allowlist**

Add `"/vehicles",             // app/vehicles/page.tsx` to `SKELETON_READY_ROUTES` and `"/vehicles"` to the expected array in the test.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add app/vehicles lib/nav/skeletonReadyRoutes.ts lib/nav/skeletonReadyRoutes.test.ts
git commit -m "feat(vehicles): loading skeletons, card extracted

Also removes a double loading state: the old notice rendered above an
unconditional grid, so a cold load showed 'Loading vehicles...' and an
empty grid at the same time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BL5k8UCJHsvLKiXWQDfRJ"
```

---

## Task 5: `/settings/users`

**Files:**
- Create: `app/settings/users/UserCard.tsx`
- Modify: `app/settings/users/page.tsx`
- Modify: `lib/nav/skeletonReadyRoutes.ts`, `lib/nav/skeletonReadyRoutes.test.ts`

This page fetches `/api/settings/users/invite`, not Supabase, so the union does not touch it. It still needs a `tenant.status` guard, for the ordering reason below.

No `types.ts`: `TenantUser` is already a named type at the top of the file and is not needed anywhere else.

- [ ] **Step 1: Derive one state value, not three booleans**

This is the crux of the task. `tenant.activeTenantId` is null in two unrelated situations: while the tenant context resolves, and when a resolved admin is deliberately on "All tenants". The page currently tests only for null (line 41) and so cannot tell them apart, which is why it renders "No users found for this tenant." as the first thing a company admin sees.

Testing null first would flash "pick a tenant" on every cold load. The order is fixed:

Add to `app/settings/users/page.tsx`, next to the other hooks:

```ts
/* One derived value rather than three independent booleans, because the four
   states are mutually exclusive BY ORDER and three booleans would let a future
   edit put them in the wrong one.

   The order matters and is not arbitrary. activeTenantId is null both while the
   context resolves AND when a resolved admin sits on "All tenants", so testing
   null before status would show "pick a tenant" for a frame on every cold load:
   a worse flash than the one this project exists to remove. */
type UsersView = "loading" | "no-tenant-selected" | "empty" | "list";

function usersView({
  tenantStatus,
  activeTenantId,
  fetching,
  users,
}: {
  tenantStatus: TenantStatus;
  activeTenantId: string | null;
  fetching: boolean;
  users: TenantUser[];
}): UsersView {
  if (users.length > 0) return "list";           // never skeleton over content
  if (tenantStatus !== "ready") return "loading";
  if (!activeTenantId) return "no-tenant-selected";
  if (fetching) return "loading";
  return "empty";
}
```

Import `TenantStatus` from `../../../lib/tenant/context`. Then in the component:

```ts
  const view = usersView({
    tenantStatus: tenant.status,
    activeTenantId: tenant.activeTenantId,
    fetching: loading,
    users,
  });
```

- [ ] **Step 2: Guard the loader**

`loadUsers` at line 40 opens with `if (!tenant.activeTenantId) { setUsers([]); setLoading(false); return; }`. Replace that block with:

```ts
    if (tenant.status !== "ready") return;   // stay in the loading view

    if (!tenant.activeTenantId) {
      // A resolved admin on "All tenants". Nothing is coming, and the view
      // says so rather than claiming the tenant has no users.
      setUsers([]);
      setLoading(false);
      return;
    }
```

Change the callback deps at line 75 from `[tenant.activeTenantId]` to `[tenant.status, tenant.activeTenantId]`.

- [ ] **Step 3: Write the card**

Create `app/settings/users/UserCard.tsx`. Move the `<article>` at `page.tsx:281-386` across, adding the loading branches. The inline edit form inside the card is reachable only via the Edit button, which is disabled while loading, so it needs no loading state; move it across unchanged.

First create `app/settings/users/types.ts` by moving the `TenantUser` type out of `page.tsx` with `export` added, and import it back into `page.tsx`. This deviates from the spec's file list, for the same cycle-avoidance reason as the `compliance.tsx` files: the page imports the card, so the card cannot import a type from the page without a circular edge.

```tsx
import Badge from "../../../components/Badge";
import Button from "../../../components/Button";
import Skeleton from "../../../components/Skeleton";
import type { TenantUser } from "./types";

type Props = {
  user: TenantUser;
  loading?: boolean;
  canInvite: boolean;
  isEditing: boolean;
  /* The edit form lives inside the card, so its state comes in as props
     rather than being duplicated here. All of it stays owned by the page. */
  editFullName: string;
  setEditFullName: (value: string) => void;
  editPhone: string;
  setEditPhone: (value: string) => void;
  editRole: string;
  setEditRole: (value: string) => void;
  savingUser: boolean;
  onBeginEdit: (user: TenantUser) => void;
  onCancelEdit: () => void;
  onSave: (userId: string) => void;
};

export default function UserCard({
  user,
  loading = false,
  canInvite,
  isEditing,
  editFullName,
  setEditFullName,
  editPhone,
  setEditPhone,
  editRole,
  setEditRole,
  savingUser,
  onBeginEdit,
  onCancelEdit,
  onSave,
}: Props) {
  return (
    <article className="rounded-lg border border-line bg-surface-2 p-3" aria-busy={loading}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="break-words text-md font-semibold text-ink">
            {loading ? <Skeleton display="inline-block" w="12ch" h="1rem" /> : user.full_name || user.email || "TMS User"}
          </strong>

          {loading ? (
            <div className="mt-1">
              <Skeleton display="inline-block" w="16ch" h="0.75rem" />
            </div>
          ) : user.email ? (
            <div className="mt-1 break-words text-sm text-ink-3">{user.email}</div>
          ) : null}

          {loading ? (
            <div className="mt-1">
              <Skeleton display="inline-block" w="10ch" h="0.75rem" />
            </div>
          ) : user.phone ? (
            <div className="mt-1 break-words text-sm text-ink-3">{user.phone}</div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {loading ? (
            <Skeleton w="4rem" h="1.375rem" pill />
          ) : (
            <Badge tone="info">{formatRole(user.role)}</Badge>
          )}

          {canInvite && (loading || user.user_id) ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={() => (isEditing ? onCancelEdit() : onBeginEdit(user))}
            >
              {isEditing ? "Cancel" : "Edit"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* The edit form, moved across from page.tsx:330-386 unchanged. It needs
          no loading state of its own: it is reachable only through the Edit
          button, which is disabled while loading, so isEditing is false. */}
      {isEditing && user.user_id ? (
        <div className="mt-3 grid items-end gap-3 border-t border-line pt-3 sm:grid-cols-2">
          {/* ...the three labelled inputs exactly as they are today, with
              editFullName/setEditFullName, editPhone/setEditPhone and
              editRole/setEditRole now arriving as props... */}
          <div>
            <Button type="button" disabled={savingUser} onClick={() => onSave(user.user_id!)}>
              {savingUser ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
```

`formatRole` (`page.tsx:399`) is used only at `page.tsx:311`, inside the markup being moved, so move the whole function into this file and delete it from the page.

- [ ] **Step 4: Render the four states**

Add after the imports:

```ts
const SKELETON_CARDS = 4;

const PLACEHOLDER_USER = {
  membership_id: "",
  user_id: null,
  email: null,
  full_name: null,
  phone: null,
  role: "staff",
  role_id: null,
} as TenantUser;
```

Replace the branch at `page.tsx:271-280`:

```tsx
          <div className="grid gap-3" aria-busy={view === "loading"}>
            {view === "loading" ? (
              <>
                <span className="sr-only" role="status">Loading users</span>
                {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                  <UserCard
                    key={`skeleton-${index}`}
                    user={PLACEHOLDER_USER}
                    loading
                    canInvite={canInvite}
                    isEditing={false}
                    editFullName=""
                    setEditFullName={() => {}}
                    editPhone=""
                    setEditPhone={() => {}}
                    editRole="staff"
                    setEditRole={() => {}}
                    savingUser={false}
                    onBeginEdit={() => {}}
                    onCancelEdit={() => {}}
                    onSave={() => {}}
                  />
                ))}
              </>
            ) : view === "no-tenant-selected" ? (
              <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-3 shadow-sm">
                Users are managed one tenant at a time. Pick a tenant from the
                selector in the header to see and invite its users.
              </div>
            ) : view === "empty" ? (
              <div className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-3 shadow-sm">
                No users found for this tenant.
              </div>
            ) : (
              users.map((user) => (
                <UserCard
                  key={user.membership_id}
                  user={user}
                  canInvite={canInvite}
                  isEditing={Boolean(user.user_id) && editingUserId === user.user_id}
                  editFullName={editFullName}
                  setEditFullName={setEditFullName}
                  editPhone={editPhone}
                  setEditPhone={setEditPhone}
                  editRole={editRole}
                  setEditRole={setEditRole}
                  savingUser={savingUser}
                  onBeginEdit={beginEdit}
                  onCancelEdit={cancelEdit}
                  onSave={(userId) => void saveUser(userId)}
                />
              ))
            )}
          </div>
```

The "no tenant selected" copy names the selector rather than merely stating that no tenant is selected. That is the point: it tells the user what to do.

- [ ] **Step 5: Allowlist, verify, commit**

Add `"/settings/users",       // app/settings/users/page.tsx` to `SKELETON_READY_ROUTES` and to the test's expected array.

Run: `npm run typecheck && npm test`
Expected: both clean.

```bash
git add app/settings/users lib/nav/skeletonReadyRoutes.ts lib/nav/skeletonReadyRoutes.test.ts
git commit -m "feat(settings/users): loading skeletons and a real no-tenant state

Replaces 'No users found for this tenant.' shown to admins on the default
'All tenants' view, which was false: the page never queried at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BL5k8UCJHsvLKiXWQDfRJ"
```

---

## Task 6: `/settings/licences`

**Files:**
- Create: `app/settings/licences/LicenceCard.tsx`
- Modify: `app/settings/licences/page.tsx`
- Modify: `lib/nav/skeletonReadyRoutes.ts`, `lib/nav/skeletonReadyRoutes.test.ts`

**This file is indented with four spaces**, where the rest of the app uses two. Match the file. Do not reformat it: a whitespace-only rewrite of 390 lines would bury the actual change in the diff.

- [ ] **Step 1: Write the card**

Create `app/settings/licences/LicenceCard.tsx`, moving the `<article>` at `page.tsx:333-382` across. Its five cells share one shape, so give it a local `Cell` helper rather than repeating the branch five times:

```tsx
import type { ReactNode } from "react";
import Button from "../../../components/Button";
import Skeleton from "../../../components/Skeleton";

type Props = {
    licence: VehicleLicence;
    loading?: boolean;
    onToggle: (id: string, active: boolean) => void;
    onDelete: (id: string) => void;
};

export default function LicenceCard({ licence, loading = false, onToggle, onDelete }: Props) {
    return (
        <article className="rounded-lg border border-line bg-surface p-4 shadow-sm" aria-busy={loading}>
            <h3 className="m-0 mb-2 text-md font-semibold text-ink">
                {loading ? <Skeleton display="inline-block" w="14ch" h="1rem" /> : licence.licence_type}
            </h3>

            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Cell
                    label="Vehicle"
                    loading={loading}
                    value={
                        licence.vehicles?.registration ||
                        [licence.vehicles?.make, licence.vehicles?.model].filter(Boolean).join(" ") ||
                        licence.vehicle_id
                    }
                />
                <Cell label="Issue Date" loading={loading} mono value={licence.issue_date || "-"} />
                <Cell label="Expiry Date" loading={loading} mono value={licence.expiry_date || "-"} />
                <Cell label="Billing Status" loading={loading} value={licence.active ? "Active" : "Inactive"} />
                <Cell label="Notes" loading={loading} value={licence.notes || "-"} />
            </div>

            <div className="flex flex-wrap gap-2">
                <Button
                    variant="secondary"
                    disabled={loading}
                    onClick={() => onToggle(licence.id, licence.active)}
                >
                    {/* "Deactivate" while loading: the wider of the two labels,
                        so the button does not grow when the data arrives. */}
                    {loading ? "Deactivate" : licence.active ? "Deactivate" : "Activate"}
                </Button>

                <Button variant="danger" disabled={loading} onClick={() => onDelete(licence.id)}>
                    Delete
                </Button>
            </div>
        </article>
    );
}

function Cell({
    label,
    value,
    loading,
    mono,
}: {
    label: string;
    value: ReactNode;
    loading?: boolean;
    mono?: boolean;
}) {
    return (
        <div className="text-sm">
            <span className="text-kicker uppercase text-ink-3">{label}</span>{" "}
            <strong className={mono ? "block font-mono text-ink" : "block text-ink"}>
                {/* inline-block keeps this block <strong>'s line box at text
                    height, so the cell does not shrink while loading. */}
                {loading ? <Skeleton display="inline-block" w="75%" h="0.875rem" /> : value}
            </strong>
        </div>
    );
}
```

Export `VehicleLicence` (and the `Vehicle` type it references) from `page.tsx` and import them here.

- [ ] **Step 2: Derive the flag (the guard is already in place)**

Task 2 added this page's loader guard and effect dependency. Confirm with
`grep -n "tenant.status" app/settings/licences/page.tsx` and stop and report if it is missing
rather than adding it yourself.

Add next to the other hooks:

```ts
    const showSkeleton = shouldShowSkeleton({
        tenantStatus: tenant.status,
        fetching: loading,
        hasData: licences.length > 0,
    });
```

- [ ] **Step 3: Render the skeletons**

Add after the imports:

```ts
const SKELETON_CARDS = 3;

const PLACEHOLDER_LICENCE = {
    id: "",
    licence_type: "",
    vehicle_id: "",
    issue_date: null,
    expiry_date: null,
    active: true,
    notes: null,
    vehicles: null,
} as unknown as VehicleLicence;
```

Replace the branch at `page.tsx:328-386`:

```tsx
            <div className="grid gap-3" aria-busy={showSkeleton}>
                {showSkeleton ? (
                    <>
                        <span className="sr-only" role="status">Loading licences</span>
                        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
                            <LicenceCard
                                key={`skeleton-${index}`}
                                licence={PLACEHOLDER_LICENCE}
                                loading
                                onToggle={() => {}}
                                onDelete={() => {}}
                            />
                        ))}
                    </>
                ) : (
                    licences.map((licence) => (
                        <LicenceCard
                            key={licence.id}
                            licence={licence}
                            onToggle={toggleLicence}
                            onDelete={deleteLicence}
                        />
                    ))
                )}
            </div>
```

Note the page has no empty state today (an empty `licences` array simply renders an empty grid). Leave that as it is: adding one is a separate change and this batch is already carrying two.

- [ ] **Step 4: Allowlist, verify, commit**

Add `"/settings/licences",    // app/settings/licences/page.tsx` to `SKELETON_READY_ROUTES` and to the test's expected array.

Run: `npm run typecheck && npm test`
Expected: both clean.

```bash
git add app/settings/licences lib/nav/skeletonReadyRoutes.ts lib/nav/skeletonReadyRoutes.test.ts
git commit -m "feat(settings/licences): loading skeletons, card extracted

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BL5k8UCJHsvLKiXWQDfRJ"
```

---

## Task 7: `/settings/portal-invites`

**Files:**
- Modify: `app/settings/portal-invites/page.tsx`
- Modify: `lib/nav/skeletonReadyRoutes.ts`, `lib/nav/skeletonReadyRoutes.test.ts`

**No skeletons on this page, and no new component.** That is deliberate and it is not an exception to the recipe, it is the recipe. The page is four `<select>` dropdowns, and a select is a fixed-size control whose options are not visible until it is opened, so it carries no data on screen. Batch 1's "only data-bearing leaves become skeletons" rule covers this exactly, and it is the same reasoning that leaves `CustomerCard`'s buttons rendering real-but-disabled. Do not add `Skeleton` to this file.

Today the page has no loading flag at all: `loadData` (line 59) populates the selects from one fetch, and until it returns they render with no options, silently stating that no drivers, subcontractors or employees exist.

- [ ] **Step 1: Add the missing loading flag and the view**

Add to the component, next to the existing state:

```ts
  const [loading, setLoading] = useState(true);
```

Add above the component, mirroring Task 5 (same ordering rule, same reason: `activeTenantId` is null both while resolving and on "All tenants"):

```ts
type InvitesView = "loading" | "no-tenant-selected" | "ready";

function invitesView({
  tenantStatus,
  activeTenantId,
  fetching,
}: {
  tenantStatus: TenantStatus;
  activeTenantId: string | null;
  fetching: boolean;
}): InvitesView {
  if (tenantStatus !== "ready") return "loading";
  if (!activeTenantId) return "no-tenant-selected";
  if (fetching) return "loading";
  return "ready";
}
```

There is no `hasData` short circuit here, unlike the card pages: nothing on this page is replaced by a skeleton, so a re-resolve disables the controls briefly rather than blanking content. Disabling a control the user may be mid-way through is still worth avoiding, so the form keeps its own `busy` flag as it does today.

In the component:

```ts
  const view = invitesView({
    tenantStatus: tenant.status,
    activeTenantId: tenant.activeTenantId,
    fetching: loading,
  });
```

- [ ] **Step 2: Guard the loader and set the flag**

Replace `loadData`'s opening at line 60 (`if (!tenant.activeTenantId) return;`) with:

```ts
    if (tenant.status !== "ready") return;

    if (!tenant.activeTenantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
```

and ensure every exit path from `loadData` clears it, including the error branch. Wrap the fetch in `try`/`finally`:

```ts
    try {
      const response = await fetch(
        `/api/settings/portal-invites?tenantId=${encodeURIComponent(tenant.activeTenantId)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error || "Unable to load invite data.");
        return;
      }
      setData(body);
    } finally {
      setLoading(false);
    }
```

Without the `finally`, the error branch's early `return` would leave the controls disabled forever. Change the callback deps at line 77 from `[tenant.activeTenantId]` to `[tenant.status, tenant.activeTenantId]`.

- [ ] **Step 3: Disable the controls, and add the no-tenant state**

Add `disabled={view !== "ready"}` to each of the four `<select>` elements and to the submit `<Button>`s (keep any existing `disabled={busy}` by combining: `disabled={busy || view !== "ready"}`).

Above the form, render the state:

```tsx
      {view === "no-tenant-selected" ? (
        <div className="mb-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink-3 shadow-sm">
          Portal invites are sent one tenant at a time. Pick a tenant from the
          selector in the header to invite its drivers and subcontractors.
        </div>
      ) : null}

      {view === "loading" ? (
        <span className="sr-only" role="status">Loading invite options</span>
      ) : null}
```

- [ ] **Step 4: Allowlist, verify, commit**

Add `"/settings/portal-invites", // app/settings/portal-invites/page.tsx` to `SKELETON_READY_ROUTES` and to the test's expected array.

Run: `npm run typecheck && npm test`
Expected: both clean.

```bash
git add app/settings/portal-invites lib/nav/skeletonReadyRoutes.ts lib/nav/skeletonReadyRoutes.test.ts
git commit -m "feat(settings/portal-invites): add the missing loading state

The page had no loading flag: its four selects rendered empty while the
fetch was in flight, silently claiming no drivers or subcontractors
exist. Selects now render real and disabled, and admins on 'All tenants'
get a real explanation instead of empty dropdowns.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017BL5k8UCJHsvLKiXWQDfRJ"
```

---

## Task 8: Final verification

**Files:** none modified unless something fails.

- [ ] **Step 1: The full gate**

```bash
npm run typecheck && npm test && npm run build
```

Expected: typecheck clean, all tests pass, build green. The test count should be **exactly the baseline plus three**: the three cases added in Task 1. The allowlist tasks extend an existing case's expected array rather than adding cases, so they change no count. A different number means something was added that this plan did not ask for; find out what before continuing.

- [ ] **Step 2: Confirm the allowlist says what it should**

Run: `npx vitest run lib/nav/skeletonReadyRoutes.test.ts`

The "lists exactly the routes converted so far" case must now expect exactly eight paths: `/dashboard`, `/customers`, `/settings/billing`, `/subcontractors`, `/vehicles`, `/settings/users`, `/settings/licences`, `/settings/portal-invites`.

Confirm `/jobs`, `/planning` and `/tracking` are **not** on the list. They received a guard in Task 2 and nothing more; listing them would show their existing empty states as fact during load.

- [ ] **Step 3: Run the Playwright layout specs**

`tests/` is a separate npm project and is not part of `npm test`.

```bash
cd tests && npm install && npx playwright test
```

Both specs assert against the `TenantGate` panel as the thing rendered on redirect to `/login` (`tests/tracking-layout.spec.mjs:134`, `tests/pod-layout.spec.mjs:106`). Neither `/pod` nor `/tracking` joined the allowlist, so they should be unaffected, but `/tracking` did change in Task 2. Verify rather than assume. If a spec fails, that is a finding to report, not a spec to edit.

- [ ] **Step 4: Hand over for the signed-in manual pass**

Nothing here can be automated, and per `CLAUDE.md` there are no component tests. Report to the user that the following need a signed-in look before merge, and do not claim the batch is verified until they confirm:

1. Each of the five pages on a **cold** load (hard refresh), checking the skeleton appears and the layout does not jump when data arrives.
2. `/settings/users` and `/settings/portal-invites` as an **admin on "All tenants"**, confirming the new "pick a tenant" copy appears and that it does **not** flash on a normal cold load with a tenant selected.
3. **Light mode** on at least one of the five. No test can see a skeleton that is invisible against its surface, and that invisibility is the exact bug batch 1 was created to fix.
4. **Reduced motion** enabled, confirming the pulse stops.
5. `/jobs`, `/planning` and `/tracking` still load normally, since Task 2 changed their effect dependencies.

---

## Notes for whoever runs this

- **Do not add `/jobs`, `/planning`, `/tracking` or `/dashboard` to the allowlist** as part of Task 2. `/jobs`, `/planning` and `/tracking` get a guard only. `/dashboard` is already on the list from batch 1 and stays exactly as it is. This is the single easiest mistake to make in this plan.
- **Tasks 3, 4 and 6 no longer add their own loader guard or effect deps.** Task 2 does that for them. Their remaining steps are unchanged.
- **Do not reformat `app/settings/licences/page.tsx`.** Four-space indent, matched deliberately.
- **If Task 1's typecheck names a fourth broken file, stop and report.** The spec's count was measured; a fourth file means something changed and the plan should be revisited rather than patched.
- **Placeholder counts (6, 4, 4, 3) are guesses** about data that has not arrived, as is the two-pill flag row in `CustomerCard`. This is the recorded ceiling of pixel-faithful skeletons, not an oversight.
- Two buttons use the wider of their two possible labels while loading (`"Deactivate"` on `/vehicles` and `/settings/licences`) so they do not resize on arrival. Say so in review if it looks odd.
