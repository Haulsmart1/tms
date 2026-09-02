# Tenant Revalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `TenantProvider` from unmounting the whole page (and every in-progress form) when the browser tab regains focus, by giving `resolve()` a non-blocking background mode.

**Architecture:** All decision logic lives in a new pure module `lib/tenant/revalidate.ts` with colocated vitest tests, matching the existing `lib/tenant/context.ts` split. `app/components/TenantProvider.tsx` keeps only the wiring: it maps auth events to a resolve mode, throttles background revalidates, and applies results through the pure helpers. No other file changes.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, `@supabase/ssr` browser client, vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-tenant-revalidation-design.md`

---

## Background for the engineer

`@supabase/auth-js` listens for `visibilitychange`. Every time the tab goes from
hidden to visible it re-emits `SIGNED_IN` with the *same* session. Today
`TenantProvider` treats that as a real sign-in, calls `resolve()`, and `resolve()`
starts with `setData(LOADING)`. `TenantGate` renders a full-screen panel whenever
status is `"loading"`, so React unmounts the entire page and destroys whatever the
user had typed.

Vitest only runs `lib/**/*.test.ts` (see `vitest.config.ts`), so nothing under
`app/` is covered by tests. That is why the logic goes in `lib/tenant/`.

## File Structure

- **Create** `lib/tenant/revalidate.ts` - pure decision logic: which resolve mode
  an auth event deserves, whether the throttle allows it, how to merge a result,
  and how to keep the active tenant selection.
- **Create** `lib/tenant/revalidate.test.ts` - unit tests for the above.
- **Modify** `app/components/TenantProvider.tsx` - `resolve()` gains a mode
  parameter; the `onAuthStateChange` handler consults the pure helpers.

Nothing else. The per-page `tenant.status !== "ready"` guards stay as they are.

---

## Task 1: Resolve-mode decision and throttle

**Files:**
- Create: `lib/tenant/revalidate.ts`
- Test: `lib/tenant/revalidate.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/tenant/revalidate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  decideResolveMode,
  shouldRevalidate,
  REVALIDATE_MIN_INTERVAL_MS,
} from "./revalidate";

describe("decideResolveMode", () => {
  const ready = { hasReadyContext: true, currentUserId: "u1" };

  it("blocks on the first SIGNED_IN, before any context exists", () => {
    expect(
      decideResolveMode({
        event: "SIGNED_IN",
        hasReadyContext: false,
        currentUserId: null,
        eventUserId: "u1",
      })
    ).toBe("blocking");
  });

  it("backgrounds a repeat SIGNED_IN for the same user", () => {
    expect(
      decideResolveMode({ event: "SIGNED_IN", ...ready, eventUserId: "u1" })
    ).toBe("background");
  });

  it("backgrounds a repeat SIGNED_IN that carries no user id", () => {
    expect(
      decideResolveMode({ event: "SIGNED_IN", ...ready, eventUserId: null })
    ).toBe("background");
  });

  it("blocks when SIGNED_IN carries a different user id", () => {
    expect(
      decideResolveMode({ event: "SIGNED_IN", ...ready, eventUserId: "u2" })
    ).toBe("blocking");
  });

  it("blocks on SIGNED_OUT", () => {
    expect(
      decideResolveMode({ event: "SIGNED_OUT", ...ready, eventUserId: null })
    ).toBe("blocking");
  });

  it("backgrounds USER_UPDATED", () => {
    expect(
      decideResolveMode({ event: "USER_UPDATED", ...ready, eventUserId: "u1" })
    ).toBe("background");
  });

  it("skips events we do not care about", () => {
    expect(
      decideResolveMode({ event: "TOKEN_REFRESHED", ...ready, eventUserId: "u1" })
    ).toBe("skip");
    expect(
      decideResolveMode({ event: "INITIAL_SESSION", ...ready, eventUserId: "u1" })
    ).toBe("skip");
  });
});

