import { describe, expect, it } from "vitest";
import { normalizeEmail, resolveDocumentRecipient } from "./recipients";

describe("normalizeEmail", () => {
  it("lower-cases and trims", () => {
    expect(normalizeEmail("  Accounts@Acme.CO.UK ")).toBe("accounts@acme.co.uk");
  });

  it("rejects header injection and lists", () => {
    expect(normalizeEmail("a@b.com\r\nBcc: x@y.com")).toBeNull();
    expect(normalizeEmail("a@b.com, c@d.com")).toBeNull();
    expect(normalizeEmail("Name <a@b.com>")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});

describe("resolveDocumentRecipient", () => {
  const customer = {
    defaults: ["accounts@acme.com", null, "ops@acme.com"],
    allowed: ["accounts@acme.com", "ops@acme.com", "buyer@acme.com", null],
    callerEmail: "clerk@haulier.com",
  };

  it("uses the first stored default when nothing is requested", () => {
    expect(resolveDocumentRecipient({ ...customer, requested: "" })).toEqual({
      ok: true,
      recipient: "accounts@acme.com",
    });
  });

  it("accepts a contact address or the caller's own address", () => {
    expect(resolveDocumentRecipient({ ...customer, requested: "Buyer@acme.com" })).toEqual({
      ok: true,
      recipient: "buyer@acme.com",
    });
    expect(resolveDocumentRecipient({ ...customer, requested: "clerk@haulier.com" })).toEqual({
      ok: true,
      recipient: "clerk@haulier.com",
    });
  });

  it("refuses an arbitrary address", () => {
    const result = resolveDocumentRecipient({ ...customer, requested: "victim@example.org" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("recipient_not_on_file");
  });

  it("refuses CR/LF in the requested address", () => {
    expect(resolveDocumentRecipient({ ...customer, requested: "accounts@acme.com\nBcc: x@y.com" }).ok).toBe(false);
  });

  it("does not trust a default that is not on file (a poisoned invoice_email)", () => {
    const result = resolveDocumentRecipient({
      requested: "",
      defaults: ["attacker@evil.com"],
      allowed: [],
      callerEmail: null,
    });
    expect(result.ok).toBe(false);
  });
});
