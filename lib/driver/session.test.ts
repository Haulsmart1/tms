import { describe, expect, it } from "vitest";
import { selectDriverLink, type DriverLink } from "./session";

const a: DriverLink = { tenantId: "t1", driverId: "d1", subcontractorId: null, portalType: "direct_driver" };
const b: DriverLink = { tenantId: "t2", driverId: "d2", subcontractorId: null, portalType: "direct_driver" };
const sub: DriverLink = { tenantId: "t3", driverId: "d3", subcontractorId: "s1", portalType: "subcontractor_driver" };

describe("selectDriverLink", () => {
  it("reports no links", () => {
    expect(selectDriverLink([])).toEqual({ ok: false, reason: "none" });
  });

  it("uses the only link, even when it appears twice", () => {
    expect(selectDriverLink([a])).toEqual({ ok: true, link: a });
    expect(selectDriverLink([a, { ...a }])).toEqual({ ok: true, link: a });
  });

  it("is ambiguous without a job when links differ", () => {
    expect(selectDriverLink([a, b])).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("picks the link that owns the job", () => {
    expect(selectDriverLink([a, b], { tenantId: "t2", driverId: "d2", subcontractorId: null })).toEqual({ ok: true, link: b });
    expect(selectDriverLink([a, sub], { tenantId: "t3", driverId: "d3", subcontractorId: "s1" })).toEqual({ ok: true, link: sub });
  });

  it("does not match a subcontractor link to another subcontractor's job", () => {
    expect(selectDriverLink([a, sub], { tenantId: "t3", driverId: "d3", subcontractorId: "other" })).toEqual({ ok: true, link: a });
  });
});
