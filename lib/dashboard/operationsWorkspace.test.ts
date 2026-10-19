import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Only the page composition is exercised here. No Supabase call, browser
// credential, mutation or hosted sign-in is part of these SSR checks.
vi.mock("../../lib/supabase/browser", () => ({ createClient: () => ({}) }));
vi.mock("../../app/components/TenantProvider", () => ({ useTenant: () => ({ status: "ready", role: "admin", activeTenantId: "tenant-1", tenants: [] }) }));
vi.mock("../../app/components/TenantGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../../app/jobs/JobForm", () => ({ default: () => createElement("input", { name: "retained-job-draft", defaultValue: "" }) }));
vi.mock("../../app/jobs/MasterLoadBuilder", () => ({ default: () => createElement("div", null, "Load builder") }));
vi.mock("../../app/jobs/DeleteJobDialog", () => ({ default: () => null }));

import DashboardPage from "../../app/dashboard/page";
import JobsPage from "../../app/jobs/page";

describe("operational workspace composition", () => {
  it("renders the internal dashboard with real operation destinations", () => {
    const html = renderToStaticMarkup(createElement(DashboardPage));
    expect(html).toContain("Operations overview</h1>");
    expect(html).toContain('aria-label="Operations shortcuts"');
    for (const href of ["/jobs", "/planning", "/load-transfer", "/pod"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain("Refresh overview");
    expect(html).not.toContain("On the road");
  });
  it("keeps overdue money within a full-width mobile KPI row", () => {
    const html = renderToStaticMarkup(createElement(DashboardPage));
    expect(html).toContain("grid-cols-2 gap-3 md:grid-cols-5");
    expect(html).toMatch(/class="col-span-2 min-w-0 md:col-span-1"><div[^>]*>[\s\S]*?Overdue invoices/);
  });
  it("shows loading rather than invented operational counts on first render", () => {
    const html = renderToStaticMarkup(createElement(DashboardPage));
    expect(html).toContain("Loading dashboard");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("Nothing needs attention right now");
  });
  it("makes the jobs board and load builder directly reachable", () => {
    const html = renderToStaticMarkup(createElement(JobsPage));
    expect(html).toContain("Jobs &amp; loads</h1>");
    for (const id of ["jobs-board", "load-builder", "job-editor"]) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('href="/load-transfer"');
    expect(html).toContain('aria-label="Job workspace"');
  });
  it("keeps the job form mounted inside a closed native disclosure", () => {
    const html = renderToStaticMarkup(createElement(JobsPage));
    expect(html).toContain('<details id="job-editor"');
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(html).toContain('name="retained-job-draft"');
    expect(html).toContain("Create a new job");
    expect(html).toContain("Loading jobs");
  });
});
