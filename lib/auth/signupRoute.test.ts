import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  app/api/signup/route.ts is not collected by vitest (only lib/ is), so the
  properties that live in the route file itself are asserted on its source:
  the outbound origin comes from publicAppOrigin (lib/accounts/publicLinks.test.ts
  covers the negative), no browser-style signUp is ever called, and the two
  admin calls that create or email a user carry no metadata payload (SQL-13).
*/

const ROUTE = join(__dirname, "..", "..", "app", "api", "signup", "route.ts");
const source = readFileSync(ROUTE, "utf8");

describe("app/api/signup/route.ts source", () => {
  it("builds the emailed link from publicAppOrigin, not the request host", () => {
    expect(source).toMatch(/publicAppOrigin\(request\.url\)/);
    expect(source).not.toMatch(/new URL\(\s*request\.url\s*\)\.origin/);
    expect(source).not.toMatch(/headers\.get\(\s*["'](?:host|x-forwarded-host)["']/);
  });

  it("runs on the node runtime and is never statically cached", () => {
    expect(source).toMatch(/export const runtime = "nodejs"/);
    expect(source).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("never calls signUp and never passes metadata to createUser or inviteUserByEmail", () => {
    expect(source).not.toMatch(/\.signUp\(/);
    expect(source).not.toMatch(/user_metadata/);
    const createUser = source.match(/createUser\(\{[^}]*\}\)/)?.[0] ?? "";
    expect(createUser).toContain("email_confirm: false");
    expect(createUser).not.toMatch(/\bdata\b/);
    const invite = source.match(/inviteUserByEmail\([^)]*\)/)?.[0] ?? "";
    expect(invite).toContain("redirectTo");
    expect(invite).not.toMatch(/\bdata\b/);
  });

  it("keys the IP limit with leadClientKey and uses the signup rules", () => {
    expect(source).toMatch(/leadClientKey\(request\.headers, clientIp\)/);
    expect(source).toMatch(/RATE_LIMITS\.signupPerIp/);
    expect(source).toMatch(/RATE_LIMITS\.signupPerEmail/);
  });

  it("sends the existing-account magic link with shouldCreateUser false", () => {
    expect(source).toMatch(/shouldCreateUser: false/);
  });
});
