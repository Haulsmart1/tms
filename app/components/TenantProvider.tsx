"use client";

import {
  createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode,
} from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "../../lib/supabase/browser";
import {
  parseTenantContext, pickInitialActiveTenant, computeWriteTenantId, tenantStorageKey,
  type TenantContextData, type TenantOption, type TenantRole, type TenantStatus,
} from "../../lib/tenant/context";
import {
  decideResolveMode, shouldRevalidate, applyRevalidation, preserveActiveTenant,
  type ResolveMode,
} from "../../lib/tenant/revalidate";
import { applyTenantFilter } from "../../lib/tenant/filter";

type TenantContextValue = {
  status: TenantStatus;
  role: TenantRole;
  userEmail: string | null;
  tenants: TenantOption[];
  activeTenantId: string | null;
  setActiveTenantId: (id: string | null) => void;
  writeTenantId: string | null;
  filterByTenant: <Q>(query: Q) => Q;
};

const TenantContext = createContext<TenantContextValue | null>(null);

const LOADING: TenantContextData = {
  status: "loading", role: "staff", companyId: null, homeTenantId: null, tenants: [],
};

export function TenantProvider({ children }: { children: ReactNode }) {
  /* Pinned for the component lifetime with a lazy initialiser rather than
     called on every render. `resolve` and the auth-subscription effect both
     depend on this identity, so a client that changed per render would tear
     down and re-establish the subscription on every render while setting
     state. @supabase/ssr happens to cache a browser singleton today, but that
     is its internal detail, not a contract to lean on. */
  const supabase = useState(createClient)[0];
  const [data, setData] = useState<TenantContextData>(LOADING);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);

  /* The onAuthStateChange callback is registered once and would otherwise close
     over stale state, so the three values it needs live in refs. */
  const userIdRef = useRef<string | null>(null);
  const hasReadyRef = useRef(false);
  const lastResolvedAtRef = useRef<number | null>(null);

  const resolve = useCallback(async (mode: Exclude<ResolveMode, "skip">) => {
    const background = mode === "background";
    /* The one line that caused the bug. In background mode we leave `data`
       alone, so status never dips to "loading", so TenantGate never swaps the
       page out for its panel, so nothing the user typed is unmounted. */
    if (!background) setData(LOADING);

    let user: { id: string; email?: string | null } | null = null;
    try {
      const res = await supabase.auth.getUser();
      /* getUser does not throw for network or 5xx failures: it swallows any
         AuthError and hands back a null user. Treating that null as "signed
         out" would bounce someone to /login mid-form on a flaky connection,
         which is the exact failure this change exists to prevent. A genuine
         session-missing error is not retryable, so revoked access still
         reaches the signed-out branch below. */
      if (res.error && isAuthRetryableFetchError(res.error)) throw res.error;
      user = res.data.user;
    } catch (err) {
      console.warn("tenant resolve: getUser failed", { mode, err });
      /* Could not check. Background keeps the last-good context. Blocking stays
         on the loading panel, which is a deliberate change: it used to fall
         through to the signed-out branch and redirect to /login, so a flaky
         connection logged people out. The panel has no retry of its own, so a
         first load that fails here needs a reload or a tab-out and back in. */
      if (!background) hasReadyRef.current = false;
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
    } catch (err) {
      console.warn("tenant resolve: get_tenant_context failed", { mode, err });
      if (background) return; // transient: keep the last-good context
      /* The context is no longer trustworthy, so the next auth event must be
         allowed to rebuild it rather than being judged a throttled background
         revalidate against a stale timestamp. */
      hasReadyRef.current = false;
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
    userEmail,
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
