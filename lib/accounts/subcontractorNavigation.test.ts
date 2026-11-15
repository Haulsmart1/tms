// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import SubcontractorDashboardPage from "../../app/subcontractor/dashboard/page";
import { activeSubcontractorSection, subcontractorSections } from "./subcontractorNavigation";

afterEach(() => {
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
    expect(container.querySelector('a[aria-label="Download invoice SB-7 PDF"]')?.getAttribute("href"))
      .toBe("/api/subcontractor/invoices?link=selected&download=invoice-id");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
