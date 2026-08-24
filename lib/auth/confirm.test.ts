import { describe, expect, it } from "vitest";
import {
  isMagicLinkEmailType,
  isValidMagicLinkTokenHash,
  safeAuthNextPath,
} from "./confirm";

describe("safeAuthNextPath", () => {
  const origin = "https://tmswizard.cloud";

  it("defaults to the dashboard", () => {
    expect(
      safeAuthNextPath(null, origin),
    ).toBe("/dashboard");
  });

  it("allows a same-origin relative path", () => {
    expect(
      safeAuthNextPath(
        "/driver/dashboard?tab=today",
        origin,
      ),
    ).toBe("/driver/dashboard?tab=today");
  });

  it("rejects an external URL", () => {
    expect(
      safeAuthNextPath(
        "https://evil.example/steal",
        origin,
      ),
    ).toBe("/dashboard");
  });

  it("rejects malformed input safely", () => {
    expect(
      safeAuthNextPath(
        "https://[broken",
        origin,
      ),
    ).toBe("/dashboard");
  });
});

describe("isValidMagicLinkTokenHash", () => {
  it("accepts a normal Supabase token hash", () => {
    expect(
      isValidMagicLinkTokenHash(
        "pkce_0123456789abcdef0123456789abcdef",
      ),
    ).toBe(true);
  });

  it("rejects missing tokens", () => {
    expect(
      isValidMagicLinkTokenHash(null),
    ).toBe(false);
  });

  it("rejects whitespace-bearing values", () => {
    expect(
      isValidMagicLinkTokenHash(
        "pkce_bad token",
      ),
    ).toBe(false);
  });

  it("rejects unreasonably large values", () => {
    expect(
      isValidMagicLinkTokenHash(
        "x".repeat(513),
      ),
    ).toBe(false);
  });
});

describe("isMagicLinkEmailType", () => {
  it("accepts the email magic-link type", () => {
    expect(
      isMagicLinkEmailType("email"),
    ).toBe(true);
  });

  it("rejects other OTP types for this confirmation flow", () => {
    expect(
      isMagicLinkEmailType("recovery"),
    ).toBe(false);

    expect(
      isMagicLinkEmailType(null),
    ).toBe(false);
  });
});
