import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
  The live handle_new_user trigger (AFTER INSERT ON auth.users, SECURITY
  DEFINER) reads tenant_id, company_id and role_id from raw_user_meta_data
  and inserts a tenant profile when tenant_id is present. A portal or
  subcontractor invitee whose invite carried those ids became a full member
  of the operator's tenant (review C-4, 2026-10-08).

  So no invite or user-creation call may put an identity or authorization id
  into user metadata. Tenancy is written server-side instead: the
  provision_tenant_user RPC for console users, driver_users and
  subcontractor_users rows for portal users. This scans the source of every
  route handler, because the metadata is built inline at each call.
*/

const ROOT = join(__dirname, "..", "..");
const CALLS = /\b(inviteUserByEmail|generateLink|createUser|updateUserById|resolveInvitee)\s*\(/g;
const FORBIDDEN =
  /(?<![\w.$])(tenant_id|company_id|role_id|role|driver_id|subcontractor_id|employee_id)\s*[:,}\n]/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

/** The argument text of every call to one of CALLS, by paren matching. */
function callArguments(source: string): Array<{ name: string; args: string }> {
  const found: Array<{ name: string; args: string }> = [];
  for (const match of source.matchAll(CALLS)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (end < source.length && depth > 0) {
      const ch = source[end];
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      end += 1;
    }
    found.push({ name: match[1], args: source.slice(start, end - 1) });
  }
  return found;
}

function offendersIn(file: string): string[] {
  const source = stripComments(readFileSync(join(ROOT, file), "utf8"));
  return callArguments(source)
    .filter((call) => FORBIDDEN.test(call.args))
    .map((call) => `${file}: ${call.name}(${call.args.trim().slice(0, 120)})`);
}

describe("invite user metadata", () => {
  const files = routeFiles(join(ROOT, "app", "api")).map((file) =>
    relative(ROOT, file).split("\\").join("/"),
  );

  it("covers the three invite routes", () => {
    for (const file of [
      "app/api/settings/portal-invites/route.ts",
      "app/api/settings/users/invite/route.ts",
      "app/api/subcontractor/users/invite/route.ts",
    ]) {
      expect(files).toContain(file);
      expect(readFileSync(join(ROOT, file), "utf8")).toMatch(/inviteUserByEmail\s*\(/);
    }
  });

  it("never passes a tenant, company, role or portal id into an invite", () => {
    expect(files.flatMap(offendersIn)).toEqual([]);
  });

  it("would catch the metadata shape C-4 found", () => {
    const shape = `inviteUserByEmail(email, { redirectTo, data: { portal: "subcontractor", tenant_id: t, role } })`;
    expect(callArguments(shape).some((call) => FORBIDDEN.test(call.args))).toBe(true);
    const clean = `inviteUserByEmail(email, { redirectTo, data: { portal: "subcontractor" } })`;
    expect(callArguments(clean).some((call) => FORBIDDEN.test(call.args))).toBe(false);
  });
});
