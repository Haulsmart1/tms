import { describe, expect, it } from "vitest";
import {
  evaluatePodShare,
  generatePodShareToken,
  hashPodShareToken,
  isShareableJobStatus,
  isWellFormedPodShareToken,
} from "./shareLinks";
import { checkPodRecipient, normalizeEmail, splitStoredEmails } from "./emailRecipients";
import { NEUTRAL_CARRIER_NAME, resolvePodBranding } from "./branding";

describe("POD share tokens", () => {
  it("are opaque, well formed and unique", () => {
    const a = generatePodShareToken();
    const b = generatePodShareToken();
    expect(isWellFormedPodShareToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/tenant|job|\./i);
  });

  it("reject the legacy HMAC format and junk", () => {
    const legacy = `${Buffer.from(JSON.stringify({ jobId: "j", tenantId: "t", expiresAt: 9e9 })).toString("base64url")}.sig`;
    expect(isWellFormedPodShareToken(legacy)).toBe(false);
    expect(isWellFormedPodShareToken("pod_short")).toBe(false);
    expect(isWellFormedPodShareToken(null)).toBe(false);
  });

  it("hash deterministically and never equal the token", () => {
    const token = generatePodShareToken();
    expect(hashPodShareToken(token)).toBe(hashPodShareToken(token));
    expect(hashPodShareToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("evaluatePodShare", () => {
  const now = new Date("2026-09-14T12:00:00Z");

  it("accepts a live link", () => {
    expect(evaluatePodShare({ expires_at: "2026-09-15T00:00:00Z", revoked_at: null }, now)).toEqual({ ok: true });
  });

  it("refuses missing, revoked and expired links", () => {
    expect(evaluatePodShare(null, now)).toEqual({ ok: false, reason: "missing" });
    expect(evaluatePodShare({ expires_at: "2026-09-15T00:00:00Z", revoked_at: "2026-09-14T11:00:00Z" }, now)).toEqual({ ok: false, reason: "revoked" });
    expect(evaluatePodShare({ expires_at: "2026-09-14T12:00:00Z", revoked_at: null }, now)).toEqual({ ok: false, reason: "expired" });
    expect(evaluatePodShare({ expires_at: "garbage", revoked_at: null }, now)).toEqual({ ok: false, reason: "expired" });
  });

  it("only shares completed jobs", () => {
    expect(isShareableJobStatus("completed")).toBe(true);
    expect(isShareableJobStatus("planned")).toBe(false);
    expect(isShareableJobStatus("cancelled")).toBe(false);
  });
});

describe("checkPodRecipient", () => {
  const customerEmailFields = ["Ops@Customer.co.uk", "accounts@customer.co.uk; boss@customer.co.uk", null];

  it("allows the customer's stored addresses, case-insensitively", () => {
    expect(checkPodRecipient({ requested: " ops@customer.co.uk ", customerEmailFields, callerEmail: null })).toEqual({ ok: true, recipient: "ops@customer.co.uk" });
    expect(checkPodRecipient({ requested: "boss@customer.co.uk", customerEmailFields, callerEmail: null })).toMatchObject({ ok: true });
  });

  it("allows the caller's own address", () => {
    expect(checkPodRecipient({ requested: "me@haulier.com", customerEmailFields, callerEmail: "Me@Haulier.com" })).toMatchObject({ ok: true });
  });

  it("refuses any other address", () => {
    expect(checkPodRecipient({ requested: "victim@example.com", customerEmailFields, callerEmail: "me@haulier.com" })).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses malformed and header-injecting input", () => {
    expect(checkPodRecipient({ requested: "ops@customer.co.uk\r\nBcc: x@y.z", customerEmailFields, callerEmail: null })).toMatchObject({ ok: false, status: 400 });
    expect(checkPodRecipient({ requested: 42, customerEmailFields, callerEmail: null })).toMatchObject({ ok: false, status: 400 });
  });

  it("normalizes and splits stored fields", () => {
    expect(normalizeEmail("A@B.CO")).toBe("a@b.co");
    expect(normalizeEmail("not an email")).toBeNull();
    expect(splitStoredEmails("a@b.co, bad, c@d.co")).toEqual(["a@b.co", "c@d.co"]);
  });
});

describe("resolvePodBranding", () => {
  it("prefers trading name, then profile name, then company name", () => {
    expect(resolvePodBranding({ tradingName: " Swift Haul ", companyProfileName: "Swift Ltd", companyName: "Co" }).carrierName).toBe("Swift Haul");
    expect(resolvePodBranding({ tradingName: "", companyProfileName: "Swift Ltd", companyName: "Co" }).carrierName).toBe("Swift Ltd");
    expect(resolvePodBranding({ companyName: "Co" }).carrierName).toBe("Co");
  });

  it("never falls back to another company's name", () => {
    expect(resolvePodBranding({})).toEqual({ carrierName: NEUTRAL_CARRIER_NAME, footerText: null });
  });
});
