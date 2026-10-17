import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fake = vi.hoisted(() => ({ createServerClient: vi.fn(), getUser: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: fake.createServerClient }));
import { proxy } from "../../proxy";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-public-key");
  fake.createServerClient.mockReturnValue({ auth: { getUser: fake.getUser } });
  fake.getUser.mockResolvedValue({ data: { user: null }, error: { code: "refresh_token_already_used" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("login recovery with stale session cookies", () => {
  it.each(["/login", "/auth/confirm", "/api/auth/magic-link", "/api/auth/callback"])(
    "leaves %s to its own handler without refreshing or deleting cookies", async path => {
      const request = new NextRequest(`https://tmswizard.cloud${path}`, {
        headers: { cookie: "sb-fixture-auth-token=stale; driver-setting=preserve" },
      });
      const response = await proxy(request);
      expect(fake.createServerClient).not.toHaveBeenCalled();
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(request.cookies.get("driver-setting")?.value).toBe("preserve");
    },
  );

  it.each(["/dashboard", "/driver/dashboard", "/api/jobs", "/api/auth/callback/private"])(
    "continues to reject stale authentication on %s", async path => {
      const response = await proxy(new NextRequest(`https://tmswizard.cloud${path}`));
      expect(fake.getUser).toHaveBeenCalledOnce();
      if (path.startsWith("/api/")) expect(response.status).toBe(401);
      else expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    },
  );

  it("still admits a server-verified user on the dashboard", async () => {
    fake.getUser.mockResolvedValue({ data: { user: { id: "fixture-user" } }, error: null });
    const response = await proxy(new NextRequest("https://tmswizard.cloud/dashboard"));
    expect(fake.getUser).toHaveBeenCalledOnce();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
