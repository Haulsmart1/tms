import { describe, expect, it } from "vitest";
import { DECISION_LIMITS, INVALID_REQUEST, STALE_PAGE, evidenceIp, parseQuotationDecision } from "./publicDecision";

const HASH = "a".repeat(64);
const BEL = String.fromCodePoint(7);
const ACCEPT = {
  action: "accept",
  name: " Jane Smith ",
  email: "jane@acme.example",
  companyName: "Acme Ltd - Freight",
  position: "Head of Buying",
  clauseKeys: ["1", "2", "2", " "],
  adrAccepted: true,
  snapshotHash: HASH,
};

describe("parseQuotationDecision", () => {
  it("rejects null, arrays and primitives instead of throwing", () => {
    for (const body of [null, undefined, [], "accept", 42]) {
      expect(parseQuotationDecision(body)).toEqual({ ok: false, error: INVALID_REQUEST });
    }
  });

  it("accepts a well-formed acceptance with spaces and hyphens, trimming and de-duplicating", () => {
    expect(parseQuotationDecision(ACCEPT)).toEqual({
      ok: true,
      value: {
        action: "accept",
        name: "Jane Smith",
        email: "jane@acme.example",
        companyName: "Acme Ltd - Freight",
        position: "Head of Buying",
        clauseKeys: ["1", "2"],
        adrAccepted: true,
        snapshotHash: HASH,
      },
    });
  });

  it("bounds every string and the clause array", () => {
    expect(parseQuotationDecision({ ...ACCEPT, name: "x".repeat(DECISION_LIMITS.name + 1) }).ok).toBe(false);
    expect(parseQuotationDecision({ ...ACCEPT, companyName: "x".repeat(DECISION_LIMITS.companyName + 1) }).ok).toBe(false);
    expect(parseQuotationDecision({ ...ACCEPT, clauseKeys: Array(DECISION_LIMITS.clauseKeys + 1).fill("1") })).toEqual({
      ok: false,
      error: INVALID_REQUEST,
    });
    expect(parseQuotationDecision({ ...ACCEPT, clauseKeys: [{}] }).ok).toBe(false);
    expect(parseQuotationDecision({ ...ACCEPT, name: { toString: () => "x" } })).toEqual({ ok: false, error: INVALID_REQUEST });
    expect(parseQuotationDecision({ ...ACCEPT, adrAccepted: "yes" })).toEqual({ ok: false, error: INVALID_REQUEST });
  });

  it("rejects control characters inside a field", () => {
    expect(parseQuotationDecision({ ...ACCEPT, position: `Buyer${BEL}Manager` })).toEqual({
      ok: false,
      error: "Position contains characters that are not allowed.",
    });
  });

  it("validates the email address and requires company and position only to accept", () => {
    expect(parseQuotationDecision({ ...ACCEPT, email: "not-an-email" })).toEqual({
      ok: false,
      error: "Enter a valid email address.",
    });
    expect(parseQuotationDecision({ ...ACCEPT, companyName: "" })).toEqual({ ok: false, error: "Company name is required." });
    expect(parseQuotationDecision({ action: "decline", name: "Jane", email: "jane@acme.example" })).toEqual({
      ok: true,
      value: { action: "decline", name: "Jane", email: "jane@acme.example" },
    });
  });

  it("asks a page without a snapshot hash to reload", () => {
    expect(parseQuotationDecision({ ...ACCEPT, snapshotHash: undefined })).toEqual({ ok: false, error: STALE_PAGE });
  });

  it("recognises view and rejects unknown actions", () => {
    expect(parseQuotationDecision({ action: "VIEW" })).toEqual({ ok: true, value: { action: "view" } });
    expect(parseQuotationDecision({ action: "delete" }).ok).toBe(false);
  });
});

describe("evidenceIp", () => {
  it("prefers the platform header and ignores values that are not IP addresses", () => {
    expect(evidenceIp(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
    expect(evidenceIp(new Headers({ "x-forwarded-for": "2001:db8::1, 10.0.0.1" }))).toBe("2001:db8::1");
    expect(evidenceIp(new Headers({ "x-real-ip": "not-an-ip", "x-forwarded-for": "evil; drop" }))).toBeNull();
    expect(evidenceIp(new Headers())).toBeNull();
  });
});
