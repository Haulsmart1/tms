# Tenant Context De-hardcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the hardcoded `TENANT_ID` / `FALLBACK_TENANT_ID` from 11 pages and resolve the acting tenant from the signed-in user through one `TenantProvider`, with an admin tenant selector and fail-closed behaviour.

**Architecture:** A SECURITY DEFINER RPC `get_tenant_context()` returns the user's role + accessible tenants. A `TenantProvider` React context calls it once (and on auth change), holds the active tenant, and exposes `useTenant()`. Pure logic lives in a tested `lib/tenant` module; the provider is a thin wrapper. Reads use `filterByTenant`; inserts stamp `writeTenantId`; updates never touch `tenant_id`; existing-row ops use the row's own tenant. `rls_08` hardens the DB so a null tenant can never be written, even by super.

**Tech Stack:** Next.js 16 (App Router, `"use client"` pages), React 19, TypeScript, `@supabase/ssr` browser client, Postgres RLS, vitest.

**Spec:** `docs/superpowers/specs/2026-07-29-tenant-context-de-hardcode-design.md`

---

## File structure

New:
- `docs/sql/rls_07_tenant_context.sql` - the resolution RPC (Ethan runs it).
- `docs/sql/rls_08_null_write_hardening.sql` - helper null-rejection + `drivers.tenant_id` NOT NULL (Ethan runs it).
- `lib/tenant/context.ts` - pure resolution/selection logic (types, `parseTenantContext`, `pickInitialActiveTenant`, `computeWriteTenantId`, `tenantStorageKey`).
- `lib/tenant/context.test.ts` - vitest tests for the above.
- `lib/tenant/filter.ts` - pure `applyTenantFilter`.
- `lib/tenant/filter.test.ts` - vitest tests for the above.
- `app/components/TenantProvider.tsx` - React context + `useTenant()` hook.
- `app/components/TenantGate.tsx` - loading / signed-out / no-tenant gate wrapper.
- `app/components/TenantSelector.tsx` - header dropdown (admin/super only).

Modified:
- `docs/sql/rls_09_verify.sql` - add null-write and foreign-write probes.
- `app/layout.tsx` - wrap `AppHeader` + children in `<TenantProvider>`.
- `app/components/AppHeader.tsx` - drop its own identity fetch, consume `useTenant()`, render `<TenantSelector>`.
- 11 pages: `customers`, `drivers`, `jobs`, `invoices`, `subcontractors`, `tracking`, `pod`, `maintenance`, `vehicles`, `settings/licences`, `settings/users`.

## Conversion recipe (referenced by the page tasks as R1..R7)

Each page task says which of these apply and shows its page-specific specifics. Do not apply a rule a task does not list.

- **R1 Remove the constant.** Delete `const TENANT_ID = "2f7cc0dc-..."` (Class-A) or `const FALLBACK_TENANT_ID = "..."` plus the local `resolveTenantId()` and any `tenantId` state (Class-B).
- **R2 Get the context.** Add `import { useTenant } from "../components/TenantProvider";` (adjust depth) and `const tenant = useTenant();` at the top of the component.
- **R3 Gate.** Import and wrap the returned JSX in `<TenantGate>...</TenantGate>` so loading/signed-out/no-tenant render the shared states.
- **R4 Reads.** Replace each list/scope `.eq("tenant_id", TENANT_ID)` with a `tenant.filterByTenant(...)` wrap of that query builder. Remove the constant from the query.
- **R5 Reload on change.** Add `tenant.activeTenantId` to the load `useEffect` dependency array so switching tenant re-runs the load (lists + FK dropdowns).
- **R6 Inserts.** In each create path: guard `if (!tenant.writeTenantId) { setMessage("Pick a specific tenant to create records."); return; }` then stamp `tenant_id: tenant.writeTenantId` on the inserted object. Never put `tenant_id` on the shared payload used by updates.
- **R7 Updates + existing-row ops.** Updates key on `id` only and must NOT include `tenant_id` in the payload. Existing-row operations that need a tenant (POD storage path) use the row's own loaded `tenant_id`, never `writeTenantId`.

---

## Task 1: `rls_07_tenant_context.sql` (Ethan runs it)

**Files:**
- Create: `docs/sql/rls_07_tenant_context.sql`

- [ ] **Step 1: Write the file**

```sql
-- RLS Tenancy Hardening -- 07: get_tenant_context() resolution RPC. Safe to re-run.
-- One trusted call the client uses to resolve role + accessible tenants. tenants is already
-- readable via the scoped tenants_select policy (rls_04); this RPC adds integrity-checking,
-- role normalization, and a single round-trip.
create or replace function public.get_tenant_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_company uuid; v_home uuid; v_tenants jsonb;
begin
  if v_uid is null then return jsonb_build_object('status','signed-out'); end if;
  v_role := public.get_my_role();
  v_company := public.get_my_company_id();
  v_home := public.current_tenant_id();

  -- integrity: a non-super must have a home tenant that belongs to their company
  if coalesce(v_role,'') <> 'super_admin'
     and (v_home is null
          or not exists (select 1 from public.tenants t
                         where t.id = v_home and t.company_id = v_company)) then
    return jsonb_build_object('status','no-tenant');
  end if;

  if v_role = 'super_admin' then
    select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name)
      into v_tenants from public.tenants t;
  elsif v_role = 'admin' then
    select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name)
      into v_tenants from public.tenants t where t.company_id = v_company;
  else
    select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name))
      into v_tenants from public.tenants t where t.id = v_home;
  end if;

  return jsonb_build_object('status','ready',
    'role', case when v_role = 'super_admin' then 'super_admin'
                 when v_role = 'admin' then 'admin' else 'staff' end,
    'company_id', v_company, 'home_tenant_id', v_home, 'tenants', coalesce(v_tenants,'[]'::jsonb));
end $$;

revoke all on function public.get_tenant_context() from public;
grant execute on function public.get_tenant_context() to authenticated;
```

