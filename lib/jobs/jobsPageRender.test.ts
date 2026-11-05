import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import JobsPage from "../../app/jobs/page";

vi.mock("../../lib/supabase/browser", () => ({ createClient: () => ({}) }));
vi.mock("../../app/components/TenantProvider", () => ({ useTenant: () => ({ status: "loading", activeTenantId: null }) }));
vi.mock("../../app/components/TenantGate", () => ({ default: ({ children }: { children: ReactNode }) => children }));

describe("Jobs page initial render", () => {
  it("renders before any job is loaded or selected without reading a missing saved-plan job", () => {
    const markup = renderToStaticMarkup(createElement(JobsPage));
    expect(markup).toContain("Jobs &amp; loads");
    expect(markup).toContain("Jobs board");
    expect(markup).not.toContain("Back to saved plan");
  });
});
