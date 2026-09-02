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
   (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:4211`, handler
   at line 4223).
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
| `USER_UPDATED` | always | background, throttled |
| anything else | always | skip |

### Throttle

A background revalidate is skipped when the last *successful* resolve finished
under 5 minutes ago. Alt-tabbing between the TMS and another window therefore
costs no network traffic. The throttle applies to every background resolve,
`USER_UPDATED` included, because the provider consults it whenever the mode is
`background`. `SIGNED_OUT` always maps to blocking, so it is never throttled.

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

The `getUser()` rule needs one correction found during implementation, because
the naive reading of it reintroduces the very bug this spec exists to fix.
`getUser()` does **not** throw on a network or 5xx failure: `_getUser` catches
any `AuthError` and returns `{ data: { user: null }, error }`. Reading that
null as "signed out" would redirect someone to `/login` mid-form on a flaky
connection. The code therefore guards with `isAuthRetryableFetchError` (a
runtime export of `@supabase/supabase-js`, which re-exports auth-js; the direct
dependency, not the transitive `@supabase/auth-js`) and rethrows a retryable
error into the "could not check" path. A genuine `AuthSessionMissingError` is
not retryable, so revoked access still reaches the signed-out branch.

Two further implementation details, both deliberate:

- Any failure path that leaves the context untrustworthy resets `hasReadyRef`,
  so the next auth event is allowed to rebuild rather than being judged a
  throttled background revalidate against a stale timestamp.
- Failures are surfaced with `console.warn` only. There is no user-facing error
  state: a blocking resolve that fails stays on the loading panel, which is a
  change from the previous behaviour of redirecting to `/login`. It has no
  retry of its own, so a failed first load needs a reload or a tab-out and
  back in. See the follow-ups.

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
- throttle boundaries either side of 5 minutes
- transient RPC error keeps the last-good context
- no-tenant and signed-out results are honoured by the merge

That `SIGNED_OUT` bypasses the throttle, and that a no-user result gates the
user, are properties of the provider wiring rather than of the pure module, so
they are true by construction (the provider only consults `shouldRevalidate`
when the mode is `background`) and are covered by the manual check, not by a
unit test. `vitest.config.ts` covers `lib/` only, so nothing in
`app/components/TenantProvider.tsx` is under test.
- active tenant preserved across a revalidate, and the fallback when the active
  tenant has vanished from the list

`npm run typecheck` and `npm test` both clean.

Manual check behind auth: type into a jobs form, tab away for 30 seconds, tab
back. Text intact, no loading flash. Repeat on a skeleton-ready route
(customers) and confirm no refetch flicker.

## Follow-ups, not done here

Recorded during the final review of the branch. None blocks the fix.

1. **No in-flight generation guard.** `resolve()` has no cancellation token, so
   a slow background revalidate that lands after a blocking one can overwrite
   newer state, for example restoring a stale ready context just after a
   sign-out. It needs a sign-out within roughly two round trips of a tab-in and
   is UI-only, since the client has no session at that point. A generation ref
   incremented at the top of `resolve` and checked before every `setState`
   closes this, and also stops rapid tab-switching starting several concurrent
   background resolves while one is in flight.
2. **No recovery from a failed blocking resolve.** As above, the panel has no
   retry. Worth a single retry or a "could not reach the server" state.
3. **The `{ ok: false }` arm of `RevalidationResult` is never constructed in
   production.** The provider handles failure with an early return instead, so
   only tests exercise it. Either route failures through `applyRevalidation`
   for symmetry, or accept it as documentation of the contract.
4. **Obsolete per-page comments.** `app/customers/page.tsx` has been corrected.
   Sweep the sibling pages once the fix is confirmed behind auth.
5. **Is 5 minutes the right floor?** A revocation now takes up to 5 minutes
   longer to reach the UI than it did when every tab-in re-resolved. This is
   safe (RLS fails closed, and `lib/api/server.ts` re-derives the tenant and
   re-checks membership server-side, so a stale role yields a rejected write
   rather than a misrouted one) but it is a product call worth explicit
   sign-off rather than a default.
