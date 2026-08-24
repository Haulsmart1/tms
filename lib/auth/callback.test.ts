import { describe, expect, it } from "vitest";
import {
  authCallbackRedirectStatus,
  decideAuthCallbackVerification,
} from "./callback";

describe("decideAuthCallbackVerification", () => {
  it("continues normally when token verification succeeds", () => {
    expect(
      decideAuthCallbackVerification(false, false),
    ).toBe("verified");
  });

  it("does not need replay recovery after successful verification even if a session exists", () => {
    expect(
      decideAuthCallbackVerification(false, true),
    ).toBe("verified");
  });

  it("rejects an expired or invalid token when no authenticated session exists", () => {
    expect(
      decideAuthCallbackVerification(true, false),
    ).toBe("reject");
  });

  it("recovers a replay only when Supabase independently confirms an authenticated session", () => {
    expect(
      decideAuthCallbackVerification(true, true),
    ).toBe("recover-existing-session");
  });
});

describe("authCallbackRedirectStatus", () => {
  it("uses 303 after a POST so the browser follows with GET", () => {
    expect(
      authCallbackRedirectStatus("POST"),
    ).toBe(303);
  });

  it("keeps legacy GET redirects method-preserving", () => {
    expect(
      authCallbackRedirectStatus("GET"),
    ).toBe(307);
  });
});
