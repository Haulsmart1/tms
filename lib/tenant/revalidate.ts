import type { AuthChangeEvent } from "@supabase/supabase-js";
import type { TenantContextData } from "./context";

export type ResolveMode = "blocking" | "background" | "skip";

/* A background revalidate costs two Supabase round trips. Tab-switching fires
   an auth event every single time the tab becomes visible, so without this
   floor a user alt-tabbing between the TMS and a spreadsheet would hammer the
   API. Five minutes is short enough that a role or tenant-access change made
   elsewhere still lands promptly. */
export const REVALIDATE_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function decideResolveMode(input: {
  event: AuthChangeEvent;
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
  /* A negative delta means the clock moved backwards (system clock change,
     device sleep/wake skew, and similar). Treat that as too soon rather than
     overdue, so a wonky clock cannot trigger a burst of revalidates. */
  return now - lastResolvedAt >= minIntervalMs;
}

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
