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
