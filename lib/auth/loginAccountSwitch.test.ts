// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import LoginPage from "../../app/login/page";

vi.mock("../../components/landing/AuthSurface", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("../../app/components/TenantProvider", () => ({ useTenant: () => ({ status: "no-tenant", userEmail: "driver@example.test" }) }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/login?next=%2Fwarehouse");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("distinguishes the existing driver identity from the requested office account until email confirmation", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, message: "Check your email." }));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(createElement(LoginPage)));
  expect(container.textContent).toContain("This browser is currently signed in as driver@example.test");
  const input = container.querySelector('input[type="email"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "warehouse@example.test");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "warehouse@example.test", next: "/warehouse" });
  expect(container.textContent).toContain("Check warehouse@example.test");
  expect(container.textContent).toContain("Requesting a link does not switch accounts yet");
  expect(container.textContent).toContain("Continue to TMS Wizard to finish signing in");
  expect(window.location.pathname).toBe("/login");
});
