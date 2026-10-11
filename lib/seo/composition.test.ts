import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "../nav/navConfig";
import { shouldShowShell } from "../nav/shouldShowShell";
import { isPublicPath } from "../auth/publicRoutes";
import { isPublicMarketingSurface } from "./routes";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("composed public and operational experience", () => {
  it("keeps every current console navigation destination private, present and visible to a resolved tenant", () => {
    for (const item of NAV_GROUPS.flatMap(group => group.items)) {
      expect(existsSync(resolve(process.cwd(), `app${item.href}/page.tsx`)), item.href).toBe(true);
      expect(isPublicMarketingSurface(item.href), item.href).toBe(false);
      expect(isPublicPath(item.href), item.href).toBe(false);
      expect(shouldShowShell(item.href, "ready"), item.href).toBe(true);
      expect(shouldShowShell(item.href, "signed-out"), item.href).toBe(false);
    }
    for (const path of ["/settings/integrations", "/settings/permissions"]) {
      expect(isPublicMarketingSurface(path)).toBe(false);
      expect(isPublicPath(path)).toBe(false);
      expect(shouldShowShell(path, "ready")).toBe(true);
    }
  });

  it("moves all current application-frame responsibilities together", () => {
    const frame = source("app/components/ApplicationFrame.tsx");
    for (const component of ["TenantProvider", "PastDueBanner", "AppShell", "ThemeScope", "ContextualAssistant"]) {
      expect(frame).toContain(`<${component}`);
    }
    expect(source("app/layout.tsx")).toContain("<SiteFrame>{children}</SiteFrame>");
    expect(source("app/components/SiteFrame.tsx")).toContain("<ApplicationFrame>{children}</ApplicationFrame>");
  });

  it("combines branded auth surfaces with the existing recovery and POST confirmation flow", () => {
    const login = source("app/login/page.tsx");
    expect(login).toContain("<AuthSurface>");
    expect(login).toContain("loginErrorMessage");
    expect(login).toContain('fetch("/api/auth/magic-link"');
    expect(login).toContain("existing account email");
    const confirm = source("app/auth/confirm/page.tsx");
    expect(confirm).toContain("<AuthSurface>");
    expect(confirm).toContain('method="post"');
    expect(confirm).toContain('action="/api/auth/callback"');
    expect(confirm).toContain("Each link works once");
  });
});
