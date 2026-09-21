import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicPath } from "../auth/publicRoutes";
import { shouldShowShell } from "../nav/shouldShowShell";
import { isThemeableRoute } from "../nav/themeableRoutes";
import { LEGAL_DOCUMENT_PATHS, LEGAL_PATHS, isLegalPath } from "./routes";

/* A legal page touches four lists that live in four files. Each of those files
   keeps its own verbatim list on purpose; this is the one place that checks
   they all agree, so an eleventh document cannot ship half wired. */
describe("every legal path is fully wired", () => {
  it("pins the published paths", () => {
    expect([...LEGAL_PATHS]).toEqual([
      "/legal",
      "/terms",
      "/privacy",
      "/cookies",
      "/cancellation-policy",
      "/dpa",
      "/accessibility",
      "/support-policy",
      "/acceptable-use",
      "/sub-processors",
      "/security",
    ]);
  });

  it.each([...LEGAL_PATHS])("%s has a page, is public, is themeable and hides the console shell", (path) => {
    expect(existsSync(join(__dirname, "..", "..", "app", path.slice(1), "page.tsx")), "page file").toBe(true);
    /* Anonymous visitors must reach it: the signup form links here before an
       account exists. */
    expect(isPublicPath(path), "public").toBe(true);
    /* Otherwise ThemeScope pins the subtree dark around a pinned-light page. */
    expect(isThemeableRoute(path), "themeable").toBe(true);
    /* A signed-in admin following the footer link must not get the console
       sidebar wrapped around a legal document. */
    expect(shouldShowShell(path, "ready"), "shell").toBe(false);
    expect(shouldShowShell(path, "loading"), "shell while loading").toBe(false);
  });

  /* publicRoutes.ts allows exact paths only. Nothing beneath a legal page may
     become public by accident. */
  it("opens nothing beneath or beside a legal path", () => {
    for (const path of LEGAL_DOCUMENT_PATHS) {
      expect(isPublicPath(`${path}/anything`), path).toBe(false);
      expect(isLegalPath(`${path}/anything`), path).toBe(false);
    }
    expect(isPublicPath("/legal/terms")).toBe(false);
    expect(isPublicPath("/privacy-settings")).toBe(false);
  });

  it("does not treat console routes as legal pages", () => {
    expect(isLegalPath("/settings")).toBe(false);
    expect(isLegalPath("/")).toBe(false);
    expect(shouldShowShell("/settings", "ready")).toBe(true);
  });
});
