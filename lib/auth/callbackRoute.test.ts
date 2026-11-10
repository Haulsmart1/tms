import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fake = vi.hoisted(() => ({
  setSession: vi.fn(), verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn(),
  createServerClient: vi.fn(), createAdminClient: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: fake.createServerClient }));
vi.mock("../supabase/admin", () => ({ createAdminClient: fake.createAdminClient }));
import { GET, POST } from "../../app/api/auth/callback/route";

const origin = "https://tmswizard.cloud";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function post(type = "email", cookie = "") {
  return new NextRequest(`${origin}/api/auth/callback`, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ token_hash: "fixture-token", type, next: "/jobs" }),
  });
}
function location(response: Response) { return new URL(response.headers.get("location")!); }

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-public-key");
  fake.createServerClient.mockImplementation((_url, _key, options) => {
    fake.verifyOtp.mockImplementation(async () => {
      options.cookies.setAll([{ name: "fixture-session", value: "signed-in", options: { path: "/", sameSite: "lax" } }]);
      return { error: null };
    });
    fake.setSession.mockImplementation(async () => {
      options.cookies.setAll([{ name: "fixture-session", value: "fragment-session", options: { path: "/", sameSite: "lax" } }]);
      return { error: null };
    });
    return { auth: fake };
  });
  fake.getUser.mockResolvedValue({ data: { user: { id: "fixture-user" } }, error: null });
  fake.createAdminClient.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("real callback handler with isolated Auth fixtures", () => {
  it.each(["email", "invite", "magiclink"])("does not fall back to the old driver account after a failed %s switch", async type => {
    fake.createServerClient.mockImplementation((_url, _key, options) => {
      fake.verifyOtp.mockImplementation(async () => {
        options.cookies.setAll([{ name: "fixture-session", value: "old-driver", options: { path: "/" } }]);
        return { error: { code: "otp_expired" } };
      });
      return { auth: fake };
    });
    fake.getUser.mockResolvedValue({ data: { user: { id: "old-driver", email: "driver@example.test" } }, error: null });
    const response = await POST(post(type, "fixture-session=old-driver"));
    expect(location(response).pathname).toBe("/login");
    expect(location(response).searchParams.get("error")).toBe("link_unavailable");
    expect(location(response).searchParams.get("next")).toBe("/jobs");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(fake.getUser).not.toHaveBeenCalled();
    expect(fake.createAdminClient).not.toHaveBeenCalled();
  });

  it("does not fall back to an old account after failed PKCE verification", async () => {
    fake.exchangeCodeForSession.mockResolvedValue({ error: { code: "flow_state_expired" } });
    const response = await GET(new NextRequest(`${origin}/api/auth/callback?code=old-code&next=%2Fwarehouse`, {
      headers: { cookie: "fixture-session=old-driver" },
    }));
    expect(location(response).pathname).toBe("/login");
    expect(location(response).searchParams.get("next")).toBe("/warehouse");
    expect(fake.getUser).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("routes a successful account switch using the newly verified office identity", async () => {
    const eq = vi.fn().mockReturnThis();
    const query = { select: vi.fn().mockReturnThis(), eq, limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
    fake.createAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(query) });
    fake.getUser.mockResolvedValue({ data: { user: { id: "new-office-user", email: "warehouse@example.test" } }, error: null });
    const response = await POST(post("email", "fixture-session=old-driver"));
    expect(location(response).pathname).toBe("/jobs");
    expect(eq).toHaveBeenCalledWith("user_id", "new-office-user");
    expect(eq).not.toHaveBeenCalledWith("user_id", "old-driver");
    expect(response.headers.get("set-cookie")).toContain("fixture-session=signed-in");
  });

  it.each(["email", "invite", "magiclink"])("does not issue cookies if the %s user cannot be verified", async type => {
    fake.getUser.mockResolvedValue({ data: { user: null }, error: { code: "bad_jwt" } });
    const response = await POST(post(type));
    expect(location(response).searchParams.get("error")).toBe("user");
    expect(location(response).searchParams.get("next")).toBe("/jobs");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["email", "invite", "magiclink"])("redeems a fresh %s link without any originating browser cookies or verifier", async type => {
    const response = await POST(post(type));
    expect(fake.verifyOtp).toHaveBeenCalledWith({ token_hash: "fixture-token", type });
    expect(fake.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(location(response).pathname).toBe("/jobs");
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toContain("fixture-session=signed-in");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("reproduces Chrome first redemption, Chrome replay, then Safari replay without the Chrome session", async () => {
    expect(location(await POST(post("invite"))).pathname).toBe("/jobs");
    fake.createServerClient.mockReturnValue({ auth: fake });
    fake.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "Token has expired or is invalid" } });
    const replay = await POST(post("invite", "fixture-session=signed-in"));
    expect(location(replay).searchParams.get("error")).toBe("link_unavailable");
    expect(replay.headers.get("set-cookie")).toBeNull();
    fake.getUser.mockResolvedValue({ data: { user: null }, error: { message: "No session" } });
    const safari = await POST(post("invite"));
    expect(location(safari).searchParams.get("error")).toBe("link_unavailable");
    expect(location(safari).searchParams.get("next")).toBe("/jobs");
    expect(safari.status).toBe(303);
    // A newly requested ordinary email link works in the new browser.
    fake.verifyOtp.mockResolvedValue({ error: null });
    fake.getUser.mockResolvedValue({ data: { user: { id: "fixture-user" } }, error: null });
    expect(location(await POST(post())).pathname).toBe("/jobs");
  });

  it.each(["pkce_code_verifier_not_found", "bad_code_verifier", "flow_state_not_found", "flow_state_expired"])("explains legacy PKCE failure %s separately", async code => {
    fake.exchangeCodeForSession.mockResolvedValue({ error: { code } });
    fake.getUser.mockResolvedValue({ data: { user: null }, error: {} });
    const response = await GET(new NextRequest(`${origin}/api/auth/callback?code=fixture-code`));
    expect(fake.exchangeCodeForSession).toHaveBeenCalledWith("fixture-code");
    expect(location(response).searchParams.get("error")).toBe("browser_context");
  });

  it("does not redeem a token on a scanner GET", async () => {
    const response = await GET(new NextRequest(`${origin}/api/auth/callback?token_hash=fixture-token&type=invite`));
    expect(location(response).pathname).toBe("/auth/confirm");
    expect(fake.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin confirmation without contacting Auth", async () => {
    const request = post();
    request.headers.set("origin", "https://other.invalid");
    expect((await POST(request)).status).toBe(403);
    expect(fake.verifyOtp).not.toHaveBeenCalled();
  });
});

function implicitPost(overrides: Record<string, string> = {}, requestOrigin = origin) {
  return new NextRequest(`${origin}/api/auth/callback`, {
    method: "POST", headers: { origin: requestOrigin, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ mode: "implicit", access_token: "header.payload.signature", refresh_token: "fixture-refresh", type: "invite", next: "/warehouse", ...overrides }),
  });
}

it("finishes a default-template invitation from a new Safari browser and sets the verified session cookie", async () => {
  const response = await POST(implicitPost());
  expect(fake.setSession).toHaveBeenCalledExactlyOnceWith({ access_token: "header.payload.signature", refresh_token: "fixture-refresh" });
  expect(fake.getUser).toHaveBeenCalledTimes(1);
  expect(fake.verifyOtp).not.toHaveBeenCalled();
  expect(location(response).pathname).toBe("/warehouse");
  expect(response.status).toBe(303);
  expect(response.headers.get("set-cookie")).toContain("fragment-session");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects a cross-origin fragment POST without installing a session", async () => {
  expect((await POST(implicitPost({}, "https://attacker.invalid"))).status).toBe(403);
  expect(fake.setSession).not.toHaveBeenCalled();
});
it.each([
  { access_token: "" }, { refresh_token: "" }, { access_token: "forged" },
  { access_token: "a".repeat(17000) }, { refresh_token: "a".repeat(5000) }, { type: "recovery" },
] as Record<string, string>[])("rejects incomplete or unsupported fragment credentials", async values => {
  const response = await POST(implicitPost(values));
  expect(location(response).searchParams.get("error")).toBe("invalid_link");
  expect(fake.setSession).not.toHaveBeenCalled();
});
it("never falls back to an unrelated old session when submitted fragment credentials are invalid", async () => {
  fake.createServerClient.mockReturnValue({ auth: fake });
  fake.setSession.mockResolvedValue({ error: { code: "bad_jwt" } });
  const response = await POST(implicitPost());
  expect(location(response).searchParams.get("error")).toBe("link_unavailable");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(fake.getUser).not.toHaveBeenCalled();
});
it("does not issue session cookies when the signed-in user cannot be verified", async () => {
  fake.getUser.mockResolvedValue({ data: { user: null }, error: { code: "bad_jwt" } });
  const response = await POST(implicitPost());
  expect(location(response).searchParams.get("error")).toBe("user");
  expect(response.headers.get("set-cookie")).toBeNull();
});
it("keeps post-login navigation on the TMS origin", async () => {
  const response = await POST(implicitPost({ next: "https://attacker.invalid/" }));
  expect(location(response).origin).toBe(origin);
  expect(location(response).pathname).toBe("/dashboard");
});
it("does not log or return credentials when session verification throws", async () => {
  fake.createServerClient.mockReturnValue({ auth: fake });
  fake.setSession.mockRejectedValue(new Error("secret-credential"));
  const response = await POST(implicitPost());
  expect(response.status).toBe(303);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await response.text()).not.toContain("secret-credential");
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-credential");
});
