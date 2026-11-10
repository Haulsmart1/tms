// @vitest-environment happy-dom
import { createElement, StrictMode, act } from "react";
// @ts-ignore The application does not install react-dom declaration files.
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import ImplicitLinkConfirmation from "../../app/auth/confirm/ImplicitLinkConfirmation";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: string; href: string }) => createElement("a", { href }, children) }));
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

it("reads a mobile invite fragment, removes credentials from history, and waits for explicit form submission even under StrictMode", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/auth/confirm?next=%2Fwarehouse#access_token=header.payload.signature&refresh_token=fixture-refresh&token_type=bearer&type=invite");
  const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(createElement(StrictMode, {}, createElement(ImplicitLinkConfirmation, { next: "/warehouse" }))));
  expect(window.location.hash).toBe("");
  expect(container.textContent).toContain("Continue to TMS Wizard");
  const form = container.querySelector("form")!;
  expect(form.getAttribute("method")).toBe("post");
  expect(form.getAttribute("action")).toBe("/api/auth/callback");
  const fields = new FormData(form);
  expect(fields.get("access_token")).toBe("header.payload.signature");
  expect(fields.get("refresh_token")).toBe("fixture-refresh");
  expect(fields.get("next")).toBe("/warehouse");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(window.localStorage.length).toBe(0);
  expect(window.sessionStorage.length).toBe(0);
});
