import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NAV_GROUPS } from "./navConfig";
import { filterOperationNavigation, operationRouteLabel } from "../../app/components/operationsNavigation";

const state = vi.hoisted(() => ({ pathname: "/jobs", status: "ready", role: "admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../../app/components/TenantProvider", () => ({
  useTenant: () => ({ status: state.status, role: state.role, userEmail: "operator@example.test", tenants: [], activeTenantId: null, setActiveTenantId: vi.fn() }),
}));
vi.mock("../../lib/supabase/browser", () => ({ createClient: vi.fn() }));
vi.mock("../../app/components/ThemeToggle", () => ({ default: () => createElement("button", { "aria-label": "Change theme" }, "Theme") }));
import AppShell from "../../app/components/AppShell";

describe("operational workspace navigation", () => {
  it("keeps every existing route and group when search is blank", () => {
    expect(filterOperationNavigation("   ")).toBe(NAV_GROUPS);
    expect(filterOperationNavigation("").flatMap((group) => group.items)).toEqual(NAV_GROUPS.flatMap((group) => group.items));
  });

  it("finds existing pages by label or section without inventing destinations", () => {
    expect(filterOperationNavigation("OPERATIONS transfer").flatMap((group) => group.items).map((item) => item.href)).toEqual(["/load-transfer"]);
    expect(filterOperationNavigation("proof").flatMap((group) => group.items).map((item) => item.href)).toEqual(["/pod"]);
    expect(filterOperationNavigation("not a real page")).toEqual([]);
  });

  it("does not mutate navigation when narrowing results", () => {
    const original = JSON.stringify(NAV_GROUPS);
    filterOperationNavigation("fleet");
    expect(JSON.stringify(NAV_GROUPS)).toBe(original);
  });

  it("labels nested routes without selecting similar prefix routes", () => {
    expect(operationRouteLabel("/jobs/123")).toBe("Jobs");
    expect(operationRouteLabel("/tracking")).toBe("Tracking");
    expect(operationRouteLabel("/jobs-other")).toBe("Workspace");
  });

  it("renders actual links, current page, search and unchanged scope controls", () => {
    state.pathname = "/jobs"; state.status = "ready"; state.role = "admin";
    const html = renderToStaticMarkup(createElement(AppShell));
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) expect(html).toContain(`href="${item.href}"`);
    expect(html).toContain('aria-label="Find a workspace page"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Active tenant"');
    expect(html).toContain('aria-label="Sign out"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('href="/super-admin"');
  });

  it("preserves super-admin link visibility and staff tenant restrictions", () => {
    state.pathname = "/jobs"; state.status = "ready"; state.role = "super_admin";
    expect(renderToStaticMarkup(createElement(AppShell))).toContain('href="/super-admin"');
    state.role = "staff";
    const html = renderToStaticMarkup(createElement(AppShell));
    expect(html).not.toContain('aria-label="Active tenant"');
    expect(html).not.toContain('href="/super-admin"');
  });

  it("stays absent for signed-out and public confirmation pages", () => {
    state.status = "signed-out"; state.pathname = "/jobs";
    expect(renderToStaticMarkup(createElement(AppShell))).toBe("");
    state.status = "ready"; state.pathname = "/auth/confirm";
    expect(renderToStaticMarkup(createElement(AppShell))).toBe("");
    state.pathname = "/jobs"; state.role = "admin";
  });
});
