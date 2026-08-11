"use client";

import {
  createContext, useContext, useEffect, useState, useCallback, type ReactNode,
} from "react";
import { createClient } from "../../lib/supabase/browser";
import {
  parseTenantContext, pickInitialActiveTenant, computeWriteTenantId, tenantStorageKey,
  type TenantContextData, type TenantOption, type TenantRole, type TenantStatus,
} from "../../lib/tenant/context";
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

  const resolve = useCallback(async () => {
    setData(LOADING);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUserId(null);
      setUserEmail(null);
      setData({ ...LOADING, status: "signed-out" });
      setActiveTenantIdState(null);
      return;
    }
    setUserId(user.id);
    setUserEmail(user.email ?? null);
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
