import { describe, expect, it } from "vitest";
import { decideAuthCallbackVerification } from "./callback";

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