- [ ] **Step 2: Commit the file**

```bash
git add docs/sql/rls_07_tenant_context.sql
git commit -m "sql: add get_tenant_context() resolution RPC"
```

- [ ] **Step 3: HALT for Ethan.** Ethan runs this in the Supabase SQL editor, then verifies as himself:

Run in Supabase: `select public.get_tenant_context();`
Expected: a `ready` object with his role and a `tenants` array (super_admin sees all tenants).

---

## Task 2: `rls_08_null_write_hardening.sql` (Ethan runs it)

**Files:**
- Create: `docs/sql/rls_08_null_write_hardening.sql`

- [ ] **Step 1: Write the file**

```sql
-- RLS Tenancy Hardening -- 08: close the null / super_admin write footgun. Safe to re-run.
-- (a) Helpers reject a null target for EVERY role incl super, so a null tenant_id can never
--     pass WITH CHECK nor be read back.
create or replace function public.can_access_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select target_tenant is not null and (
    public.get_my_role() = 'super_admin'
    or target_tenant = public.current_tenant_id()
    or (public.get_my_role() = 'admin'
        and target_tenant in (select t.id from public.tenants t
                              where t.company_id = public.get_my_company_id())));
$$;

create or replace function public.can_manage_tenant(target_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select target_tenant is not null and (
    public.get_my_role() = 'super_admin'
    or (public.get_my_role() = 'admin'
        and target_tenant in (select t.id from public.tenants t
                              where t.company_id = public.get_my_company_id())));
$$;

-- (b) Belt: make drivers match every other converted table.
--     Backfill check FIRST; if it returns > 0, fix those rows before the ALTER.
--   select count(*) from public.drivers where tenant_id is null;
alter table public.drivers alter column tenant_id set not null;
```

- [ ] **Step 2: Commit the file**

```bash
git add docs/sql/rls_08_null_write_hardening.sql
git commit -m "sql: reject null tenant writes (incl super); drivers.tenant_id NOT NULL"
```

- [ ] **Step 3: HALT for Ethan.** Ethan runs the backfill check, then the file, in Supabase.
Expected: the `count(*)` is `0`, then the function replacements and the ALTER succeed.

---

## Task 3: Extend the `rls_09` verification harness

**Files:**
- Modify: `docs/sql/rls_09_verify.sql` (add two probes before the final `return;`, around line 152)

- [ ] **Step 1: Add the null-write and foreign-write probes**

Insert after the P12 block (before `return;`):

```sql
  -- P13: a null tenant_id write is rejected for EVERY role, including super_admin (post rls_08).
  perform set_config('request.jwt.claims', json_build_object('sub',p_super,'role','authenticated')::text, true);
  begin
    insert into public.drivers (tenant_id, name) values (null, 'null-tenant probe');
    outcome := 'FAIL (allowed!)'; raise exception using errcode='ROLLB';
  exception
    when not_null_violation or insufficient_privilege or check_violation
      then outcome := 'PASS (blocked)';
    when sqlstate 'ROLLB' then null;
    when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm;
  end;
  probe := 'P13 super null-tenant write'; return next;

  -- P14: a staff write to a FOREIGN tenant is rejected by WITH CHECK.
  perform set_config('request.jwt.claims', json_build_object('sub',p_staff,'role','authenticated')::text, true);
  begin
    insert into public.customers (tenant_id, name)
      values ('00000000-0000-0000-0000-000000000000', 'foreign-tenant probe');
    outcome := 'FAIL (allowed!)'; raise exception using errcode='ROLLB';
  exception
    when insufficient_privilege or check_violation then outcome := 'PASS (blocked)';
    when sqlstate 'ROLLB' then null;
    when others then outcome := 'ERROR '||sqlstate||': '||sqlerrm;
  end;
  probe := 'P14 staff foreign-tenant write'; return next;
```

- [ ] **Step 2: Commit**

```bash
git add docs/sql/rls_09_verify.sql
git commit -m "sql: harness probes for null and foreign tenant writes (P13/P14)"
```

- [ ] **Step 3: HALT for Ethan.** After running rls_07 + rls_08, Ethan re-runs the harness.
Expected: P13 and P14 both `PASS (blocked)`.

---

## Task 4: Pure tenant logic in `lib/tenant` (vitest TDD)

**Files:**
- Create: `lib/tenant/context.ts`, `lib/tenant/context.test.ts`
- Create: `lib/tenant/filter.ts`, `lib/tenant/filter.test.ts`

- [ ] **Step 1: Write failing tests for `context.ts`**

