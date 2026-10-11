import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fake = vi.hoisted(() => ({
  verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn(),
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
    return { auth: fake };
  });
  fake.getUser.mockResolvedValue({ data: { user: { id: "fixture-user" } }, error: null });
  fake.createAdminClient.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }) });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("real callback handler with isolated Auth fixtures", () => {
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
    expect(location(await POST(post("invite", "fixture-session=signed-in"))).pathname).toBe("/jobs");
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
