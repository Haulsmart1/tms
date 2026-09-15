"use client";

import {
  createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode,
} from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "../../lib/supabase/browser";
import {
  parseTenantContext, pickInitialActiveTenant, computeWriteTenantId, tenantStorageKey,
  type TenantContextData, type TenantContextValue,
} from "../../lib/tenant/context";
import {
  decideResolveMode, shouldRevalidate, applyRevalidation, preserveActiveTenant,
  type ResolveMode,
} from "../../lib/tenant/revalidate";
import { applyTenantFilter } from "../../lib/tenant/filter";

const TenantContext = createContext<TenantContextValue | null>(null);

/* Ways out of a stuck gate (AUTH-17). A separate context rather than new
   fields on TenantContextValue, which is a checked union in
   lib/tenant/context.ts that every data page narrows on. `failed` means "we
   could not load the account" (network or RPC failure), as distinct from the
   RPC answering no-tenant, which is an account problem. */
export type TenantRecovery = {
  failed: boolean;
  userEmail: string | null;
  retry: () => void;
  signOut: () => Promise<void>;
};

const TenantRecoveryContext = createContext<TenantRecovery | null>(null);

const LOADING: TenantContextData = {
  status: "loading", role: "staff", companyId: null, homeTenantId: null, tenants: [],
};

/* localStorage throws SecurityError in Safari with site data blocked, and in
   some embedded or private contexts (SET-17). A remembered tenant choice is a
   convenience, so a throw must degrade to "nothing remembered", never reject
   resolve() and strand the gate on "Loading...". */
function readPersisted(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePersisted(key: string, value: string | null) {
  try {
    if (typeof window === "undefined") return;
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Not remembered on this device; the in-memory selection still applies.
  }
}

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
  const [failed, setFailed] = useState(false);

  /* The onAuthStateChange callback is registered once and would otherwise close
     over stale state, so the three values it needs live in refs. */
  const userIdRef = useRef<string | null>(null);
  const hasReadyRef = useRef(false);
  const lastResolvedAtRef = useRef<number | null>(null);

  /* Latest call wins (SET-17). SIGNED_OUT then SIGNED_IN for a different
     account in quick succession starts two resolves; without a sequence the
     older response could land last and show the previous user's tenants.
     Every await below is followed by a staleness check. */
  const resolveSeqRef = useRef(0);
  /* True while a blocking resolve is unfinished. A background resolve that
     supersedes it is promoted to blocking: background mode leaves `data`
     alone on failure, which would otherwise strand the gate on the LOADING
     the superseded call already set. */
  const blockingPendingRef = useRef(false);

  const resolve = useCallback(async (requestedMode: Exclude<ResolveMode, "skip">) => {
    const seq = ++resolveSeqRef.current;
    const background = requestedMode === "background" && !blockingPendingRef.current;
    const mode: Exclude<ResolveMode, "skip"> = background ? "background" : "blocking";
    const isStale = () => seq !== resolveSeqRef.current;

    /* The one line that caused the bug. In background mode we leave `data`
       alone, so status never dips to "loading", so TenantGate never swaps the
       page out for its panel, so nothing the user typed is unmounted. */
    if (!background) {
      blockingPendingRef.current = true;
      setFailed(false);
      setData(LOADING);
    }

    try {
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
        if (isStale()) return;
        console.warn("tenant resolve: getUser failed", { mode, err });
        /* Could not check. Background keeps the last-good context. Blocking
           used to sit on the loading panel with no way out; it now reports a
           failure the gate offers Retry for, still without treating a flaky
           connection as signed out. */
        if (!background) {
          hasReadyRef.current = false;
          setFailed(true);
        }
        return;
      }

      if (isStale()) return;

      if (!user) {
        userIdRef.current = null;
        hasReadyRef.current = false;
        lastResolvedAtRef.current = Date.now();
        setUserId(null);
        setUserEmail(null);
        setFailed(false);
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
        if (isStale()) return;
        console.warn("tenant resolve: get_tenant_context failed", { mode, err });
        if (background) return; // transient: keep the last-good context
        /* The context is no longer trustworthy, so the next auth event must be
           allowed to rebuild it rather than being judged a throttled background
           revalidate against a stale timestamp. Status stays fail-closed
           (no-tenant); `failed` tells the gate this was an outage, not an
           unlinked account (AUTH-17). */
        hasReadyRef.current = false;
        setUserEmail(user.email ?? null);
        setFailed(true);
        setData({ ...LOADING, status: "no-tenant" });
        setActiveTenantIdState(null);
        return;
      }

      if (isStale()) return;

      const parsed = parseTenantContext(raw);
      const persisted = readPersisted(tenantStorageKey(user.id));

      userIdRef.current = user.id;
      hasReadyRef.current = parsed.status === "ready";
      lastResolvedAtRef.current = Date.now();
      setUserId(user.id);
      setUserEmail(user.email ?? null);
      setFailed(false);

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
    } finally {
      if (!isStale()) blockingPendingRef.current = false;
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
    if (userId) writePersisted(tenantStorageKey(userId), id);
  }, [userId]);

  const retry = useCallback(() => {
    void resolve("blocking");
  }, [resolve]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn("tenant gate: sign out failed", err);
    }
    /* SIGNED_OUT normally triggers this too; resolving directly covers a
       sign-out whose network call failed after clearing the local session. */
    void resolve("blocking");
  }, [resolve, supabase]);

  const writeTenantId = computeWriteTenantId(data.role, data.homeTenantId, activeTenantId);

  /* Built as two branches rather than one object with an optional field. An
     optional `filterByTenant?` on the shared type is the one edit here that
     would silently undo the union, because it type-checks at every call site
     without anyone narrowing first.

     Two things in this block look load-bearing and are not. Both were checked
     against tsc, recorded here so nobody re-derives them:
       - `status: data.status` compiles in place of the literal, because the
         condition narrows the property access. The literal is intent, not
         necessity.
       - Hoisting filterByTenant into `base` also compiles, and still refuses
         every unnarrowed call site, because the TYPE is what guards. It only
         leaves a live filter on unresolved contexts at runtime, which is
         untidy rather than dangerous.
     The guard is the type, not the shape of this expression. */
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

  const recovery: TenantRecovery = { failed, userEmail, retry, signOut };

  return (
    <TenantContext.Provider value={value}>
      <TenantRecoveryContext.Provider value={recovery}>{children}</TenantRecoveryContext.Provider>
    </TenantContext.Provider>
  );
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within a TenantProvider");
  return ctx;
}

export function useTenantRecovery(): TenantRecovery {
  const ctx = useContext(TenantRecoveryContext);
  if (!ctx) throw new Error("useTenantRecovery must be used within a TenantProvider");
  return ctx;
}
