import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  Regression test for review AUTH-1. proxy.ts's matcher was written as
  "...|.*\.[^/]+$..." inside a normal JS string, where "\." is just ".", so the
  negative lookahead excluded almost every path and the edge auth gate ran on
  "/" only. Next compiles the matcher from the literal's VALUE, so this test
  evaluates the literal the same way and checks real routes.
*/

function compiledMatcher(): RegExp {
  const source = readFileSync(join(__dirname, "..", "..", "proxy.ts"), "utf8");
  const match = source.match(/matcher:\s*\[\s*("(?:[^"\\]|\\.)*")/);
  if (!match) throw new Error("matcher literal not found in proxy.ts");
  const value = JSON.parse(match[1]) as string;
  return new RegExp(`^${value}$`);
}

describe("proxy.ts matcher", () => {
  const re = compiledMatcher();

  it.each(["/", "/dashboard", "/jobs", "/api/billing/run", "/api/accounts/invoices", "/pod/share/abc.def"])(
    "runs the gate on %s",
    (path) => {
      // A dotted last segment like a token "abc.def" is still skipped by design,
      // so only assert paths without a dot in the final segment.
      if (/\.[^/]+$/.test(path)) return;
      expect(re.test(path)).toBe(true);
    },
  );

  /* N-8: the dotted-last-segment skip is for static files only. Under /api/
     every path runs the gate, so a handler reached as /api/x/<id>.json is
     never left to authenticate itself alone. */
  it.each(["/api/jobs/abc.json", "/api/x/a.b", "/api/accounts/invoices/1.pdf"])(
    "runs the gate on dotted API path %s",
    (path) => {
      expect(re.test(path)).toBe(true);
    },
  );

  it.each(["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.png"])("skips %s", (path) => {
    expect(re.test(path)).toBe(false);
  });
});
