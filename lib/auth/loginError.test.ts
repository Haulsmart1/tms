import { describe, expect, it } from "vitest";
import { authVerificationErrorCode, loginErrorMessage } from "./loginError";

describe("login recovery guidance", () => {
  it("does not pretend Auth can distinguish consumption from expiry", () => {
    expect(authVerificationErrorCode({ code: "otp_expired" })).toBe("link_unavailable");
    const message = loginErrorMessage("link_unavailable");
    expect(message).toContain("already been used, has expired, or is invalid");
    expect(message).toContain("does not transfer");
    expect(message).toContain("do not need another invitation");
  });
  it("gives different recovery for PKCE, infrastructure and session failures", () => {
    expect(loginErrorMessage("browser_context")).toContain("browser where you started");
    expect(loginErrorMessage("bad_code_verifier")).toContain("browser where you started");
    expect(loginErrorMessage("auth_config")).toContain("temporarily unavailable");
    expect(loginErrorMessage("user")).toContain("signed-in session");
    expect(loginErrorMessage(null)).toBe("");
    expect(authVerificationErrorCode({ code: "unknown" })).toBe("auth");
  });
});
