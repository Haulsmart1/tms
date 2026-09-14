import { describe, expect, it } from "vitest";
import { confirmRedirectUrl, normalizeLoginEmail } from "./magicLink";

describe("normalizeLoginEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeLoginEmail("  Ops@Haulier.CO.uk ")).toBe("ops@haulier.co.uk");
  });

  it.each([null, undefined, 42, "", "   ", "no-at-sign", "a@b", "two@@x.com", "sp ace@x.com"])(
    "rejects %s",
    (value) => {
      expect(normalizeLoginEmail(value)).toBeNull();
    },
  );

  it("rejects oversized input", () => {
    expect(normalizeLoginEmail(`${"a".repeat(320)}@x.com`)).toBeNull();
  });
});

describe("confirmRedirectUrl", () => {
  const origin = "https://tmswizard.cloud";

  it("defaults to the dashboard", () => {
    expect(confirmRedirectUrl(origin, undefined)).toBe(`${origin}/auth/confirm?next=%2Fdashboard`);
  });

  it("keeps a same-origin deep link, query included", () => {
    expect(confirmRedirectUrl(origin, "/jobs?id=7&tab=pod")).toBe(
      `${origin}/auth/confirm?next=${encodeURIComponent("/jobs?id=7&tab=pod")}`,
    );
  });

  it.each(["https://evil.example/x", "//evil.example", "/\\evil.example"])(
    "drops an off-origin next %s",
    (next) => {
      expect(confirmRedirectUrl(origin, next)).toBe(`${origin}/auth/confirm?next=%2Fdashboard`);
    },
  );
});
