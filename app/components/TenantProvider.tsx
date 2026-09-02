"use client";

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
  const supabase = createClient();
  const [data, setData] = useState<TenantContextData>(LOADING);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [activeTenantId, setActiveTenantIdState] = useState<string | null>(null);

  /* The onAuthStateChange callback is registered once and would otherwise close
     over stale state, so the three values it needs live in refs. */
  const userIdRef = useRef<string | null>(null);
  const hasReadyRef = useRef(false);
  const lastResolvedAtRef = useRef<number | null>(null);

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
