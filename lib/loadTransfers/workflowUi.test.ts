import { createElement } from "react";
// @ts-ignore TS7016: renderer declarations are not installed in the application.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoadTransferPage from "../../app/load-transfer/page";

const state = vi.hoisted(() => ({ tenantId: "tenant-1" as string | null, client: vi.fn(() => ({})) }));
vi.mock("../supabase/browser", () => ({ createClient: state.client }));
vi.mock("../../app/components/TenantProvider", () => ({
  useTenant: () => ({ status: "ready", activeTenantId: state.tenantId }),
}));
vi.mock("../../app/components/TenantGate", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("../../app/driver/CameraScanner", () => ({ default: () => createElement("button", { type: "button" }, "Camera scanner") }));

describe("load transfer workflow UI", () => {
  beforeEach(() => { state.tenantId = "tenant-1"; });

  it("shows the real three-stage workflow without claiming loaded vehicles or a transferable batch", () => {
    const html = renderToStaticMarkup(createElement(LoadTransferPage));
    expect(html).toContain('aria-label="Transfer workflow"');
    expect(html).toContain("Choose the handover");
    expect(html).toContain("Build your transfer batch");
    expect(html).toContain("Check before moving custody");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading vehicles...");
    expect(html).toContain("Your batch is empty.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm transfer<\/button>/);
  });

  it("explains unconfirmed batch lifetime and connects manual entry to its help", () => {
    const html = renderToStaticMarkup(createElement(LoadTransferPage));
    expect(html).toContain('aria-describedby="transfer-scan-help"');
    expect(html).toContain('id="transfer-scan-help"');
    expect(html).toContain("leaving or reloading the page loses the unconfirmed batch");
    expect(html).toContain("A partial load transfer does not automatically move the whole job or change Planning.");
  });

  it("blocks All tenants with readable next-action copy instead of exposing a transfer form", () => {
    state.tenantId = null;
    const html = renderToStaticMarkup(createElement(LoadTransferPage));
    expect(html).toContain("Choose a tenant to load its vehicles and drivers.");
    expect(html).toContain("Select a company before transferring load.");
    expect(html).not.toContain('id="transfer-source"');
    expect(html).not.toContain("Camera scanner");
    expect(html).not.toContain("Confirm transfer");
  });
});
