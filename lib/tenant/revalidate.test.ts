import { describe, it, expect } from "vitest";
import {
  decideResolveMode,
  shouldRevalidate,
  REVALIDATE_MIN_INTERVAL_MS,
  applyRevalidation,
  tenantContextEquals,
  preserveActiveTenant,
} from "./revalidate";
import type { TenantContextData } from "./context";

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
    expect(
      decideResolveMode({ event: "PASSWORD_RECOVERY", ...ready, eventUserId: "u1" })
    ).toBe("skip");
    expect(
      decideResolveMode({
        event: "MFA_CHALLENGE_VERIFIED",
        ...ready,
        eventUserId: "u1",
      })
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

  it("notices a tenant added", () => {
    expect(
      tenantContextEquals(READY, {
        ...READY,
        tenants: [...READY.tenants, { id: "t3", name: "Depot C" }],
      })
    ).toBe(false);
  });

  it("notices a tenant removed", () => {
    expect(tenantContextEquals(READY, { ...READY, tenants: [READY.tenants[0]] }))
      .toBe(false);
  });

  it("notices a tenant renamed", () => {
    expect(
      tenantContextEquals(READY, {
        ...READY,
        tenants: [{ id: "t1", name: "Depot A (renamed)" }, READY.tenants[1]],
      })
    ).toBe(false);
  });

  it("notices a tenant reordered", () => {
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
