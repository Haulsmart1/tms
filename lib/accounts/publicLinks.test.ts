import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
  Links that leave the app (customer emails, share links, third-party return
  URLs) must come from publicAppOrigin() in lib/accounts/appUrl.ts, never from
  the request's own Host. A preview deployment or a spoofed Host header would
  otherwise put a foreign origin into a customer's inbox (review INV-26, and
  the 2026-09-15 follow-up that found the POD share routes still did this).

  If a route ever genuinely needs the request origin for something that is not
  emitted, add it to ALLOWED with the reason.
*/

const ROOT = join(__dirname, "..", "..");
const ALLOWED = new Set<string>();
const PATTERN = /new URL\(\s*request\.url\s*\)\.origin|request\.nextUrl\.origin|headers\.get\(\s*["'](?:host|x-forwarded-host)["']\s*\)/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("outbound links", () => {
  it("never build an origin from the incoming request outside the allowlist", () => {
    const offenders = routeFiles(join(ROOT, "app", "api"))
      .map((file) => relative(ROOT, file).split("\\").join("/"))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => PATTERN.test(readFileSync(join(ROOT, file), "latin1")));

    expect(offenders).toEqual([]);
  });
});
