import { describe, it, expect } from "vitest";
import { normalizeTenantEdit } from "./tenantEdit";

function ok(input: unknown) {
  const result = normalizeTenantEdit(input);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result;
}

const VALID_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

describe("normalizeTenantEdit", () => {
  it("accepts a rename-only request", () => {
    const result = ok({ name: "Acme Depot" });
    expect(result.name).toBe("Acme Depot");
    expect(result.companyId).toBeUndefined();
  });

  it("accepts a move-only request", () => {
    const result = ok({ company_id: VALID_COMPANY_ID });
    expect(result.companyId).toBe(VALID_COMPANY_ID);
    expect(result.name).toBeUndefined();
  });

  it("accepts a request that renames and moves at once", () => {
    const result = ok({ name: "Acme Depot", company_id: VALID_COMPANY_ID });
    expect(result.name).toBe("Acme Depot");
    expect(result.companyId).toBe(VALID_COMPANY_ID);
  });

  it("rejects a non-object body", () => {
    expect(normalizeTenantEdit(null)).toMatchObject({ ok: false });
    expect(normalizeTenantEdit("nope")).toMatchObject({ ok: false });
    expect(normalizeTenantEdit([])).toMatchObject({ ok: false });
  });

  it("rejects a body with neither field", () => {
    expect(normalizeTenantEdit({})).toMatchObject({ ok: false });
    expect(normalizeTenantEdit({ unrelated: "x" })).toMatchObject({ ok: false });
  });

  it("rejects a name over the length cap", () => {
    // This name renders in the tenant selector on every console page, so an
    // unbounded string is a layout bug waiting to happen, not just a
    // database one.
    const tooLong = "A".repeat(501);
    expect(normalizeTenantEdit({ name: tooLong })).toMatchObject({ ok: false, field: "name" });
    expect(normalizeTenantEdit({ name: "A".repeat(500) })).toMatchObject({ ok: true });
  });

  it("rejects a blank name", () => {
    expect(normalizeTenantEdit({ name: "" })).toMatchObject({ ok: false, field: "name" });
    expect(normalizeTenantEdit({ name: "   " })).toMatchObject({ ok: false, field: "name" });
    expect(normalizeTenantEdit({ name: 123 })).toMatchObject({ ok: false, field: "name" });
  });

  it("trims the name", () => {
    expect(ok({ name: "  Acme Depot  " }).name).toBe("Acme Depot");
  });

  it("rejects a blank or non-string company_id", () => {
    expect(normalizeTenantEdit({ company_id: "" })).toMatchObject({ ok: false, field: "company_id" });
    expect(normalizeTenantEdit({ company_id: "   " })).toMatchObject({ ok: false, field: "company_id" });
    expect(normalizeTenantEdit({ company_id: 123 })).toMatchObject({ ok: false, field: "company_id" });
    expect(normalizeTenantEdit({ company_id: null })).toMatchObject({ ok: false, field: "company_id" });
  });

  it("rejects a company_id that is not a UUID", () => {
    expect(normalizeTenantEdit({ company_id: "not-a-uuid" })).toMatchObject({
      ok: false,
      field: "company_id",
    });
    expect(normalizeTenantEdit({ company_id: "  " + VALID_COMPANY_ID })).toMatchObject({
      ok: true,
    });
  });

  it("never returns a field that was absent from the request", () => {
    // The route tells "rename only" apart from "move" by checking whether
    // companyId/name is present in the result. A stray null/undefined here
    // would make a rename request look indistinguishable from a move.
    const renameOnly = ok({ name: "Acme Depot" });
    expect("companyId" in renameOnly).toBe(false);

    const moveOnly = ok({ company_id: VALID_COMPANY_ID });
    expect("name" in moveOnly).toBe(false);
  });

  it("drops unknown keys silently", () => {
    const result = ok({ name: "Acme Depot", id: "evil", tenant_id: "other", made_up: 1 });
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("tenant_id");
    expect(result).not.toHaveProperty("made_up");
  });
});
