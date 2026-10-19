import { afterEach, describe, expect, it, vi } from "vitest";
import { withTenantResolveDeadline, TENANT_RESOLVE_STEP_TIMEOUT_MS } from "./resolveDeadline";

afterEach(() => vi.useRealTimers());

describe("account lookup deadline", () => {
  it("bounds an SDK request which never settles so recovery can render", async () => {
    vi.useFakeTimers();
    const result = withTenantResolveDeadline(new Promise<never>(() => {}));
    const rejected = expect(result).rejects.toThrow("Account lookup timed out");
    await vi.advanceTimersByTimeAsync(TENANT_RESOLVE_STEP_TIMEOUT_MS);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes a successful tenant response through and releases its timer", async () => {
    vi.useFakeTimers();
    const context = { data: { tenant_id: "tenant-a" }, error: null };
    await expect(withTenantResolveDeadline(Promise.resolve(context))).resolves.toBe(context);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a genuine authentication rejection distinguishable from timeout", async () => {
    vi.useFakeTimers();
    const error = new Error("Session revoked");
    await expect(withTenantResolveDeadline(Promise.reject(error))).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("supports lazy PostgREST thenables and does not execute them twice", async () => {
    const start = vi.fn(() => Promise.resolve({ data: "tenant" }));
    const operation: PromiseLike<{ data: string }> = { then: (resolve, reject) => start().then(resolve, reject) };
    await expect(withTenantResolveDeadline(operation)).resolves.toEqual({ data: "tenant" });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not let late completion overwrite a successful retry", async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const old = withTenantResolveDeadline(new Promise<string>((resolve) => { finish = resolve; }));
    const rejected = expect(old).rejects.toThrow("Account lookup timed out");
    await vi.advanceTimersByTimeAsync(TENANT_RESOLVE_STEP_TIMEOUT_MS);
    await rejected;
    const retry = await withTenantResolveDeadline(Promise.resolve("new account"));
    finish("old account");
    await Promise.resolve();
    expect(retry).toBe("new account");
    await expect(old).rejects.toThrow("Account lookup timed out");
    expect(vi.getTimerCount()).toBe(0);
  });
});
