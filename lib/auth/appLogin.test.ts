import { expect, it } from "vitest";
import { installedAppLoginPath, readPastedLoginLink } from "./appLogin";

const origin = "https://tmswizard.cloud";

it("routes each installed app to its own sign-in screen", () => {
  expect(installedAppLoginPath("/driver/dashboard")).toBe("/driver/login");
  expect(installedAppLoginPath("/warehouse")).toBe("/warehouse/login");
  expect(installedAppLoginPath("/planning")).toBe("/login");
});

it("accepts the TMS email link and rejects other origins and token types", () => {
  expect(readPastedLoginLink(`${origin}/auth/confirm?type=email&token_hash=test-token`, origin))
    .toEqual({ type: "email", tokenHash: "test-token" });
  expect(readPastedLoginLink("https://example.test/auth/confirm?type=email&token_hash=test-token", origin)).toBeNull();
  expect(readPastedLoginLink(`${origin}/auth/confirm?type=recovery&token_hash=test-token`, origin)).toBeNull();
});

it("accepts the configured Auth provider's verification link only", () => {
  const provider = "https://auth.example.test";
  const path = "/auth/v1/verify?type=magiclink&token=fixture-hash";
  expect(readPastedLoginLink(provider + path, origin, provider))
    .toEqual({ type: "magiclink", tokenHash: "fixture-hash" });
  expect(readPastedLoginLink("https://other.example.test" + path, origin, provider)).toBeNull();
});
