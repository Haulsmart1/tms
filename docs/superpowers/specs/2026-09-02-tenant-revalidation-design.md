# Tenant revalidation without unmounting the page

Date: 2026-09-02
Status: approved, ready for implementation plan

## Problem

Tabbing away from the app and back destroys in-progress typing. Every form on
every blocking route loses its state.

The reported symptom sounds like a caching gap. It is not. It is a spurious
remount, and the chain is fully traceable:

1. `@supabase/auth-js` registers a `visibilitychange` listener. On every
   hidden to visible transition it runs `_recoverAndRefresh()`
   (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:4223`).
2. That function re-emits `SIGNED_IN` carrying the *same*, unchanged session
   (same file, line 3852). No sign-in has occurred.
3. `TenantProvider` treats `SIGNED_IN` as a real sign-in and calls `resolve()`
   (`app/components/TenantProvider.tsx:66`).
4. `resolve()` opens with `setData(LOADING)`, so `status` becomes `"loading"`.
5. `TenantGate` sees `"loading"` and returns its panel instead of `children`
   (`app/components/TenantGate.tsx:26`).

React unmounts the whole page subtree, taking every piece of component state
with it. Skeleton-ready routes (`isSkeletonReadyRoute`) escape the unmount but
still re-run their tenant-gated fetches, which can overwrite fields.

The workaround comment at `app/customers/page.tsx:201` already describes this
behaviour per page. This spec removes the cause instead.

## Non-goals

- Draft persistence to `localStorage` or `sessionStorage`. Considered and
  deliberately deferred: it protects against refresh, crash and accidental
  navigation, but it is per-form work and does not fix the flash. Revisit once
  this lands.
- Removing the per-page `status !== "ready"` guards that exist as workarounds
  for this bug. They become redundant but stay harmless. Separate cleanup.
- Any change to RLS, storage or the tenancy model. RLS remains the isolation
  boundary; nothing here weakens it.

## Design

### Two resolve modes

`resolve()` gains a mode.

**Blocking** is today's behaviour: `setData(LOADING)` first, `TenantGate` shows
its panel. Correct for a genuine first load or account change.

**Background** never touches `data` until a result is in hand. `status` stays
`"ready"` for the whole round trip, so nothing below the gate unmounts.

### Event mapping

| Event | Condition | Mode |
| --- | --- | --- |
| `SIGNED_IN` | no ready context yet | blocking |
| `SIGNED_IN` | same user id already resolved | background, throttled |
| `SIGNED_IN` | different user id | blocking |
| `SIGNED_OUT` | always | blocking, not throttled |
| `USER_UPDATED` | always | background |
| anything else | always | skip |

### Throttle

A background revalidate is skipped when the last *successful* resolve finished
under 5 minutes ago. Alt-tabbing between the TMS and another window therefore
costs no network traffic. `SIGNED_OUT` is never throttled.

### Result handling

- **Success.** Compare against the current context and call `setData` only if
  something actually changed, so `status` and `activeTenantId` keep their
  values and the page effects keyed on them do not refire. Those deps are
  primitives already (`app/jobs/page.tsx:118`, `app/customers/page.tsx:212`,
  `app/dashboard/page.tsx:192` and the rest), so no page changes are needed.
- **RPC error, or a thrown request.** Discard the result and keep the last-good
  context. The user keeps typing and never sees it. This is "we could not
  check", not "you are out".
- **No user from `getUser()`, or the RPC reports no tenant.** Honour it and
  gate normally. Revoked access still takes effect.

### Active tenant selection

A background revalidate must not re-run `pickInitialActiveTenant`. Today
`resolve()` always does, which would reset an admin's tenant selector
mid-session. The background path preserves the current selection, falling back
to `pickInitialActiveTenant` only when the active tenant is no longer in the
returned list.

### Where the logic lives

New pure module `lib/tenant/revalidate.ts`, with `revalidate.test.ts` beside
it:

- `decideResolveMode({ event, hasReadyContext, currentUserId, eventUserId })`
  returns `"blocking" | "background" | "skip"`.
- `shouldRevalidate({ lastResolvedAt, now, minIntervalMs })` returns a boolean.
- `applyRevalidation(prev, next)` returns the context to render, implementing
  the result handling above.
- `preserveActiveTenant({ current, tenants, role, homeTenantId, persisted })`
  returns the active tenant id to keep.

`TenantProvider` keeps only the wiring. This matches the existing
`lib/tenant/context.ts` split and keeps the logic under vitest, which covers
`lib/` only.

## Testing

Unit tests in `lib/tenant/revalidate.test.ts`:

- every row of the event mapping table, including the different-user-id case
- throttle boundaries either side of 5 minutes, and that `SIGNED_OUT` bypasses
  the throttle
- transient RPC error keeps the last-good context
- no-tenant and no-user results are honoured
- active tenant preserved across a revalidate, and the fallback when the active
  tenant has vanished from the list

`npm run typecheck` and `npm test` both clean.

Manual check behind auth: type into a jobs form, tab away for 30 seconds, tab
back. Text intact, no loading flash. Repeat on a skeleton-ready route
(customers) and confirm no refetch flicker.
