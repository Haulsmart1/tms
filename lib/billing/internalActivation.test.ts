import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireCompanyAdmin: vi.fn(), billing: vi.fn(), payment: vi.fn(), period: vi.fn(),
  internal: vi.fn(), write: vi.fn(), query: vi.fn(),
}));
vi.mock("./server", () => ({ requireCompanyAdmin: mocks.requireCompanyAdmin, fetchBillableVehicles: mocks.billing }));
vi.mock("./addonResolve", () => ({ loadV1AddonDecision: mocks.billing }));
vi.mock("./addonServer", () => ({ chargeVehicleAddon: mocks.payment }));
vi.mock("./periodServer", () => ({
  computeGraceUntil: mocks.period, fetchCompanyVehicleIds: mocks.billing,
  isPeriodBillingCompany: mocks.period, openPeriodAndChargeMinimum: mocks.payment,
  resolveActivation: mocks.period,
}));
vi.mock("./periodPaymentServer", () => ({ createSquarePeriodPaymentProvider: mocks.payment }));
vi.mock("./internalLicence", () => ({ loadInternalLicence: mocks.internal, writeInternalLicence: mocks.write }));

import { POST } from "../../app/api/licences/activate/route";

const tenant = "00000000-0000-4000-8000-000000000103";
const vehicle = "00000000-0000-4000-8000-000000000105";
const licence = "00000000-0000-4000-8000-000000000108";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.internal.mockResolvedValue({ id: licence, billing_mode: "internal" });
  mocks.write.mockResolvedValue(undefined);
  const builder: Record<string, unknown> = {};
  for (const name of ["select", "eq"]) builder[name] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: { vehicle_id: vehicle, tenant_id: tenant, active: false }, error: null });
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: tenant }], error: null });
  mocks.query.mockReturnValue(builder);
  mocks.requireCompanyAdmin.mockResolvedValue({ admin: { from: mocks.query }, companyId: "company" });
});

describe("internal licence activation API", () => {
  it.each([
    { action: "create", tenantId: tenant, vehicleId: vehicle, licenceType: "ADR", issueDate: null, expiryDate: null, active: true, notes: null },
    { action: "setActive", licenceId: licence, active: true },
    { action: "setActive", licenceId: licence, active: false },
  ])("writes without invoking billing, payment or subscription/period paths: %j", async (body) => {
    const response = await POST(new NextRequest("https://example.test/api/licences/activate", { method: "POST", body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, charged: false, reason: "internal_vehicle" });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.billing).not.toHaveBeenCalled();
    expect(mocks.payment).not.toHaveBeenCalled();
    expect(mocks.period).not.toHaveBeenCalled();
  });

  it("retains authorisation history when deletion is requested", async () => {
    const response = await POST(new NextRequest("https://example.test/api/licences/activate", {
      method: "POST", body: JSON.stringify({ action: "delete", licenceId: licence }),
    }));
    expect(response.status).toBe(409);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.payment).not.toHaveBeenCalled();
  });

  it("rejects another company's vehicle before checking or using an exemption", async () => {
    const response = await POST(new NextRequest("https://example.test/api/licences/activate", { method: "POST", body: JSON.stringify({
      action: "create", tenantId: "00000000-0000-4000-8000-000000000104", vehicleId: vehicle,
      licenceType: "ADR", issueDate: null, expiryDate: null, active: true, notes: null,
    }) }));
    expect(response.status).toBe(403);
    expect(mocks.internal).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
