import { describe, expect, it } from "vitest";
import { billableVehicleIds } from "./vehicleCount";
import { collectPeriodVehicles, highWaterMark, type PeriodLicence } from "./close";
import { assembleInvoice } from "./invoice";
import { platformBillableVehicleCount } from "../superAdmin/summary";

const bounds = { periodStartISO: "2026-09-14", periodEndISO: "2026-10-12" };
const paid: PeriodLicence = {
  vehicleId: "paid", tenantId: "tenant", vrnNormalised: "PAID",
  activatedOnISO: bounds.periodStartISO, deactivatedOnISO: null, graceUntilISO: null,
};
const internal: PeriodLicence = { ...paid, vehicleId: "internal", billingMode: "internal" };
const vehicles = [{ id: "paid", tenant_id: "tenant" }, { id: "internal", tenant_id: "tenant" }];
const licences = [
  { vehicle_id: "paid", active: true, billing_mode: "paid" },
  { vehicle_id: "internal", active: true, billing_mode: "internal" },
];

describe("free internal vehicles", () => {
  it("excludes internal vehicles from v1 usage and platform counts", () => {
    expect(billableVehicleIds({ companyId: "company", companyTenantIds: ["tenant"], vehicles, licences }))
      .toEqual(new Set(["paid"]));
    expect(platformBillableVehicleCount(vehicles, licences)).toBe(1);
  });

  it("keeps legacy licences paid and counts duplicate paid documents once", () => {
    expect(billableVehicleIds({ companyId: "company", companyTenantIds: ["tenant"], vehicles,
      licences: [{ vehicle_id: "paid", active: true }, { vehicle_id: "paid", active: true }, licences[1]],
    })).toEqual(new Set(["paid"]));
  });

  it("excludes internal lifecycle history from v2 lines and fleet high-water mark", () => {
    expect(collectPeriodVehicles({ ...bounds, licences: [paid, internal] }))
      .toEqual(collectPeriodVehicles({ ...bounds, licences: [paid] }));
    expect(highWaterMark({ ...bounds, licences: [paid, internal] })).toBe(1);
    expect(collectPeriodVehicles({ ...bounds, licences: [internal] })).toEqual([]);
    expect(highWaterMark({ ...bounds, licences: [internal] })).toBe(0);
  });

  it("leaves the complete paid invoice unchanged with 100 internal vehicles added", () => {
    const invoice = (rows: PeriodLicence[]) => assembleInvoice({ ...bounds,
      vehicles: collectPeriodVehicles({ ...bounds, licences: rows }),
      minBillDays: 1, unitAmountPence: 6450, minimumPence: 12900,
      includedVehicles: 0, vatRatePercent: 20,
    });
    const internalFleet = Array.from({ length: 100 }, (_, i) => ({ ...internal, vehicleId: `free-${i}` }));
    expect(invoice([paid, ...internalFleet])).toEqual(invoice([paid]));
    expect(invoice([paid, ...internalFleet]).lines.some((line) => line.vehicleId?.startsWith("free-"))).toBe(false);
  });

  it("preserves paid historical obligations even if an internal row is passed accidentally", () => {
    const priorPaid = { ...paid, deactivatedOnISO: "2026-09-20" };
    expect(collectPeriodVehicles({ ...bounds, licences: [priorPaid, { ...internal, vehicleId: "paid" }] }))
      .toEqual(collectPeriodVehicles({ ...bounds, licences: [priorPaid] }));
  });
});
