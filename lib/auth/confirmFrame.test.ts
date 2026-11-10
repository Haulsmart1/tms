import { createElement, type ReactNode } from "react";
// @ts-ignore The application does not install react-dom declaration files.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ path: "/auth/confirm" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
vi.mock("next/dynamic", () => ({ default: () => ({ children }: { children: ReactNode }) => createElement("div", { id: "application-providers" }, children) }));
import SiteFrame from "../../app/components/SiteFrame";
it("keeps auth providers from consuming credentials before the confirmation button is pressed", () => {
  state.path = "/auth/confirm";
  const html = renderToStaticMarkup(createElement(SiteFrame, { children: createElement("p", {}, "Confirm") }));
  expect(html).toContain("Confirm");
  expect(html).not.toContain("application-providers");
});
it("retains authenticated application providers on operational pages", () => {
  state.path = "/warehouse";
  expect(renderToStaticMarkup(createElement(SiteFrame, { children: createElement("p", {}, "Warehouse") }))).toContain("application-providers");
});