`lib/tenant/context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseTenantContext,
  pickInitialActiveTenant,
  computeWriteTenantId,
  tenantStorageKey,
} from "./context";

const T = (id: string, name: string) => ({ id, name });

describe("parseTenantContext", () => {
  it("normalizes a ready admin context", () => {
    const d = parseTenantContext({
      status: "ready", role: "admin", company_id: "c1",
      home_tenant_id: "t1", tenants: [T("t1", "Depot A"), T("t2", "Depot B")],
    });
    expect(d.status).toBe("ready");
    expect(d.role).toBe("admin");
    expect(d.homeTenantId).toBe("t1");
    expect(d.tenants).toHaveLength(2);
  });

  it("maps an unknown role to staff", () => {
    const d = parseTenantContext({ status: "ready", role: "tenant", home_tenant_id: "t1", tenants: [] });
    expect(d.role).toBe("staff");
  });

  it("passes through signed-out and no-tenant", () => {
    expect(parseTenantContext({ status: "signed-out" }).status).toBe("signed-out");
    expect(parseTenantContext({ status: "no-tenant" }).status).toBe("no-tenant");
  });

  it("treats null/garbage input as no-tenant, never throws", () => {
    expect(parseTenantContext(null).status).toBe("no-tenant");
    expect(parseTenantContext({}).status).toBe("no-tenant");
  });
});

describe("pickInitialActiveTenant", () => {
  const tenants = [T("t1", "A"), T("t2", "B")];
  it("locks staff to their home tenant", () => {
    expect(pickInitialActiveTenant("staff", "t1", [T("t1", "A")], "t2")).toBe("t1");
  });
  it("defaults admin/super to All (null)", () => {
    expect(pickInitialActiveTenant("admin", "t1", tenants, null)).toBeNull();
  });
  it("restores a valid persisted admin choice", () => {
    expect(pickInitialActiveTenant("admin", "t1", tenants, "t2")).toBe("t2");
  });
  it("ignores a persisted choice not in the list", () => {
    expect(pickInitialActiveTenant("admin", "t1", tenants, "tX")).toBeNull();
  });
});

describe("computeWriteTenantId", () => {
  it("staff always writes to home", () => {
    expect(computeWriteTenantId("staff", "t1", "t1")).toBe("t1");
  });
  it("specific active tenant is the write target", () => {
    expect(computeWriteTenantId("admin", "t1", "t2")).toBe("t2");
  });
  it("All (null) yields null so create is blocked", () => {
    expect(computeWriteTenantId("admin", "t1", null)).toBeNull();
    expect(computeWriteTenantId("super_admin", null, null)).toBeNull();
  });
});

describe("tenantStorageKey", () => {
  it("is namespaced per user", () => {
    expect(tenantStorageKey("u1")).toBe("tms.activeTenant.u1");
    expect(tenantStorageKey("u1")).not.toBe(tenantStorageKey("u2"));
  });
});
```

- [ ] **Step 2: Run and verify it fails**

Run: `npm test -- lib/tenant/context.test.ts`
Expected: FAIL, cannot resolve `./context`.

- [ ] **Step 3: Implement `context.ts`**

`lib/tenant/context.ts`:

```ts
export type TenantRole = "staff" | "admin" | "super_admin";
export type TenantStatus = "loading" | "ready" | "signed-out" | "no-tenant";
export type TenantOption = { id: string; name: string };

export type TenantContextData = {
  status: TenantStatus;
  role: TenantRole;
  companyId: string | null;
  homeTenantId: string | null;
  tenants: TenantOption[];
};

function normalizeRole(role: unknown): TenantRole {
  return role === "super_admin" ? "super_admin" : role === "admin" ? "admin" : "staff";
}

export function parseTenantContext(raw: unknown): TenantContextData {
  const empty: TenantContextData = {
    status: "no-tenant", role: "staff", companyId: null, homeTenantId: null, tenants: [],
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  const status = r.status;
  if (status === "signed-out") return { ...empty, status: "signed-out" };
  if (status !== "ready") return empty;

  const tenants = Array.isArray(r.tenants)
    ? (r.tenants as unknown[])
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({ id: String(t.id), name: String(t.name ?? "") }))
    : [];

  return {
    status: "ready",
    role: normalizeRole(r.role),
    companyId: r.company_id ? String(r.company_id) : null,
    homeTenantId: r.home_tenant_id ? String(r.home_tenant_id) : null,
    tenants,
  };
}

export function pickInitialActiveTenant(
  role: TenantRole,
  homeTenantId: string | null,
  tenants: TenantOption[],
  persisted: string | null
): string | null {
  if (role === "staff") return homeTenantId;
  if (persisted && tenants.some((t) => t.id === persisted)) return persisted;
  return null; // "All tenants"
}

export function computeWriteTenantId(
  role: TenantRole,
  homeTenantId: string | null,
  activeTenantId: string | null
): string | null {
  if (role === "staff") return homeTenantId;
  return activeTenantId; // specific tenant, or null for "All"
}

export function tenantStorageKey(userId: string): string {
  return `tms.activeTenant.${userId}`;
}
```

- [ ] **Step 4: Run and verify it passes**

Run: `npm test -- lib/tenant/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing tests for `filter.ts`**

`lib/tenant/filter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyTenantFilter } from "./filter";

function fakeQuery() {
  const calls: Array<[string, string]> = [];
  const q: any = { calls, eq: (c: string, v: string) => { calls.push([c, v]); return q; } };
  return q;
}

describe("applyTenantFilter", () => {
  it("adds a tenant_id eq for a specific tenant", () => {
    const q = fakeQuery();
    applyTenantFilter(q, "t2");
    expect(q.calls).toEqual([["tenant_id", "t2"]]);
  });
  it("adds no filter for All (null)", () => {
    const q = fakeQuery();
    const out = applyTenantFilter(q, null);
    expect(q.calls).toEqual([]);
    expect(out).toBe(q);
  });
});
```

- [ ] **Step 6: Run and verify it fails**

Run: `npm test -- lib/tenant/filter.test.ts`
Expected: FAIL, cannot resolve `./filter`.

- [ ] **Step 7: Implement `filter.ts`**

`lib/tenant/filter.ts`:

```ts
// Minimal chainable shape we rely on from a supabase-js query builder.
export type TenantQuery<Q> = Q & { eq(column: string, value: string): Q };

