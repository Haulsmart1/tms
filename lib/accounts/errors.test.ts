import { describe, expect, it } from "vitest";
import { AccountsHttpError, isMissingFunctionError, rpcBusinessCode, toErrorResponse } from "./errors";

describe("toErrorResponse", () => {
  it("passes through messages we wrote", () => {
    const res = toErrorResponse(new AccountsHttpError(409, "Invoice is locked.", "invoice_locked"));
    expect(res).toEqual({ status: 409, body: { error: "Invoice is locked.", code: "invoice_locked" } });
  });

  it("maps the auth sentinels", () => {
    expect(toErrorResponse(new Error("UNAUTHENTICATED")).status).toBe(401);
    expect(toErrorResponse(new Error("FORBIDDEN")).status).toBe(403);
  });

  it("never echoes raw database or env text", () => {
    const logged: unknown[] = [];
    const res = toErrorResponse(
      new Error('duplicate key value violates unique constraint "invoices_tenant_number_key"'),
      (_ref, err) => logged.push(err),
    );
    expect(res.status).toBe(500);
    expect(res.body.error).not.toContain("invoices");
    expect(res.body.code).toBe("internal_error");
    expect(res.body.ref).toMatch(/^[a-z0-9]+$/);
    expect(logged).toHaveLength(1);
  });

  it("hides env var names", () => {
    const res = toErrorResponse(
      new Error("ACCOUNTING_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key."),
      () => {},
    );
    expect(res.body.error).not.toContain("ACCOUNTING");
  });
});

describe("rpc helpers", () => {
  it("detects a missing function", () => {
    expect(isMissingFunctionError({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunctionError({ code: "42883" })).toBe(true);
    expect(isMissingFunctionError({ code: "23505" })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });

  it("only recognises known business codes", () => {
    const known = ["invoice_locked", "invoice_not_found"] as const;
    expect(rpcBusinessCode({ message: "invoice_locked" }, known)).toBe("invoice_locked");
    expect(rpcBusinessCode({ message: "relation invoices does not exist" }, known)).toBeNull();
  });
});
