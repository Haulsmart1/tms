import { NextRequest, NextResponse } from "next/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), rpc: vi.fn(), invite: vi.fn(), remove: vi.fn(), otp: vi.fn(),
  access: vi.fn(), limit: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithOtp: mocks.otp } }),
}));
vi.mock("../../app/api/settings/users/shared", () => ({
  requireUserAdmin: mocks.access,
  json: (result: { body: unknown; status: number }) => NextResponse.json(result.body, { status: result.status }),
}));
vi.mock("../rateLimit", () => ({
  checkRateLimit: mocks.limit, RATE_LIMITS: { invitePerUser: {} },
}));
import { POST } from "../../app/api/settings/users/invite/route";

const tenantId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const email = "warehouse@example.test";

function submit() {
  return POST(new NextRequest("https://tms.invalid/api/settings/users/invite", {
    method: "POST", body: JSON.stringify({ tenantId, email, role: "staff" }),
  }));
}
function provision(outcome: string, existing = true) {
  mocks.rpc.mockImplementation(async (name: string) => name === "find_auth_user_id_by_email"
    ? { data: existing ? userId : null, error: null }
    : { data: outcome, error: null });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-key");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tmswizard.cloud");
  mocks.access.mockResolvedValue({ ok: true, ctx: {
    admin: { rpc: mocks.rpc, auth: { admin: { getUserById: mocks.getUser, inviteUserByEmail: mocks.invite, deleteUser: mocks.remove } } },
    user: { id: "admin-fixture" },
  } });
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.invite.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email, email_confirmed_at: "2026-11-01T12:00:00Z" } }, error: null });
  mocks.otp.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  provision("already_member");
});
afterEach(() => vi.unstubAllEnvs());

it("resends a sign-in link when a member is invited again", async () => {
  const response = await submit();
  expect(response.status).toBe(200);
  expect((await response.json()).message).toContain("existing role is unchanged");
  expect(mocks.invite).not.toHaveBeenCalled();
  expect(mocks.otp).toHaveBeenCalledExactlyOnceWith({ email, options: {
    shouldCreateUser: false, emailRedirectTo: "https://tmswizard.cloud/auth/confirm?next=%2Fdashboard",
  } });
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("sends one invitation for a new account, without a second email", async () => {
  provision("created", false);
  expect((await submit()).status).toBe(200);
  expect(mocks.invite).toHaveBeenCalledTimes(1);
  expect(mocks.otp).not.toHaveBeenCalled();
});
it.each(["created", "repaired"])("emails an existing auth account after it is %s", async outcome => {
  provision(outcome);
  expect((await submit()).status).toBe(200);
  expect(mocks.otp).toHaveBeenCalledTimes(1);
});
it("does not email or disclose an account belonging to another company", async () => {
  provision("other_company");
  const foreignResponse = await submit();
  expect(mocks.otp).not.toHaveBeenCalled();
  expect(mocks.invite).not.toHaveBeenCalled();
  provision("created", false);
  const newResponse = await submit();
  expect(foreignResponse.status).toBe(newResponse.status);
  expect(await foreignResponse.json()).toEqual(await newResponse.json());
});
it.each(["already_member", "created", "repaired"])("reports SMTP failure for %s without deleting access", async outcome => {
  provision(outcome);
  mocks.otp.mockResolvedValue({ error: { status: 500, code: "unexpected_failure" } });
  const response = await submit();
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({ accountReady: true, error: expect.stringContaining("could not be sent") });
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("reports email rate limiting rather than success", async () => {
  mocks.otp.mockResolvedValue({ error: { status: 429, code: "over_email_send_rate_limit" } });
  const response = await submit();
  expect(response.status).toBe(429);
  expect((await response.json()).error).toContain("rate-limited");
});
it("reports missing email configuration instead of silently succeeding", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  const response = await submit();
  expect(response.status).toBe(503);
  expect((await response.json()).accountReady).toBe(true);
  expect(mocks.otp).not.toHaveBeenCalled();
});
it("does not return or log provider secrets after a network exception", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.otp.mockRejectedValue(new Error("secret-link-token"));
  const response = await submit();
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain("secret-link-token");
  expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-link-token");
  warn.mockRestore();
});
it.each([401, 403])("blocks unauthorized invitation retries (%s)", async status => {
  mocks.access.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Denied" }, { status }) });
  expect((await submit()).status).toBe(status);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.otp).not.toHaveBeenCalled();
});
it("retains the per-administrator invitation rate limit", async () => {
  mocks.limit.mockResolvedValue({ allowed: false });
  expect((await submit()).status).toBe(429);
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.otp).not.toHaveBeenCalled();
});

it.each(["already_member", "created", "repaired"])("resends the invite for an unconfirmed account (%s), without using signup-disabled OTP", async outcome => {
  provision(outcome);
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email, email_confirmed_at: null } }, error: null });
  const response = await submit();
  expect(response.status).toBe(200);
  expect(mocks.invite).toHaveBeenCalledExactlyOnceWith(email, {
    redirectTo: "https://tmswizard.cloud/auth/confirm?next=%2Fdashboard",
  });
  expect(mocks.otp).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});
it("can resend an unaccepted invitation without the public OTP configuration", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email, email_confirmed_at: null } }, error: null });
  expect((await submit()).status).toBe(200);
  expect(mocks.invite).toHaveBeenCalledTimes(1);
});
it.each([429, 500])("reports a pending invitation email failure (%s), preserving the account", async status => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email, email_confirmed_at: null } }, error: null });
  mocks.invite.mockResolvedValue({ data: { user: null }, error: { status, code: "email_error" } });
  const response = await submit();
  expect(response.status).toBe(status === 429 ? 429 : 502);
  expect((await response.json()).accountReady).toBe(true);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.otp).not.toHaveBeenCalled();
});
it.each([
  { data: { user: null }, error: { status: 500 } },
  { data: { user: { id: userId, email: "changed@example.test" } }, error: null },
  { data: { user: { id: "different-user", email } }, error: null },
])("does not send when the recipient cannot be verified", async lookup => {
  mocks.getUser.mockResolvedValue(lookup);
  expect((await submit()).status).toBe(502);
  expect(mocks.invite).not.toHaveBeenCalled();
  expect(mocks.otp).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});
