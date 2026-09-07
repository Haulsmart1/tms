import { describe, expect, it } from "vitest";
import {
  isApiPath,
  isPublicPath,
  normalizePathname,
} from "./publicRoutes";

describe("isPublicPath", () => {
  it.each([
    "/",
    "/login",
    "/auth/confirm",
    "/api/auth/callback",
    "/api/public/quotation-share/abc123",
    "/api/public/quote-request/abc123",
    "/pod/share/abc123",
    "/quotation/share/abc123",
    "/api/pod/share/abc123/pdf",
    "/api/request-access",
    "/api/integrations/cambridge-audio/rma",
    "/api/billing/run",
  ])("allows %s", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/jobs",
    "/invoices",
    "/super-admin",
    "/driver/dashboard",
    "/pod",
    "/settings",
    "/api/jobs",
    "/api/settings/profile",
  ])("denies %s", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  /* The POD share endpoints are the sharp edge: the token-gated PDF read is
     public, but the two endpoints that MINT a share token are staff-only. A
     prefix allowlist would open both. */
  it.each([
    "/api/pod/share",
    "/api/pod/share/email",
    "/api/pod/share/abc123",
    "/api/pod/share/abc123/pdf/extra",
    "/api/pod/share/abc/def/pdf",
  ])("denies the non-public POD share endpoint %s", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  it("does not treat a prefix as a substring match", () => {
    expect(isPublicPath("/loginhack")).toBe(false);
    expect(isPublicPath("/api/publicity")).toBe(false);
    expect(isPublicPath("/pod/shared-secrets")).toBe(false);
  });

  it("resolves traversal before matching", () => {
    expect(
      isPublicPath("/api/pod/share/x/pdf/../../create"),
    ).toBe(false);
    expect(isPublicPath("/login/../jobs")).toBe(false);
    expect(isPublicPath("/jobs/../login")).toBe(true);
  });

  it("ignores duplicate and trailing slashes", () => {
    expect(isPublicPath("//login")).toBe(true);
    expect(isPublicPath("/login/")).toBe(true);
    expect(isPublicPath("/jobs//")).toBe(false);
  });
});

describe("isApiPath", () => {
  it.each(["/api", "/api/jobs", "/api/pod/share"])(
    "treats %s as an API path",
    (path) => {
      expect(isApiPath(path)).toBe(true);
    },
  );

  it.each(["/", "/apiary", "/dashboard"])(
    "treats %s as a page path",
    (path) => {
      expect(isApiPath(path)).toBe(false);
    },
  );
});

describe("normalizePathname", () => {
  it("collapses traversal, duplicate and trailing slashes", () => {
    expect(normalizePathname("/a//b/./c/../d")).toBe("/a/b/d");
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("/a/")).toBe("/a");
  });

  it("cannot escape above the root", () => {
    expect(normalizePathname("/../../etc")).toBe("/etc");
  });
});