describe("shouldRevalidate", () => {
  it("allows the first revalidate when nothing has resolved yet", () => {
    expect(shouldRevalidate({ lastResolvedAt: null, now: 1000 })).toBe(true);
  });

  it("blocks a revalidate inside the interval", () => {
    expect(
      shouldRevalidate({
        lastResolvedAt: 0,
        now: REVALIDATE_MIN_INTERVAL_MS - 1,
      })
    ).toBe(false);
  });

  it("allows a revalidate exactly on the interval boundary", () => {
    expect(
      shouldRevalidate({ lastResolvedAt: 0, now: REVALIDATE_MIN_INTERVAL_MS })
    ).toBe(true);
  });

  it("uses five minutes as the interval", () => {
    expect(REVALIDATE_MIN_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it("honours an explicit interval override", () => {
    expect(
      shouldRevalidate({ lastResolvedAt: 0, now: 50, minIntervalMs: 100 })
    ).toBe(false);
  });

  it("treats a clock that jumped backwards as too soon", () => {
    expect(shouldRevalidate({ lastResolvedAt: 10000, now: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run lib/tenant/revalidate.test.ts`
Expected: FAIL, `Failed to resolve import "./revalidate"`.

- [ ] **Step 3: Write the implementation**

Create `lib/tenant/revalidate.ts`:

```ts
export type ResolveMode = "blocking" | "background" | "skip";

/* A background revalidate costs two Supabase round trips. Tab-switching fires
   an auth event every single time the tab becomes visible, so without this
   floor a user alt-tabbing between the TMS and a spreadsheet would hammer the
   API. Five minutes is short enough that a role or tenant-access change made
   elsewhere still lands promptly. */
export const REVALIDATE_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function decideResolveMode(input: {
  event: string;
  hasReadyContext: boolean;
  currentUserId: string | null;
  eventUserId: string | null;
}): ResolveMode {
  const { event, hasReadyContext, currentUserId, eventUserId } = input;

  if (event === "SIGNED_OUT") return "blocking";
  if (event === "USER_UPDATED") return "background";

  if (event === "SIGNED_IN") {
    /* Nothing on screen to protect yet, so the gate may as well block. */
    if (!hasReadyContext || !currentUserId) return "blocking";
    /* A genuine account switch: the old context is wrong, block and rebuild. */
    if (eventUserId && eventUserId !== currentUserId) return "blocking";
    /* Same user, already resolved: this is auth-js re-emitting SIGNED_IN after
       a visibilitychange. Never block on it. */
    return "background";
  }

  return "skip";
}

export function shouldRevalidate(input: {
  lastResolvedAt: number | null;
  now: number;
  minIntervalMs?: number;
}): boolean {
  const {
    lastResolvedAt,
    now,
    minIntervalMs = REVALIDATE_MIN_INTERVAL_MS,
  } = input;
  if (lastResolvedAt === null) return true;
  return now - lastResolvedAt >= minIntervalMs;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run lib/tenant/revalidate.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tenant/revalidate.ts lib/tenant/revalidate.test.ts
git commit -m "feat(tenant): decide resolve mode per auth event, throttle revalidates"
```

---

## Task 2: Merging a revalidation result

`applyRevalidation` implements the spec's error handling: a transient failure
keeps the last-good context, while a real signed-out or no-tenant answer is
honoured. It also returns the *previous object reference* when nothing changed,
which makes `setData` a no-op in React and stops page effects from refiring.

**Files:**
- Modify: `lib/tenant/revalidate.ts`
- Test: `lib/tenant/revalidate.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/tenant/revalidate.test.ts`:

```ts
import { applyRevalidation, tenantContextEquals } from "./revalidate";
import type { TenantContextData } from "./context";

const READY: TenantContextData = {
  status: "ready",
  role: "admin",
  companyId: "c1",
  homeTenantId: "t1",
  tenants: [{ id: "t1", name: "Depot A" }, { id: "t2", name: "Depot B" }],
};

describe("tenantContextEquals", () => {
  it("treats a structurally identical context as equal", () => {
    expect(tenantContextEquals(READY, { ...READY, tenants: [...READY.tenants] }))
      .toBe(true);
  });

  it("notices a changed role", () => {
    expect(tenantContextEquals(READY, { ...READY, role: "staff" })).toBe(false);
  });

  it("notices a tenant added, removed, renamed or reordered", () => {
    expect(tenantContextEquals(READY, { ...READY, tenants: [READY.tenants[0]] }))
      .toBe(false);
    expect(
      tenantContextEquals(READY, {
        ...READY,
        tenants: [{ id: "t1", name: "Depot A (renamed)" }, READY.tenants[1]],
      })
    ).toBe(false);
    expect(
      tenantContextEquals(READY, {
        ...READY,
        tenants: [READY.tenants[1], READY.tenants[0]],
      })
    ).toBe(false);
  });
});

describe("applyRevalidation", () => {
  it("keeps the last-good context when the request failed", () => {
    expect(applyRevalidation(READY, { ok: false })).toBe(READY);
  });

  it("keeps the previous reference when nothing changed", () => {
    const next = { ...READY, tenants: [...READY.tenants] };
    expect(applyRevalidation(READY, { ok: true, data: next })).toBe(READY);
  });

  it("adopts a genuinely changed context", () => {
    const next = { ...READY, role: "staff" as const };
    expect(applyRevalidation(READY, { ok: true, data: next })).toBe(next);
  });

  it("honours a real loss of access", () => {
    const gone: TenantContextData = { ...READY, status: "no-tenant", tenants: [] };
    expect(applyRevalidation(READY, { ok: true, data: gone })).toBe(gone);

    const out: TenantContextData = { ...READY, status: "signed-out" };
    expect(applyRevalidation(READY, { ok: true, data: out })).toBe(out);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run lib/tenant/revalidate.test.ts`
Expected: FAIL, `applyRevalidation is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

Append to `lib/tenant/revalidate.ts`:

```ts
export type RevalidationResult =
  | { ok: true; data: TenantContextData }
  /* ok: false means "we could not check", not "you are out". A network blip on
     tab-in must never blow away a form the user is filling in. */
  | { ok: false };

export function tenantContextEquals(
  a: TenantContextData,
  b: TenantContextData
): boolean {
  if (
    a.status !== b.status ||
    a.role !== b.role ||
    a.companyId !== b.companyId ||
    a.homeTenantId !== b.homeTenantId ||
    a.tenants.length !== b.tenants.length
  ) {
    return false;
  }
  return a.tenants.every(
    (t, i) => t.id === b.tenants[i].id && t.name === b.tenants[i].name
  );
}

export function applyRevalidation(
  prev: TenantContextData,
  result: RevalidationResult
): TenantContextData {
  if (!result.ok) return prev;
  /* Returning prev by reference makes setData a no-op, so status and the
     effects keyed on it stay put. */
  if (tenantContextEquals(prev, result.data)) return prev;
  return result.data;
}
```

This needs the `TenantContextData` type. Add this import at the top of
`lib/tenant/revalidate.ts`, above the `ResolveMode` type:

```ts
import type { TenantContextData } from "./context";
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run lib/tenant/revalidate.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tenant/revalidate.ts lib/tenant/revalidate.test.ts
git commit -m "feat(tenant): merge revalidation results without dropping last-good context"
```

---

## Task 3: Preserving the active tenant selection

Today `resolve()` always re-runs `pickInitialActiveTenant`, which would reset an
admin's tenant selector every time the tab regains focus. A background
revalidate must keep the current selection instead.

**Files:**
- Modify: `lib/tenant/revalidate.ts`
- Test: `lib/tenant/revalidate.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/tenant/revalidate.test.ts`:

```ts
import { preserveActiveTenant } from "./revalidate";

const TENANTS = [{ id: "t1", name: "Depot A" }, { id: "t2", name: "Depot B" }];

describe("preserveActiveTenant", () => {
  it("keeps an admin's current selection when it still exists", () => {
    expect(
      preserveActiveTenant({
        current: "t2",
        tenants: TENANTS,
        role: "admin",
        homeTenantId: "t1",
        persisted: "t1",
      })
    ).toBe("t2");
  });

  it("keeps an admin on All tenants", () => {
    expect(
      preserveActiveTenant({
        current: null,
        tenants: TENANTS,
        role: "admin",
        homeTenantId: "t1",
        persisted: "t1",
      })
    ).toBeNull();
  });

  it("falls back to All tenants when the selected tenant has vanished", () => {
    expect(
      preserveActiveTenant({
        current: "t3",
        tenants: TENANTS,
        role: "admin",
        homeTenantId: "t1",
        persisted: "t3",
      })
    ).toBeNull();
  });

  it("pins staff to their home tenant regardless of the current value", () => {
    expect(
      preserveActiveTenant({
        current: null,
        tenants: TENANTS,
        role: "staff",
        homeTenantId: "t1",
        persisted: null,
      })
    ).toBe("t1");
    expect(
      preserveActiveTenant({
        current: "t2",
        tenants: TENANTS,
        role: "staff",
        homeTenantId: "t1",
        persisted: null,
      })
    ).toBe("t1");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run lib/tenant/revalidate.test.ts`
Expected: FAIL, `preserveActiveTenant is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

First widen the import at the top of `lib/tenant/revalidate.ts` so it reads
exactly:

```ts
import { pickInitialActiveTenant } from "./context";
import type { TenantContextData, TenantOption, TenantRole } from "./context";
```

Then append to `lib/tenant/revalidate.ts`:

```ts
export function preserveActiveTenant(input: {
  current: string | null;
  tenants: TenantOption[];
  role: TenantRole;
  homeTenantId: string | null;
  persisted: string | null;
}): string | null {
  const { current, tenants, role, homeTenantId, persisted } = input;
  /* Staff are pinned to their home tenant, so their "selection" is not theirs
     to keep. Defer to the same rule the initial resolve uses. */
  if (role === "staff") {
    return pickInitialActiveTenant(role, homeTenantId, tenants, persisted);
  }
  /* null is a real admin choice ("All tenants"), not an absent one. */
  if (current === null) return null;
  if (tenants.some((t) => t.id === current)) return current;
  /* The selected tenant is gone from under them. Rebuild from scratch. */
  return pickInitialActiveTenant(role, homeTenantId, tenants, persisted);
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run lib/tenant/revalidate.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/tenant/revalidate.ts lib/tenant/revalidate.test.ts
git commit -m "feat(tenant): keep the active tenant selection across a revalidate"
```

---

## Task 4: Wire TenantProvider to the two modes

This is the change that actually fixes the bug. There are no unit tests for it
(vitest does not cover `app/`); Task 5 covers it by typecheck and manual test.

**Files:**
- Modify: `app/components/TenantProvider.tsx:3-71`

- [ ] **Step 1: Extend the imports**

Replace the import block at `app/components/TenantProvider.tsx:3-11` with:

```tsx
import {
  createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode,
} from "react";
import { createClient } from "../../lib/supabase/browser";
import {
  parseTenantContext, pickInitialActiveTenant, computeWriteTenantId, tenantStorageKey,
  type TenantContextData, type TenantOption, type TenantRole, type TenantStatus,
} from "../../lib/tenant/context";
import {
  decideResolveMode, shouldRevalidate, applyRevalidation, preserveActiveTenant,
} from "../../lib/tenant/revalidate";
import { applyTenantFilter } from "../../lib/tenant/filter";
```

- [ ] **Step 2: Add the refs the auth handler reads**

Immediately after the `useState` declarations near
`app/components/TenantProvider.tsx:32-35`, add:

```tsx
  /* The onAuthStateChange callback is registered once and would otherwise close
     over stale state, so the three values it needs live in refs. */
  const userIdRef = useRef<string | null>(null);
  const hasReadyRef = useRef(false);
  const lastResolvedAtRef = useRef<number | null>(null);
```

- [ ] **Step 3: Replace `resolve` with the two-mode version**

Replace the whole `const resolve = useCallback(...)` block
(`app/components/TenantProvider.tsx:37-61`) with:

```tsx
  const resolve = useCallback(async (mode: "blocking" | "background") => {
    const background = mode === "background";
    /* The one line that caused the bug. In background mode we leave `data`
       alone, so status never dips to "loading", so TenantGate never swaps the
       page out for its panel, so nothing the user typed is unmounted. */
    if (!background) setData(LOADING);

    let user: { id: string; email?: string | null } | null = null;
    try {
      const res = await supabase.auth.getUser();
      user = res.data.user;
    } catch {
      /* Could not check. Background keeps the last-good context; blocking stays
         on the loading panel, which is what it did before this change. */
      return;
    }

    if (!user) {
      userIdRef.current = null;
      hasReadyRef.current = false;
      lastResolvedAtRef.current = Date.now();
      setUserId(null);
      setUserEmail(null);
      setData({ ...LOADING, status: "signed-out" });
      setActiveTenantIdState(null);
      return;
    }

    let raw: unknown;
    try {
      const res = await supabase.rpc("get_tenant_context");
      if (res.error) throw res.error;
      raw = res.data;
    } catch {
      if (background) return; // transient: keep the last-good context
      setData({ ...LOADING, status: "no-tenant" });
      setActiveTenantIdState(null);
      return;
    }

    const parsed = parseTenantContext(raw);
    const persisted =
      typeof window !== "undefined" ? window.localStorage.getItem(tenantStorageKey(user.id)) : null;

    userIdRef.current = user.id;
    hasReadyRef.current = parsed.status === "ready";
    lastResolvedAtRef.current = Date.now();
    setUserId(user.id);
    setUserEmail(user.email ?? null);

    if (background) {
      setData((prev) => applyRevalidation(prev, { ok: true, data: parsed }));
      setActiveTenantIdState((prev) =>
        preserveActiveTenant({
          current: prev,
          tenants: parsed.tenants,
          role: parsed.role,
          homeTenantId: parsed.homeTenantId,
          persisted,
        })
      );
    } else {
      setData(parsed);
      setActiveTenantIdState(
        pickInitialActiveTenant(parsed.role, parsed.homeTenantId, parsed.tenants, persisted)
      );
    }
  }, [supabase]);
```

- [ ] **Step 4: Replace the auth subscription effect**

Replace the `useEffect` block at `app/components/TenantProvider.tsx:63-71` with:

```tsx
  useEffect(() => {
    void resolve("blocking");
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const mode = decideResolveMode({
        event,
        hasReadyContext: hasReadyRef.current,
        currentUserId: userIdRef.current,
        eventUserId: session?.user?.id ?? null,
      });
      if (mode === "skip") return;
      if (
        mode === "background" &&
        !shouldRevalidate({ lastResolvedAt: lastResolvedAtRef.current, now: Date.now() })
      ) {
        return;
      }
      void resolve(mode);
    });
    return () => sub.subscription.unsubscribe();
  }, [resolve, supabase]);
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/components/TenantProvider.tsx
git commit -m "fix(tenant): revalidate in the background so tab-in stops unmounting the page"
```

---

## Task 5: Full verification

**Files:** none modified unless a check fails.

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all files pass, including `lib/theme/contrast.test.ts` and
`lib/tenant/context.test.ts`. No token values changed, so contrast is unaffected.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual check behind auth**

Run `npm run dev` and sign in (`scripts/dev-login.mjs` works for local sign-in;
note `.env.local` points at the live Supabase, so treat any writes as
production data).

1. Open `/jobs`, start typing into a form field, do not save.
2. Switch to another application for 30 seconds, then switch back.
3. Expected: the text is still there and no loading panel flashes.
4. Repeat on `/customers` (a skeleton-ready route) and confirm no refetch
   flicker.
5. Sign out in a second tab, return to the first, and confirm you are still
   redirected to `/login`. SIGNED_OUT must still block.

- [ ] **Step 4: Commit any fixes and report**

Report the actual output of `npm test` and `npm run typecheck`, and which of the
five manual steps were performed. Do not claim the manual check passed if it was
not run.
