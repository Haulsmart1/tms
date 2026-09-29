import { describe, expect, it } from "vitest";
import { WALKAROUND_QR_PREFIX, encodeQrPayload, normalizeRegistration, parseQrPayload, registrationsMatch } from "./qrToken";
import { generateQrToken, hashQrToken } from "./qrTokenServer";

describe("QR payload", () => {
  it("round-trips a generated token", () => {
    const token = generateQrToken();
    expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(encodeQrPayload(token)).toBe(`${WALKAROUND_QR_PREFIX}${token}`);
    expect(parseQrPayload(encodeQrPayload(token))).toBe(token);
  });

  it("accepts surrounding space and a lower-case payload", () => {
    expect(parseQrPayload("  tmsw1:0123456789abcdef ")).toBe("0123456789ABCDEF");
  });

  it("rejects anything else", () => {
    expect(parseQrPayload("https://example.com")).toBeNull();
    expect(parseQrPayload("TMSW1:SHORT")).toBeNull();
    expect(parseQrPayload("TMSW1:0123456789ABCDEU")).toBeNull(); // U is not Crockford base32
  });

  it("generates distinct tokens", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateQrToken));
    expect(tokens.size).toBe(200);
  });

  it("hashes deterministically to hex", () => {
    expect(hashQrToken("0123456789ABCDEF")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashQrToken("0123456789ABCDEF")).toBe(hashQrToken("0123456789ABCDEF"));
  });
});

describe("registrations", () => {
  it("normalises spacing and case", () => {
    expect(normalizeRegistration(" ab12 cde ")).toBe("AB12CDE");
    expect(registrationsMatch("AB12 CDE", "ab12cde")).toBe(true);
    expect(registrationsMatch("AB12 CDE", "AB12 CDF")).toBe(false);
    expect(registrationsMatch("", "")).toBe(false);
  });
});