export function applyTenantFilter<Q>(query: TenantQuery<Q>, activeTenantId: string | null): Q {
  return activeTenantId ? query.eq("tenant_id", activeTenantId) : query;
}
```

- [ ] **Step 8: Run and verify it passes**

Run: `npm test -- lib/tenant/filter.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/tenant/
git commit -m "feat: pure tenant resolution + filter logic with tests"
```

---

## Task 5: `TenantProvider.tsx`

**Files:**
- Create: `app/components/TenantProvider.tsx`

- [ ] **Step 1: Write the provider**

```tsx
"use client";

import {
  createContext, useContext, useEffect, useState, useCallback, type ReactNode,
} from "react";
import { createClient } from "../../lib/supabase/browser";
import {
  parseTenantContext, pickInitialActiveTenant, computeWriteTenantId, tenantStorageKey,
  type TenantContextData, type TenantOption, type TenantRole, type TenantStatus,
} from "../../lib/tenant/context";
import { applyTenantFilter, type TenantQuery } from "../../lib/tenant/filter";

type TenantContextValue = {
  status: TenantStatus;
  role: TenantRole;
  tenants: TenantOption[];
  activeTenantId: string | null;
  setActiveTenantId: (id: string | null) => void;
  writeTenantId: string | null;
  filterByTenant: <Q>(query: TenantQuery<Q>) => Q;
};

const TenantContext = createContext<TenantContextValue | null>(null);

const LOADING: TenantContextData = {
  status: "loading", role: "staff", companyId: null, homeTenantId: null, tenants: [],
};

