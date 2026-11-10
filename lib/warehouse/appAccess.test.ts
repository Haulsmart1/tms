// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WarehouseAppAccess from "../../app/warehouse/WarehouseAppAccess";
import DriverWorkspaceLink from "../../app/driver/DriverWorkspaceLink";

const tenant = vi.hoisted(() => ({ status: "ready", role: "admin", userEmail: "warehouse@example.test" }));
vi.mock("../../app/components/TenantProvider", () => ({ useTenant: () => tenant }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  tenant.status = "ready"; tenant.role = "admin";
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function renderAccess() {
  await act(async () => root.render(createElement(StrictMode, {}, createElement(WarehouseAppAccess,
    { email: tenant.userEmail, role: "admin", workspace: "Test warehouse" }))));
}
async function renderLink() { await act(async () => root.render(createElement(DriverWorkspaceLink))); }

it("gives office members a direct Warehouse link without closing the driver tab", async () => {
  await renderLink();
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/warehouse");
  expect(link.target).toBe("_blank"); expect(link.rel).toContain("noopener");
  expect(container.textContent).toContain(tenant.userEmail);
});

it.each(["no-tenant", "signed-out"])("offers office sign-in, not a permission grant, for %s", async status => {
  tenant.status = status; await renderLink();
  const link = container.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/login?next=%2Fwarehouse");
  expect(link.textContent).toBe("Sign in to Warehouse"); expect(link.target).toBe("_blank");
  expect(container.textContent).toContain("Use your office account");
});

it("does not claim office access while the account is resolving", async () => {
  tenant.status = "loading"; await renderLink(); expect(container.querySelector("a")).toBeNull();
});

it("shows the office identity and manual iPhone instructions when no install prompt is available", async () => {
  await renderAccess();
  expect(container.textContent).toContain("Test warehouse · Administrator");
  expect(container.textContent).toContain(tenant.userEmail);
  expect(container.textContent).toContain("open this page in Safari, tap Share, then Add to Home Screen");
  expect(container.querySelector("button")).toBeNull();
});

it("only prompts installation after a click and hides the offer once installed", async () => {
  await renderAccess();
  const prompt = vi.fn().mockResolvedValue(undefined);
  const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }),
    { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
  await act(async () => window.dispatchEvent(offer));
  expect(offer.defaultPrevented).toBe(true); expect(prompt).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button")!.click());
  expect(prompt).toHaveBeenCalledTimes(1);
  await act(async () => window.dispatchEvent(new Event("appinstalled")));
  expect(container.querySelector("details")).toBeNull();
  expect(container.textContent).toContain("Administrator");
});

it("keeps manual installation available after a failed browser prompt", async () => {
  await renderAccess();
  const offer = Object.assign(new Event("beforeinstallprompt"), {
    prompt: vi.fn().mockRejectedValue(new Error("Unavailable")), userChoice: Promise.resolve({ outcome: "dismissed" }),
  });
  await act(async () => window.dispatchEvent(offer));
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Add to Home Screen");
  expect(container.querySelector("details")).not.toBeNull();
});

it("does not offer another installation when already running standalone", async () => {
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
  await renderAccess(); expect(container.querySelector("details")).toBeNull();
  expect(container.textContent).toContain(tenant.userEmail);
});
