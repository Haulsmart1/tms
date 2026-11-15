// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import PortalSessionControls from "../../app/subcontractor/dashboard/PortalSessionControls";
import SubcontractorDashboardPage from "../../app/subcontractor/dashboard/page";
import { activeSubcontractorSection, subcontractorSections } from "./subcontractorNavigation";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("../supabase/browser", () => ({ createClient: () => ({ auth: { signOut } }) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it("offers only menu destinations allowed by the portal role", () => {
  expect(subcontractorSections("accounts").map(({ id }) => id)).toEqual(["assigned-jobs", "invoices"]);
  expect(subcontractorSections("driver").map(({ id }) => id)).toEqual(["assigned-jobs", "vehicles"]);
  expect(activeSubcontractorSection("driver", "#invoices")).toBe("assigned-jobs");
  expect(activeSubcontractorSection("subcontractor_admin", "#company-details")).toBe("company-details");
  expect(activeSubcontractorSection("unknown", "#assigned-jobs")).toBeUndefined();
});

it("opens each destination, preserves the portal link, and loads invoices when selected", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/subcontractor/dashboard?link=selected");
  const fetch = vi.fn(async (url: string) => {
    if (url === "/api/subcontractor/me?link=selected") {
      return Response.json({
        portalUser: { id: "selected", role: "subcontractor_admin" },
        subcontractor: { name: "Test subcontractor" },
        employee: { full_name: "Test admin" },
        jobs: [], vehicles: [], employees: [], portalUsers: [],
      });
    }
    if (url === "/api/subcontractor/invoices?link=selected&page=1") {
      return Response.json({
        invoices: [{ id: "invoice-id", invoice_number: "SB-7", issue_date: "2026-01-15" }], hasNext: false,
      });
    }
    throw new Error(`Unexpected request to ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(SubcontractorDashboardPage)); });
    const links = [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Subcontractor menu"] a')];
    expect(links).toHaveLength(5);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(container.querySelector('header a')?.getAttribute("href")).toBe("/");
    for (const link of links) {
      const id = link.hash.slice(1);
      await act(async () => {
        window.history.pushState(null, "", link.hash);
        window.dispatchEvent(new Event("hashchange"));
      });
      expect(link.getAttribute("aria-current")).toBe("location");
      const panel = container.querySelector<HTMLElement>(`#${id}`);
      expect(panel).not.toBeNull();
      expect(panel!.closest("[hidden]")).toBeNull();
      expect(window.location.search).toBe("?link=selected");
    }
    expect(fetch).toHaveBeenCalledWith("/api/subcontractor/invoices?link=selected&page=1", expect.anything());
    await act(async () => {
      window.history.pushState(null, "", "#invoices");
      window.dispatchEvent(new Event("hashchange"));
    });
    const back = container.querySelector<HTMLAnchorElement>("header a");
    expect(back?.textContent).toContain("Back to Jobs");
    expect(back?.getAttribute("href")).toBe("#assigned-jobs");
    expect(container.querySelector('a[aria-label="Download invoice SB-7 PDF"]')?.getAttribute("href"))
      .toBe("/api/subcontractor/invoices?link=selected&download=invoice-id");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("logs out this session, or stays in the portal with an error if sign-out fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  signOut.mockReset();
  signOut.mockResolvedValueOnce({ error: new Error("Network unavailable") }).mockResolvedValueOnce({ error: null });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(createElement(PortalSessionControls)); });
    const logout = container.querySelector("button")!;
    await act(async () => logout.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not log out");
    expect(replace).not.toHaveBeenCalled();
    await act(async () => logout.click());
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(replace).toHaveBeenCalledWith("/login?next=%2Fsubcontractor%2Fdashboard");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