export function TenantProvider({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const [data, setData] = useState<TenantContextData>(LOADING);
  const [userId, setUserId] = useState<string | null>(null);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    setData(LOADING);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUserId(null);
      setData({ ...LOADING, status: "signed-out" });
      setActiveTenantIdState(null);
      return;
    }
    setUserId(user.id);
    const { data: raw, error } = await supabase.rpc("get_tenant_context");
    if (error) {
      setData({ ...LOADING, status: "no-tenant" });
      setActiveTenantIdState(null);
      return;
    }
    const parsed = parseTenantContext(raw);
    setData(parsed);
    const persisted =
      typeof window !== "undefined" ? window.localStorage.getItem(tenantStorageKey(user.id)) : null;
    setActiveTenantIdState(
      pickInitialActiveTenant(parsed.role, parsed.homeTenantId, parsed.tenants, persisted)
    );
  }, [supabase]);

  useEffect(() => {
    resolve();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        resolve();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [resolve, supabase]);

  const setActiveTenantId = useCallback((id: string | null) => {
    setActiveTenantIdState(id);
    if (typeof window !== "undefined" && userId) {
      if (id) window.localStorage.setItem(tenantStorageKey(userId), id);
      else window.localStorage.removeItem(tenantStorageKey(userId));
    }
  }, [userId]);

  const writeTenantId = computeWriteTenantId(data.role, data.homeTenantId, activeTenantId);

  const value: TenantContextValue = {
    status: data.status,
    role: data.role,
    tenants: data.tenants,
    activeTenantId,
    setActiveTenantId,
    writeTenantId,
    filterByTenant: (query) => applyTenantFilter(query, activeTenantId),
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within a TenantProvider");
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors from `app/components/TenantProvider.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/components/TenantProvider.tsx
git commit -m "feat: TenantProvider context + useTenant hook"
```

---

## Task 6: `TenantGate.tsx`

**Files:**
- Create: `app/components/TenantGate.tsx`

- [ ] **Step 1: Write the gate**

```tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTenant } from "./TenantProvider";

const panelStyle: React.CSSProperties = {
  minHeight: "100vh", display: "grid", placeItems: "center",
  background: "#0f172a", color: "white", padding: 30, textAlign: "center",
};

export default function TenantGate({ children }: { children: ReactNode }) {
  const { status } = useTenant();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed-out") router.replace("/login");
  }, [status, router]);

  if (status === "loading") {
    return <div style={panelStyle}>Loading...</div>;
  }
  if (status === "signed-out") {
    return <div style={panelStyle}>Redirecting to sign in...</div>;
  }
  if (status === "no-tenant") {
    return (
      <div style={panelStyle}>
        <div>
          <h1>Account not linked to a company</h1>
          <p style={{ opacity: 0.8 }}>Ask an administrator to assign your profile to a tenant.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors from `TenantGate.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/components/TenantGate.tsx
git commit -m "feat: TenantGate fail-closed wrapper"
```

---

## Task 7: `TenantSelector.tsx`

**Files:**
- Create: `app/components/TenantSelector.tsx`

- [ ] **Step 1: Write the selector**

```tsx
"use client";

import { useTenant } from "./TenantProvider";

const selectStyle: React.CSSProperties = {
  padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)",
  background: "#1e293b", color: "white", fontSize: 14,
};

export default function TenantSelector() {
  const { role, tenants, activeTenantId, setActiveTenantId } = useTenant();

  if (role === "staff") return null;

  return (
    <select
      aria-label="Active tenant"
      style={selectStyle}
      value={activeTenantId ?? ""}
      onChange={(e) => setActiveTenantId(e.target.value === "" ? null : e.target.value)}
    >
      <option value="">All tenants</option>
      {tenants.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors from `TenantSelector.tsx`.

- [ ] **Step 3: Commit**

```bash
git add app/components/TenantSelector.tsx
git commit -m "feat: TenantSelector dropdown (admin/super)"
```

---

## Task 8: Wire the provider into `layout.tsx` and refactor `AppHeader.tsx`

**Files:**
- Modify: `app/layout.tsx:63-64`
- Modify: `app/components/AppHeader.tsx` (replace the identity fetch + render the selector)

- [ ] **Step 1: Wrap the body in the provider**

In `app/layout.tsx`, add the import at the top with the other imports:

```tsx
import { TenantProvider } from "./components/TenantProvider";
```

Then change the body children from:

```tsx
        <AppHeader />
        {children}
```

to:

```tsx
        <TenantProvider>
          <AppHeader />
          {children}
        </TenantProvider>
```

- [ ] **Step 2: Refactor `AppHeader.tsx` to consume the context**

Replace the top of the file (imports through the `loadRole` effect, lines 1-72) so it uses `useTenant()` instead of its own fetch. New header of the file:

```tsx
"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTenant } from "./TenantProvider";
import TenantSelector from "./TenantSelector";

const linkStyle: CSSProperties = {
  color: "white", textDecoration: "none", fontWeight: 500, fontSize: 14, opacity: 0.95,
};

const sectionStyle: CSSProperties = {
  display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap",
};

const superAdminLinkStyle: CSSProperties = {
  color: "white", textDecoration: "none", fontWeight: 600, fontSize: 14,
  padding: "4px 10px", borderRadius: 8, background: "#7c3aed",
};

export default function AppHeader() {
  const pathname = usePathname();
  const { status, role } = useTenant();

  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/super-admin")) {
    return null;
  }
  if (status === "loading" || status === "signed-out") {
    return null;
  }
```

Keep the existing `<header>...</header>` JSX (lines 86-133) unchanged EXCEPT:
- Add the selector inside `sectionStyle` div, right before the super-admin link:

```tsx
          <TenantSelector />
          {role === "super_admin" ? (
            <Link href="/super-admin" style={superAdminLinkStyle}>
              ⚡ Super Admin
            </Link>
          ) : null}
```

(Delete the now-unused `useEffect`, `useState`, `createClient`, `SUPER_ADMIN_ROLE`, `extractRoleName`, and `MenuStatus` imports/definitions.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/components/AppHeader.tsx
git commit -m "feat: mount TenantProvider and move role/selector into AppHeader"
```

---

## Task 9: Convert `jobs` (Class-A, apply R1-R7)

**Files:**
- Modify: `app/jobs/page.tsx` (constant at 9; reads at 139,145,152,159,166; writes at 354,413; update scopes at 372,384,459,492,502,521)

- [ ] **Step 1: Apply the recipe**

- R1: delete `const TENANT_ID` (line 9).
- R2: add `useTenant` import + `const tenant = useTenant();`.
- R3: wrap the returned `<main>` in `<TenantGate>`.
- R4: wrap each of the 5 read builders (lines 139,145,152,159,166) that end in `.eq("tenant_id", TENANT_ID)` with `tenant.filterByTenant(...)` and delete that `.eq`.
- R5: add `tenant.activeTenantId` to the load effect deps.
- R6: at each insert (lines 354 and 413), remove `tenant_id: TENANT_ID` from the shared object; add the guard `if (!tenant.writeTenantId) { setMessage("Pick a specific tenant to create records."); return; }` before the insert; add `tenant_id: tenant.writeTenantId` to the inserted object only.
- R7: at each update/delete scope (lines 372,384,459,492,502,521), remove the `.eq("tenant_id", TENANT_ID)` clause (RLS scopes these by `id`); ensure no update payload contains `tenant_id`.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds; no reference to `TENANT_ID` remains in the file.

- [ ] **Step 3: Commit**

```bash
git add app/jobs/page.tsx
git commit -m "feat: jobs page resolves tenant via useTenant (de-hardcode)"
```

---

## Task 10: Convert `customers` (Class-A, apply R1-R7)

**Files:**
- Modify: `app/customers/page.tsx` (constant at 6; read at 66; shared payload at 113-120; insert at 130-132; update at 125-128)

- [ ] **Step 1: Apply the edits (fully shown)**

Delete line 6 (`const TENANT_ID`). Add after line 4:

```tsx
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
```

At the top of `CustomersPage` after `const supabase = createClient();`:

```tsx
  const tenant = useTenant();
```

`loadCustomers` read (replace lines 63-67):

```tsx
    const { data, error } = await tenant
      .filterByTenant(supabase.from("customers").select("*"))
      .order("created_at", { ascending: false });
```

Reload on change (replace the effect at 77-79):

```tsx
  useEffect(() => {
    loadCustomers();
  }, [tenant.activeTenantId]);
```

`saveCustomer` (replace the shared payload + branches, lines 113-133): drop `tenant_id` from `payload`, guard + stamp on insert only:

```tsx
    const payload = {
      name: form.name,
      contact_name: form.contact_name || null,
      phone: form.phone || null,
      email: form.email || null,
      vat_number: form.vat_number || null,
    };

    let error;

    if (editingId) {
      ({ error } = await supabase
        .from("customers")
        .update(payload)
        .eq("id", editingId));
    } else {
      if (!tenant.writeTenantId) {
        setMessage("Pick a specific tenant to create records.");
        return;
      }
      ({ error } = await supabase
        .from("customers")
        .insert([{ ...payload, tenant_id: tenant.writeTenantId, active: true }]));
    }
```

Wrap the returned `<main>...</main>` in `<TenantGate>...</TenantGate>`.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/customers/page.tsx
git commit -m "feat: customers page resolves tenant via useTenant (de-hardcode)"
```

---

## Task 11: Convert `subcontractors` (Class-A, apply R1-R7)

**Files:**
- Modify: `app/subcontractors/page.tsx` (constant at 6; read at 58; insert at 88)

- [ ] **Step 1: Apply the recipe**

- R1: delete line 6. R2 + R3: add the `useTenant`/`TenantGate` imports, `const tenant = useTenant();`, wrap `<main>` in `<TenantGate>`.
- R4: wrap the read builder ending at line 58's `.eq("tenant_id", TENANT_ID)` in `tenant.filterByTenant(...)` and delete the `.eq`.
- R5: add `tenant.activeTenantId` to the load effect deps.
- R6: the insert object at line 88 currently has `tenant_id: TENANT_ID`. Replace with the guard + `tenant_id: tenant.writeTenantId`. If the insert shares a `payload` used by an update, move `tenant_id` off the shared object onto the insert branch only (same shape as Task 10).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/subcontractors/page.tsx
git commit -m "feat: subcontractors page resolves tenant via useTenant (de-hardcode)"
```

---

## Task 12: Convert `invoices` (Class-A, apply R1-R7)

**Files:**
- Modify: `app/invoices/page.tsx` (constant at 6; reads at 104,119; insert at 158; update scope at 185)

- [ ] **Step 1: Apply the recipe**

- R1/R2/R3 as above.
- R4: wrap the read builders at lines 104 and 119 in `tenant.filterByTenant(...)`, delete the `.eq("tenant_id", TENANT_ID)`.
- R5: add `tenant.activeTenantId` to the load effect deps.
- R6: at the insert (line 158) remove `tenant_id: TENANT_ID` from any shared payload; guard on `tenant.writeTenantId`; stamp `tenant_id: tenant.writeTenantId` on the inserted object only.
- R7: at the update scope (line 185) remove the `.eq("tenant_id", TENANT_ID)` (RLS scopes by `id`); ensure the update payload has no `tenant_id`.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/invoices/page.tsx
git commit -m "feat: invoices page resolves tenant via useTenant (de-hardcode)"
```

---

## Task 13: Convert `drivers` (Class-A admin-write, split payload, isAdmin gating)

**Files:**
- Modify: `app/drivers/page.tsx` (constant at 6; read at 66; shared payload at 118-128; update at 134-137; insert at 141-143; delete at 168-171; toggle at 184-187)

- [ ] **Step 1: Imports + context + isAdmin**

Delete line 6. Add after line 4:

```tsx
import { useTenant } from "../components/TenantProvider";
import TenantGate from "../components/TenantGate";
```

After `const supabase = createClient();`:

```tsx
  const tenant = useTenant();
  const isAdmin = tenant.role === "admin" || tenant.role === "super_admin";
```

- [ ] **Step 2: Read + reload**

`loadDrivers` (replace lines 63-67):

```tsx
    const { data, error } = await tenant
      .filterByTenant(supabase.from("drivers").select("*"))
      .order("created_at", { ascending: false });
```

Effect (replace 73-75):

```tsx
  useEffect(() => {
    loadDrivers();
  }, [tenant.activeTenantId]);
```

- [ ] **Step 3: Split the shared payload (R6/R7)**

Replace the `payload` + branches (lines 118-145):

```tsx
    const payload = {
      name: form.name,
      phone: form.phone || null,
      email: form.email || null,
      licence_number: form.licence_number || null,
      licence_category: form.licence_category || null,
      qualifications: form.qualifications || null,
    };

    let error;

    if (editingId) {
      ({ error } = await supabase
        .from("drivers")
        .update(payload)
        .eq("id", editingId));
    } else {
      if (!tenant.writeTenantId) {
        setMessage("Pick a specific tenant to create records.");
        return;
      }
      ({ error } = await supabase
        .from("drivers")
        .insert([{ ...payload, tenant_id: tenant.writeTenantId, active: true }]));
    }
```

- [ ] **Step 4: Gate create/delete/toggle to admins**

Guard the mutating handlers so staff never hit an RLS rejection: at the top of `saveDriver`, `deleteDriver`, and `toggleDriver` add:

```tsx
    if (!isAdmin) { setMessage("Only an admin can change drivers."); return; }
```

And render the Add/Edit form and the Edit/Delete/Activate buttons only when `isAdmin` (wrap the `<form>` and the three per-row buttons in `{isAdmin && ( ... )}`).

- [ ] **Step 5: Gate + typecheck + build**

Wrap the returned `<main>` in `<TenantGate>`. Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/drivers/page.tsx
git commit -m "feat: drivers page resolves tenant + admin-gates writes (de-hardcode)"
```

---

## Task 14: Convert `tracking` (read-only, apply R1-R5)

**Files:**
- Modify: `app/tracking/page.tsx` (constant at 6; reads at 18,24)

- [ ] **Step 1: Apply the recipe**

- R1: delete line 6. R2/R3: add imports, `const tenant = useTenant();`, wrap the returned JSX in `<TenantGate>`.
- R4: wrap both read builders (lines 18, 24) in `tenant.filterByTenant(...)`; delete the `.eq("tenant_id", TENANT_ID)`.
- R5: add `tenant.activeTenantId` to the load effect deps.
- No writes on this page.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/tracking/page.tsx
git commit -m "feat: tracking page resolves tenant via useTenant (de-hardcode)"
```

---

## Task 15: Convert `vehicles` (Class-B, admin-gate create/delete)

**Files:**
- Modify: `app/vehicles/page.tsx` (FALLBACK at 6; `resolveTenantId` at 72-90; usage at 115)

- [ ] **Step 1: Remove the Class-B resolver**

Delete `const FALLBACK_TENANT_ID` (line 6) and the whole `resolveTenantId()` function (72-90). Add the imports and `const tenant = useTenant();` and `const isAdmin = tenant.role === "admin" || tenant.role === "super_admin";`.

- [ ] **Step 2: Replace resolved usage**

Where the code did `const resolvedTenantId = await resolveTenantId();` (line 115) and then used `resolvedTenantId` for the read `.eq("tenant_id", resolvedTenantId)` and the insert `tenant_id: resolvedTenantId`:
- Read -> wrap the vehicles select builder in `tenant.filterByTenant(...)`, delete the `.eq`.
- Insert (vehicle create) -> guard `if (!tenant.writeTenantId) { setMessage("Pick a specific tenant to create records."); return; }` and stamp `tenant_id: tenant.writeTenantId` on the inserted object only; drop `tenant_id` from any shared payload.
- Add `tenant.activeTenantId` to the load effect deps.

- [ ] **Step 3: Admin-gate create/delete**

Vehicle create and delete are admin-only under RLS; the staff "toggle active" path stays. Add `if (!isAdmin) { ...; return; }` to the create and delete handlers and render their controls only when `isAdmin`. Leave the active-toggle handler available to all.

- [ ] **Step 4: Gate + typecheck + build**

Wrap the returned JSX in `<TenantGate>`. Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/vehicles/page.tsx
git commit -m "feat: vehicles page resolves tenant + admin-gates roster writes (de-hardcode)"
```

---

## Task 16: Convert `settings/licences` (Class-B, apply R1-R7)

**Files:**
- Modify: `app/settings/licences/page.tsx` (FALLBACK at 6; `resolveTenantId` at 112-128; usage at 195)

- [ ] **Step 1: Apply the recipe**

- Delete `FALLBACK_TENANT_ID` and `resolveTenantId()`. Add imports + `const tenant = useTenant();` (import depth is `../../components/...`).
- Replace the `const resolved = await resolveTenantId();` usage (line 195): reads -> `tenant.filterByTenant(...)`; inserts -> guard + `tenant_id: tenant.writeTenantId` on the insert object; updates omit `tenant_id`.
- Add `tenant.activeTenantId` to the load effect deps. Wrap the returned JSX in `<TenantGate>`.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/settings/licences/page.tsx
git commit -m "feat: settings/licences resolves tenant via useTenant (de-hardcode)"
```

---

## Task 17: Convert `settings/users` (Class-B, apply R1-R7)

**Files:**
- Modify: `app/settings/users/page.tsx` (FALLBACK at 7; `setTenantId(FALLBACK...)` at 23-24; `data?.tenant_id || FALLBACK...` at 33)

- [ ] **Step 1: Apply the recipe**

- Delete `FALLBACK_TENANT_ID` and the local tenant-resolution state (lines 23-24, 33). Add imports + `const tenant = useTenant();`.
- Replace every use of the local resolved id with the context: reads -> `tenant.filterByTenant(...)`; the invite/create action -> guard `if (!tenant.writeTenantId) {...; return;}` + stamp `tenant_id: tenant.writeTenantId` on the inserted row; updates omit `tenant_id`.
- Add `tenant.activeTenantId` to the load effect deps. Wrap the returned JSX in `<TenantGate>`.
- Inviting users is an admin action: gate the invite control on `tenant.role !== "staff"`.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/settings/users/page.tsx
git commit -m "feat: settings/users resolves tenant via useTenant (de-hardcode)"
```

---

## Task 18: Convert `maintenance` (Class-B, client-side filter + tenant-less insert)

**Files:**
- Modify: `app/maintenance/page.tsx` (FALLBACK at 6; `resolveTenantId` at 62-82; `tenantId` state at 47; loadData at 84-146; createRecord at 158-224; vehicle updates at 197-218, 231-235; init effect at 257-265)

- [ ] **Step 1: Remove Class-B resolver, add context**

Delete `FALLBACK_TENANT_ID` (6), `resolveTenantId()` (62-82), and the `tenantId` state (47). Add imports and `const tenant = useTenant();`.

- [ ] **Step 2: `loadData` reads + client-side filter**

Change `loadData` to take no argument and use the context. Vehicles read (lines 92-96) -> `tenant.filterByTenant(supabase.from("vehicles").select("id, tenant_id, registration, vehicle_type, make, model, active")).order("registration", { ascending: true })`. The `maintenance_records` read stays as-is (no `.eq`), but replace the client-side filter (lines 139-141) with:

```tsx
        const activeId = tenant.activeTenantId;
        const filteredMaintenance = activeId
          ? normalizedMaintenance.filter((record) => record.vehicles?.tenant_id === activeId)
          : normalizedMaintenance; // "All": RLS already scoped to the company
```

- [ ] **Step 3: Effect + create guard**

Replace the init effect (257-265):

```tsx
  useEffect(() => {
    loadData();
  }, [tenant.activeTenantId]);
```

In `createRecord`, replace the `if (!tenantId)` guard (162-165) with:

```tsx
    if (!tenant.writeTenantId) {
      setMessage("Pick a specific tenant to create records.");
      return;
    }
```

Add `tenant_id` to the insert payload (line 179-189): add `tenant_id: tenant.writeTenantId,` as the first field.

- [ ] **Step 4: Vehicle VOR/roadworthy updates**

These update `vehicles` by `id` (setting `active`). Remove the `.eq("tenant_id", tenantId)` clause from the three vehicle updates (lines ~202, ~217, ~235); RLS scopes them by `id`. Replace the `if (!tenantId) return;` in `markVehicleRoadworthy` (227) with nothing needed (the button only shows for loaded rows), or guard on `tenant.status === "ready"`.

- [ ] **Step 5: Gate + typecheck + build**

Wrap the returned `<main>` in `<TenantGate>`. Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/maintenance/page.tsx
git commit -m "feat: maintenance resolves tenant + fixes client-side filter/insert (de-hardcode)"
```

---

## Task 19: Convert `pod` (per-row tenant for storage path + update scope)

**Files:**
- Modify: `app/pod/page.tsx` (constant at 6; jobs read at 78; job_stops sub-select at 61-76; uploadFile at 127-164; savePod at 166-235; onChange callers at 393,435)

- [ ] **Step 1: Imports + context + read**

Delete line 6 (`const TENANT_ID`; keep `POD_BUCKET`). Add imports + `const tenant = useTenant();`.

Add `tenant_id` to the `job_stops` sub-select (inside the select at lines 61-76, add `tenant_id,` to the stop fields). Wrap the jobs read (lines 51-79) so the outer builder is `tenant.filterByTenant(supabase.from("jobs").select(\`...\`))` and delete the `.eq("tenant_id", TENANT_ID)` at line 78. Add `tenant.activeTenantId` to the load effect deps (112).

Carry the stop's tenant into `nextForms` so it is available to handlers, e.g. add `tenant_id: stop.tenant_id` to each `nextForms[stop.id]` object (lines 98-103).

- [ ] **Step 2: Storage path from the row's own tenant**

Change `uploadFile` to take the stop's tenant and guard on it. New signature and path (lines 127-136):

```tsx
  async function uploadFile(file: any, stopId: any, stopTenantId: any, fieldName: any) {
    if (!file) return;
    if (!stopTenantId) {
      setMessage("This stop has no tenant; cannot upload.");
      return;
    }

    setUploadingField(`${stopId}-${fieldName}`);
    setMessage("");

    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const filePath = `${stopTenantId}/${stopId}/${fieldName}-${Date.now()}-${safeName}`;
```

Update the two `onChange` callers (lines ~393 and ~435) to pass `stop.tenant_id`:

```tsx
                                  uploadFile(e.target.files?.[0], stop.id, stop.tenant_id, "pod_photo_url")
```
```tsx
                                  uploadFile(e.target.files?.[0], stop.id, stop.tenant_id, "pod_document_url")
```

- [ ] **Step 3: `savePod` update scopes (R7)**

Remove the `.eq("tenant_id", TENANT_ID)` clauses from the three queries in `savePod`: the `job_stops` update (line 195), the delivery-stops select (line 212), and the `jobs` update (line 226). Each already filters by `id`/`job_id`; RLS scopes them. Do not add `tenant_id` to any update payload.

- [ ] **Step 4: Gate + typecheck + build**

Wrap the returned `<main>` in `<TenantGate>`. Run: `npm run typecheck && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/pod/page.tsx
git commit -m "feat: pod page uses per-row tenant for storage path + scopes (de-hardcode)"
```

---

## Task 20: Full verification

**Files:** none (verification only)

- [ ] **Step 1: No hardcoded tenant remains in app code**

Run: `git grep -n "2f7cc0dc" -- app lib`
Expected: no matches (matches in `docs/sql` reseed comments are fine).

Run: `git grep -n "FALLBACK_TENANT_ID\|resolveTenantId" -- app lib`
Expected: no matches.

- [ ] **Step 2: Tests, typecheck, build all green**

Run: `npm test && npm run typecheck && npm run build`
Expected: vitest passes (including the `lib/tenant` suites), typecheck clean, build succeeds.

- [ ] **Step 3: DB is live (Ethan)**

Confirm Ethan has run `rls_07`, `rls_08`, and the updated `rls_09` harness, and that P1-P14 pass (P13/P14 the new null/foreign probes).

- [ ] **Step 4: Functional matrix (manual, `npm run dev`)**

Sign in as each role and confirm:
- **Staff:** no selector; every page shows only their tenant; creating a record stamps their tenant.
- **Admin:** selector defaults to "All tenants" showing company-wide; picking a tenant filters AND reloads lists + FK dropdowns; create is disabled on "All" and stamps the chosen tenant when specific; editing a listed record does not change its `tenant_id`.
- **Super:** selector lists all tenants; same create/edit rules.
- **Blocked:** a profile with no home tenant shows the `no-tenant` panel with no data and no create.
- **Auth change:** signing out clears the rendered rows and selection without a manual reload.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: tenant de-hardcode verification fixes"
```

---

## Notes for the executor

- Ethan applies all SQL in Supabase himself. Tasks 1-3 create files and then HALT; do not attempt to run SQL.
- The app code (Tasks 4-19) builds and typechecks without the DB applied. Only Task 20's functional matrix and harness need the DB live.
- Commit after each task. Do not push; Ethan controls pushes.
- No em-dashes in code comments or messages (project convention).
- After this plan lands, the `pod-files` storage bucket lockdown is a separate HIGH-priority brainstorm (private bucket + `storage.objects` tenant policies + signed URLs), per the spec's Non-goals.
