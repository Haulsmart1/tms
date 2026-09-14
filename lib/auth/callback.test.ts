import { describe, expect, it } from "vitest";
import {
  authCallbackRedirectStatus,
  decideAuthCallbackVerification,
  decideLegacyCallbackAction,
  decidePostLoginDestination,
  isPortalPath,
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

describe("decidePostLoginDestination", () => {
  const found = { ok: true, destination: "/driver/dashboard" } as const;
  const none = { ok: true, destination: null } as const;

  it("sends a portal-only user to their portal", () => {
    expect(
      decidePostLoginDestination({ requestedNext: "/dashboard", portal: found, hasConsoleProfile: false }),
    ).toBe("/driver/dashboard");
  });

  it("does not hijack a console user who also has a portal link", () => {
    expect(
      decidePostLoginDestination({ requestedNext: "/jobs?id=1", portal: found, hasConsoleProfile: true }),
    ).toBe("/jobs?id=1");
  });

  it("honours an explicit portal deep link", () => {
    expect(
      decidePostLoginDestination({
        requestedNext: "/subcontractor/dashboard",
        portal: found,
        hasConsoleProfile: true,
      }),
    ).toBe("/subcontractor/dashboard");
  });

  it("keeps next when there is no portal link", () => {
    expect(
      decidePostLoginDestination({ requestedNext: "/invoices", portal: none, hasConsoleProfile: "unknown" }),
    ).toBe("/invoices");
  });

  it("reports a failed portal lookup instead of guessing", () => {
    expect(
      decidePostLoginDestination({ requestedNext: "/dashboard", portal: { ok: false }, hasConsoleProfile: true }),
    ).toBe("/login?error=portal");
  });

  it("reports a failed profile lookup for a portal user", () => {
    expect(
      decidePostLoginDestination({ requestedNext: "/dashboard", portal: found, hasConsoleProfile: "unknown" }),
    ).toBe("/login?error=portal");
  });
});

describe("isPortalPath", () => {
  it.each(["/driver", "/driver/dashboard", "/subcontractor/dashboard?x=1"])("treats %s as a portal", (path) => {
    expect(isPortalPath(path)).toBe(true);
  });

  it.each(["/drivers", "/dashboard", "/subcontractors", "/"])("treats %s as console", (path) => {
    expect(isPortalPath(path)).toBe(false);
  });
});

describe("decideLegacyCallbackAction", () => {
  it("forwards a token_hash to the confirm page without verifying it", () => {
    const action = decideLegacyCallbackAction(
      new URLSearchParams("token_hash=abc123&type=invite&next=/driver/dashboard"),
    );
    expect(action.kind).toBe("confirm");
    if (action.kind !== "confirm") return;
    const url = new URL(action.location, "https://x.test");
    expect(url.pathname).toBe("/auth/confirm");
    expect(url.searchParams.get("token_hash")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("invite");
    expect(url.searchParams.get("next")).toBe("/driver/dashboard");
  });

  it("defaults the type to email", () => {
    const action = decideLegacyCallbackAction(new URLSearchParams("token_hash=abc"));
    expect(action.kind).toBe("confirm");
    if (action.kind !== "confirm") return;
    expect(new URL(action.location, "https://x.test").searchParams.get("type")).toBe("email");
  });

  it("prefers the confirm page even when a code is also present", () => {
    expect(decideLegacyCallbackAction(new URLSearchParams("token_hash=abc&code=xyz")).kind).toBe("confirm");
  });

  it("still exchanges a PKCE code", () => {
    expect(decideLegacyCallbackAction(new URLSearchParams("code=xyz"))).toEqual({
      kind: "exchange-code",
      code: "xyz",
    });
  });

  it.each(["", "token_hash=", "token_hash=a%20b", `token_hash=${"x".repeat(513)}`, "code="])(
    "rejects %s",
    (query) => {
      expect(decideLegacyCallbackAction(new URLSearchParams(query)).kind).toBe("invalid");
    },
  );
});
